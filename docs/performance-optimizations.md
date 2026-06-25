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
> (ver Pendientes #4), por lo que la mejora real del bucle de regla es mayor que el %
> mostrado — el costo fijo del recuento de población diluye el porcentaje.

---

## Pendientes (plan priorizado)

- **Tier 2 #4** — `cellular-automaton.js`: población incremental (`pop += births - deaths`)
  para eliminar la 2ª pasada N² de `countPopulation()` en cada step. *(Siguiente)*
- **Tier 1 #3** — `hex-engine.js`: `_changedCells.push({x, y})` (un objeto por celda) →
  buffer plano con índice empaquetado `(x<<16)|y`.
- **Tier 3** — `triangle-engine._stepSync`: reemplazar `% w`/`% h` por ternarios en el
  path wrap; `_changedCells` a `Uint32Array` preasignado en Generations/Hex;
  `langton._DIRS` de objetos `{dx,dy}` a `Int8Array`.
