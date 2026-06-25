# Optimizaciones de Rendimiento — Motores

Registro de micro-optimizaciones aplicadas a los motores del autómata, con sus mediciones
antes/después. Toda optimización se valida con [`benchmark.html`](../benchmark.html), que
mide *step avg/p95*, *render avg* y *gen/s* por motor con warm-up configurable sobre grids
de 200² a 1000².

## Metodología

- **Banco**: `benchmark.html` (navegador) o un micro-benchmark Node equivalente que importa
  los motores reales. El proyecto no tiene `package.json`; para correr en Node se crea uno
  temporal con `{"type":"module"}` y se elimina al terminar.
- **Configuración de referencia**: 400×400, warm-up 20, 200 pasos medidos, misma semilla
  determinista en las corridas *antes* y *después*, ≥2 repeticiones.
- **Criterio de aceptación**: mejora medible y reproducible en *step* y/o *gen/s*.

## Contexto

Los motores no eran homogéneos. Hex, Triangle y el worker estándar
(`scripts/infrastructure/workers/automaton-worker.js`) ya usaban *lookup tables* `Uint8Array`
indexadas por número de vecinos, pero el motor estándar (`rule-engine.js`) y Generations
seguían usando `Set.has()` en el bucle más caliente. La estrategia general es **propagar el
patrón ya probado en el codebase a los motores rezagados**.

---

## Changelog

### 2026-06 — Tier 1 #1: `rule-engine.js` — `Set.has()` → lookup tables

El motor estándar (Conway, HighLife, Day & Night, y toda regla B/S) evaluaba
`this._survivalSet.has(n)` / `this._birthSet.has(n)` **por celda** en `nextGenerationMoore`
y `computeNextState`.

**Cambio:**
- `_birthSet`/`_survivalSet` → `_birthLUT`/`_survivalLUT` (`Uint8Array(441)`), construidas en
  `setRule()`. Tamaño 441 = máx. de vecinos Moore con el radio máximo (10), por lo que el
  *general-path* nunca lee fuera de rango.
- Hot-loop: `current ? sLUT[n] : bLUT[n]` en lugar de `Set.has(n)`.
- LUT cacheadas en variables locales fuera del doble bucle.

**Resultado (Conway 400×400):**

| Métrica  | Antes (Set) | Después (LUT) | Mejora   |
|----------|-------------|---------------|----------|
| step avg | ~3.10 ms    | ~2.07 ms      | **−33%** |
| gen/s    | ~322        | ~484          | **+50%** |

### 2026-06 — Tier 1 #2: `generations-engine.js` — eliminar `Set` por step + LUT

`step()` asignaba **dos `new Set()` por generación** (`new Set(this.birth)`,
`new Set(this.survival)`) además de usar `Set.has()` en el hot-loop — allocations y presión
de GC en cada frame.

**Cambio:**
- LUT `Uint8Array(9)` (`_birthLUT`/`_survivalLUT`) construidas una vez en `activate()`
  (Generations fija la regla siempre vía `activate`, no hay *setRule* en caliente).
- Hot-loop usa las LUT; cero allocations por step.

**Resultado (Generations B36/S23/C4 400×400):**

| Métrica  | Antes (Set ×2) | Después (LUT) | Mejora   |
|----------|----------------|---------------|----------|
| step avg | ~2.55 ms       | ~1.96 ms      | **−23%** |
| gen/s    | ~392           | ~509          | **+30%** |

> Nota: estos tiempos de *step* aún incluyen la segunda pasada N² de `countPopulation()`
> (resuelto en #4), por lo que la mejora real del bucle de regla es mayor que el %
> mostrado — el costo fijo del recuento de población diluye el porcentaje.

### 2026-06 — Tier 2 #4: `cellular-automaton.js` — población incremental

`core.step()` llamaba a `gridManager.countPopulation()` (una pasada N² completa) en
**cada** generación, además del N² del propio bucle de regla — duplicando el trabajo.

**Cambio:**
- El core mantiene `_population` con un flag `_populationValid`. `step()` con baseline
  válido solo suma el delta `births - deaths` (que el bucle de regla ya calcula); si el
  baseline es inválido, el recuento post-swap es directamente la población nueva.
- `invalidatePopulation()` / `getPopulation()` (recuento perezoso y cacheado).
- Invalidación en `setCell`, `resize`, `deserialize`; `clear` fija población 0.
- `automaton.updateStats()` invalida el baseline — es el único lector de población
  *fuera* del hot-loop estándar (ediciones, resize, modos especiales), así que toda
  mutación del grid fuerza un recuento único en el siguiente step. `checkLimits()` usa
  `core.getPopulation()` cacheado. El *shift* toroidal preserva la población, no invalida.

**Correctitud:** verificada comparando la población incremental contra
`countPopulation()` real en cada step (100 steps, cero desajustes).

**Resultado (Conway 400×400, sobre el motor ya con LUT):**

| Métrica  | Antes (#1) | Después (#4) | Mejora   |
|----------|------------|--------------|----------|
| step avg | ~1.96 ms   | ~1.83 ms     | **−7%**  |
| gen/s    | ~494       | ~547         | **+11%** |

> Acumulado vs. la versión original con `Set`: **~322 → ~547 gen/s (+70%)**.

---

## Evaluadas y descartadas

### 2026-06 — #3: `hex-engine.js` — `push({x,y})` → índice empaquetado

**Hipótesis:** asignar un objeto `{x, y}` por celda cambiada en `_stepSync` generaba
presión de GC; empaquetar a entero `(c<<16)|r` la eliminaría.

**Resultado:** **sin mejora medible.** Benchmark Hex B2/S1234 400×400 (200 steps, misma
semilla, población final idéntica 93646): empaquetado ~582–602 gen/s vs. objetos
~573–603 gen/s — iguales dentro del ruido. V8 maneja los objetos efímeros `{x, y}` en la
nursery sin costo apreciable, y el cómputo de los 6 vecinos domina el step. Además, en la
app real los grids hex ≥100×100 usan el Worker, por lo que el path síncrono ni siquiera
corre para grids grandes. **Revertido** — el cambio añadía churn (hex-engine + hex-renderer)
sin beneficio. Confirma el valor del criterio "solo se conserva lo que mejora el benchmark".

## Pendientes (plan priorizado)

- **Tier 3** — `triangle-engine._stepSync`: reemplazar `% w`/`% h` por ternarios en el
  path wrap; `_changedCells` a `Uint32Array` preasignado en Generations/Hex;
  `langton._DIRS` de objetos `{dx,dy}` a `Int8Array`.
