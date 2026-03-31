# Autómata Celular Interactivo

![ES](https://flagcdn.com/w20/es.png) Español — ![EN](https://flagcdn.com/w20/gb.png) [English](README_en.md)

Simulador interactivo de autómatas celulares que corre íntegramente en el navegador, sin dependencias ni build system.
Soporta autómatas 2D clásicos con reglas B/S, ocho motores especiales, grids rectangulares independientes, edición
completa del grid e internacionalización ES/EN.

**[Experimentar en vivo](https://agustingomila.github.io/automaton/)**

---

## Características

### Autómata Estándar 2D

- Más de 30 reglas B/S predefinidas: Conway B3/S23, HighLife, Day & Night, Kauffman y muchas más
- Regla personalizada: define tus propios parámetros B/S
- Vecindad Moore (8 vecinos) o Von Neumann (4 vecinos), con radio configurable (1–10)
- Grid rectangular: ancho y alto independientes con bloqueo de proporción y presets
- Wrap toroidal configurable

### Motores Especiales

- **Wolfram 1D** — Autómatas elementales unidimensionales (reglas 0–255), evolución vertical u horizontal, soporte de
  dibujo libre como semilla
- **RD-2D** — Distinción Recursiva 2D con 16 estados codificando bordes N/S/E/W y regla XOR
- **ETA (Autómata Triangular Elemental)** — Grid triangular con reglas tipo Wolfram adaptadas, modo borde y modo
  vértice, destroboscopio
- **Generations** — Extensión multiestado de las reglas B/S con N estados de decaimiento y paleta de colores
  configurable
- **Ulam-Warburton** — Fractal bidimensional con dibujo libre y randomize
- **Hormiga de Langton** — Multi-agente y multi-color con reglas configurables y presets
- **WireWorld** — Simulación de circuitos electrónicos con 4 estados (vacío, cabeza, cola, conductor); dibujo libre,
  importación y exportación en formato MCL
- **Hexagonal** — Autómata Life-like sobre malla hexagonal (6 vecinos, coordenadas offset odd-r); reglas B/S con
  dígitos 0–6, presets incluidos y dibujo libre sobre la geometría hex

### Edición e Interacción

- Dibujo libre, bote de pintura (flood fill) y selección rectangular
- Mover, copiar y pegar áreas seleccionadas con soporte de estados extendidos (Generations, WireWorld, Langton, RD-2D)
- Rotación de patrones (clic derecho o tecla R)
- Historial undo/redo ilimitado (Ctrl+Z / Ctrl+Shift+Z)
- Importar y exportar patrones en formato RLE y MCL (WireWorld)
- Librería de patrones predefinidos filtrada por modo activo
- Randomize con densidad configurable

### Rendimiento

- **Dirty rendering**: solo re-renderiza las celdas modificadas
- **ImageData + Uint32Array**: renderizado por pixel buffer — reemplaza N× fillRect por 1× putImageData
- **Dirty bounding box**: putImageData con dirty-rect, transfiriendo solo la región modificada al framebuffer
- **Módulo WASM** (`wasm-renderer.js`): fill_full y fill_dirty compilados en WebAssembly, con memoria compartida con
  ImageData (zero-copy). Activo en Conway, Wolfram, ETA y Generations; fallback JS para Langton, WireWorld y RD-2D
- **Ulam-Warburton — frontier tracking O(perímetro)**: en lugar de escanear N² celdas por paso, mantiene un
  `Set<number>` de candidatos actualizado incrementalmente. A 1000×1000 el paso es equivalente al de 400×400
- **RD-2D — vecinos inline**: el hot-loop calcula los 4 vecinos XOR directamente sin llamadas a `_getState()`,
  con loop column-major y `wrapEdges` cacheado fuera del doble bucle
- Worker en hilo separado para grids grandes (modo estándar y triangular)
- Renderer WebGL2 acelerado para el grid triangular (fallback a Canvas 2D)
- Grid de hasta 2000×2000 celdas
- 10 niveles de velocidad con control de pasos por frame

### UI

- Diseño responsivo: funciona en móvil y escritorio
- Internacionalización ES/EN con cambio en caliente
- Notificaciones temporales no bloqueantes
- Indicador de modo activo con detalles de regla
- Overlay de rendimiento (tecla I): gen/s, step ms, render ms

---

## Controles

### Ratón y Teclado en el Canvas

| Acción                           | Resultado                                 |
|----------------------------------|-------------------------------------------|
| Clic izquierdo                   | Dibuja celda o coloca patrón seleccionado |
| Clic derecho                     | Rota el patrón seleccionado 90°           |
| Arrastrar                        | Dibuja libremente                         |
| Shift + Arrastrar                | Selecciona área rectangular               |
| Alt + Arrastrar                  | Pan (desplaza la vista toroidalmente)     |
| Ctrl + Clic en selección         | Mueve el área                             |
| Ctrl + Shift + Clic en selección | Copia el área                             |
| Escape                           | Cancela selección o patrón activo         |
| Delete                           | Borra el contenido de la selección        |
| R                                | Rota el patrón seleccionado               |

### Atajos Globales

| Tecla     | Acción                      |
|-----------|-----------------------------|
| Espacio   | Ejecutar / Pausar           |
| S         | Paso siguiente              |
| +         | Aumentar velocidad          |
| -         | Reducir velocidad           |
| Z         | Deshacer                    |
| Shift + Z | Rehacer                     |
| A         | Aleatorio                   |
| B         | Bote de pintura             |
| I         | Overlay de rendimiento      |
| C         | Limpiar                     |
| G         | Mostrar / Ocultar grilla    |
| H         | Mostrar / Ocultar resaltado |
| ?         | Ayuda                       |

---

## Stack

- **Lenguaje**: JavaScript ES Modules (ES2022+), HTML5, CSS3
- **Renderizado**: Canvas 2D API, WebGL2, WebAssembly (WAT)
- **Concurrencia**: Web Workers
- **Sin frameworks, sin build system, sin dependencias externas**

---

## Arquitectura

### Módulos ES (ESM)

El proyecto usa ES Modules nativos del navegador. El punto de entrada es `scripts/main.js`
(`<script type="module">`). No hay bundler — el navegador resuelve el grafo de imports
directamente. Esto requiere servir los archivos desde un servidor HTTP (no funciona desde `file://`).

Los tres workers (`automaton-worker.js`, `triangle-worker.js`, `hex-worker.js`) permanecen como
scripts clásicos — corren en contextos Worker independientes donde no necesitan importar módulos del
hilo principal.

### Capas

```
main.js  ←  punto de entrada único
│
├── rulesLoader / patternLoader    ← datos cargados antes de construir la UI
├── CellularAutomaton              ← coordinador principal
│   ├── CellularAutomatonCore      ← motor matemático B/S
│   ├── GridRenderer               ← renderizado canvas/wasm
│   ├── GridWorkerManager          ← offload al worker
│   ├── SpecialEngineManager       ← lifecycle de motores especiales
│   ├── StateManager               ← historial undo/redo
│   ├── AnimationLoop              ← bucle RAF
│   ├── SimulationLimiter          ← límites de generación/población
│   └── EditCoordinator            ← operaciones de edición del grid
│
└── UIController                   ← coordinador de UI
    ├── CanvasController           ← interacción mouse/touch
    ├── DisplayController          ← header y estadísticas
    ├── SpecialModeController      ← activación de modos especiales
    ├── GridController             ← dimensiones y zoom
    ├── RuleController             ← selector de reglas B/S
    ├── NeighborhoodController     ← selector de vecindad
    ├── ImportExportController     ← RLE / MCL
    └── EffectsController          ← colores y efectos visuales
```

### Bus de Eventos

La comunicación entre capas usa `eventBus` (singleton exportado de `event-bus.js`).
Eventos principales:

| Evento                    | Emitido por           | Escuchado por                   |
|---------------------------|-----------------------|---------------------------------|
| `rules:loaded`            | RulesLoader           | CellularAutomaton, UIController |
| `automaton:ready`         | CellularAutomaton     | main.js                         |
| `app:ready`               | main.js               | grid-autofit.js                 |
| `stats:updated`           | CellularAutomaton     | DisplayController               |
| `automaton:ruleChanged`   | CellularAutomaton     | DisplayController               |
| `automaton:modeChanged`   | SpecialModeController | CanvasController                |
| `automaton:filterChanged` | SpecialModeUI         | PatternManager                  |
| `pattern:selected`        | PatternManager        | UIController, CanvasController  |
| `i18n:localeChanged`      | i18n                  | UIController                    |
| `history:changed`         | StateManager          | UIController                    |
| `perf:update`             | CellularAutomaton     | UIController                    |

### Carga Diferida de Motores Especiales

`SpecialEngineManager` carga los motores con `import()` dinámico la primera vez que se activan.
El navegador cachea el módulo — activaciones posteriores del mismo modo no producen ninguna
petición de red adicional.

Los modos Triangle y Hexagonal usan `Promise.all([...])` para cargar en paralelo todos sus
módulos (engine, grid manager, worker manager, renderer).

---

## Estructura del Proyecto

```
automaton/
├── index.html                          # Entrada principal, estructura UI
├── main.css                            # Estilos globales
│
└── scripts/
    ├── main.js                         # Bootstrap ESM: carga datos, instancia módulos
    ├── grid-autofit.js                 # Ajuste automático del grid al espacio disponible
    │
    ├── utils/
    │   ├── config.js                   # AppConfig: límites, defaults y colores (export const)
    │   └── circular-array.js           # Buffer circular para historial de población
    │
    ├── infrastructure/
    │   ├── event-bus.js                # EventBus singleton con on() / once() / emit()
    │   └── workers/
    │       ├── automaton-worker.js     # Worker estándar (script clásico, sin ESM)
    │       ├── grid-worker-manager.js  # Gestor del worker estándar
    │       ├── triangle-worker.js      # Worker ETA (script clásico, sin ESM)
    │       ├── triangle-worker-manager.js
    │       ├── hex-worker.js           # Worker hexagonal (script clásico, sin ESM)
    │       └── hex-worker-manager.js
    │
    ├── core/
    │   ├── cellular-automaton.js       # Core CA: aplica reglas B/S, doble buffer
    │   ├── grid-manager.js             # Grid Uint8Array[], serialización, shift toroidal
    │   ├── neighborhood-calculator.js  # Moore / Von Neumann con radio configurable
    │   ├── hex-engine.js               # Motor hexagonal Life-like (6 vecinos, odd-r)
    │   ├── hex-grid-manager.js         # Grid hexagonal pointy-top
    │   ├── triangle-engine.js          # Motor ETA con soporte de worker
    │   ├── triangle-grid-manager.js    # Grid triangular con lógica de vecindad
    │   └── engines/
    │       ├── rule-engine.js          # Motor de reglas B/S con fastpath Moore r1
    │       ├── special-engine-manager.js # Lifecycle de motores, import() dinámico
    │       ├── wolfram-engine.js       # Wolfram 1D (reglas 0-255)
    │       ├── rd2d-engine.js          # RD-2D 16 estados, vecinos inline, column-major
    │       ├── ulam-warburton-engine.js # UW fractal, frontier tracking O(perímetro)
    │       ├── langton-engine.js       # Langton multi-agente multi-color
    │       ├── wireworld-engine.js     # WireWorld 4 estados
    │       └── generations-engine.js  # Generations multiestado
    │
    ├── rendering/
    │   ├── grid-renderer.js            # Canvas 2D, dirty rendering, activity effect
    │   ├── wasm-renderer.js            # WASM fill_full/fill_dirty, zero-copy con ImageData
    │   ├── hex-renderer.js             # Hexagonal Path2D cacheado por zoom
    │   ├── triangle-renderer.js        # Canvas 2D para grid triangular
    │   └── triangle-webgl2-renderer.js # WebGL2 instanced para grid triangular
    │
    ├── app/
    │   ├── automaton.js                # CellularAutomaton: coordinador principal
    │   ├── automaton-loop.js           # AnimationLoop (RAF + stepsPerFrame)
    │   ├── simulator-limiter.js        # Límites de generación y población
    │   ├── state-manager.js            # Undo/redo, copy/paste con engineStates
    │   └── edit-coordinator.js         # Randomize, clear, import, export, shift, undo/redo
    │
    ├── config/
    │   ├── rules.js                    # Utilidades de parseo B/S (parseRuleString, etc.)
    │   ├── rules-loader.js             # Singleton rulesLoader, emite rules:loaded
    │   ├── patterns.js                 # PatternManager, rotateMatrix, getPatternWithRotation
    │   └── pattern-loader.js           # Singleton patternLoader, emite patterns:loaded
    │
    └── ui/
        ├── i18n.js                     # Singleton i18n + t(), emite i18n:localeChanged
        ├── ui-controller.js            # Coordinador principal de UI
        ├── canvas-controller.js        # Mouse/touch, dibujo, pan, selección
        ├── drawing-tool.js             # Pincel Bresenham + flood fill
        ├── selection-manager.js        # Selección rectangular, drag, copy/paste
        ├── display-controller.js       # Header: regla, vecindad, modo activo
        ├── special-mode-controller.js  # Activación/desactivación de modos especiales
        ├── special-mode-ui.js          # Paneles, toggles, indicadores de modo
        ├── grid-controller.js          # Dimensiones del grid, zoom, autofit
        ├── import-export-controller.js # Importación/exportación RLE y MCL
        ├── rule-neighborhood-controller.js # Selector B/S y grilla visual de vecindad
        ├── effects-controller.js       # Colores, activity effect, área de influencia
        ├── responsive-controller.js    # Adaptación móvil/escritorio
        ├── welcome-modal.js            # Modal de bienvenida
        ├── rle-codec.js                # Codec RLE
        └── mcl-codec.js                # Codec MCL (WireWorld)
```

---

## Despliegue

El proyecto no requiere build. Para servir localmente:

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code
# Live Server extension → clic derecho en index.html → "Open with Live Server"
```

> Los módulos ES no funcionan desde `file://`. Es necesario un servidor HTTP.

El servidor debe servir los archivos `.js` con `Content-Type: application/javascript`.
Los paths de los workers en `GridWorkerManager`, `TriangleWorkerManager` y `HexWorkerManager`
son relativos al documento HTML (no al módulo que los instancia) — mantener esta convención.

---

## Referencias

- Conway's Game of Life: [Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
- Reglas de autómatas: [LifeWiki](https://conwaylife.com/wiki/)
- Autómatas de Wolfram: [Wikipedia](https://en.wikipedia.org/wiki/Elementary_cellular_automaton)
- Autómata triangular: [triangular-automata.net](https://triangular-automata.net)
- Louis Kauffman: [Mathematics Genealogy](https://www.mathgenealogy.org/id.php?id=4492)
- Ruliología: [Wolframcloud](https://www.wolframcloud.com/obj/international-essays/Published/WhatIsRuliology_ES.nb)