# Interactive Cellular Automaton

![EN](https://flagcdn.com/w20/gb.png) English — ![ES](https://flagcdn.com/w20/es.png) [Español](README.md)

An interactive cellular automaton simulator that runs entirely in the browser, with no dependencies or build system.
Supports classic 2D B/S automata, eight special engines, independent rectangular grids, full grid editing, and ES/EN
internationalization.

**[Try it live](https://agustingomila.github.io/automaton/)**

---

## Features

### Standard 2D Automaton

- Over 30 predefined B/S rules: Conway B3/S23, HighLife, Day & Night, Kauffman, and many more
- Custom rule: define your own B/S parameters
- Moore (8 neighbors) or Von Neumann (4 neighbors) neighborhood, with configurable radius (1–10)
- Rectangular grid: independent width and height with aspect-ratio lock and presets
- Configurable toroidal wrap

### Special Engines

- **Wolfram 1D** — One-dimensional elementary automata (rules 0–255), vertical or horizontal evolution, free drawing
  as seed
- **RD-2D** — 2D Recursive Distinction with 16 states encoding N/S/E/W boundaries and XOR rule
- **ETA (Elementary Triangular Automaton)** — Triangular grid with Wolfram-style rules, edge and vertex modes,
  destroboscope
- **Generations** — Multi-state extension of B/S rules with N decay states and configurable color palette
- **Ulam-Warburton** — Two-dimensional fractal with free drawing and randomize
- **Langton's Ant** — Multi-agent, multi-color with configurable rules and presets
- **WireWorld** — Electronic circuit simulation with 4 states (empty, head, tail, conductor); free drawing, import and
  export in MCL format
- **Hexagonal** — Life-like automaton on a hexagonal grid (6 neighbors, odd-r offset coordinates); B/S rules with
  digits 0–6, built-in presets, and free drawing on the hex geometry

### Editing and Interaction

- Free drawing, paint bucket (flood fill), and rectangular selection
- Move, copy, and paste selected areas with extended-state support (Generations, WireWorld, Langton, RD-2D)
- Pattern rotation (right-click or R key)
- Unlimited undo/redo history (Ctrl+Z / Ctrl+Shift+Z)
- Import and export patterns in RLE and MCL (WireWorld) formats
- Predefined pattern library filtered by active mode
- Randomize with configurable density

### Performance

- **Dirty rendering**: only re-renders modified cells
- **ImageData + Uint32Array**: pixel buffer rendering — replaces N× fillRect with 1× putImageData
- **Dirty bounding box**: putImageData with dirty-rect, uploading only the modified region to the framebuffer
- **WASM module** (`wasm-renderer.js`): fill_full and fill_dirty compiled to WebAssembly with shared memory with
  ImageData (zero-copy). Active for Conway, Wolfram, ETA and Generations; JS fallback for Langton, WireWorld and RD-2D
- **Ulam-Warburton — frontier tracking O(perimeter)**: instead of scanning N² cells per step, maintains a
  `Set<number>` of candidates updated incrementally. At 1000×1000 the step time matches 400×400
- **RD-2D — inlined neighbors**: the hot-loop computes the 4 XOR neighbors inline without `_getState()` calls,
  using column-major loop order and cached `wrapEdges` outside the double loop
- Background worker thread for large grids (standard and triangular modes)
- WebGL2 accelerated renderer for the triangular grid (Canvas 2D fallback)
- Grid up to 2000×2000 cells
- 10 speed levels with steps-per-frame control

### UI

- Responsive design: works on mobile and desktop
- ES/EN internationalization with live switching
- Non-blocking temporary notifications
- Active mode indicator with rule details
- Performance overlay (I key): gen/s, step ms, render ms

---

## Controls

### Mouse and Keyboard on the Canvas

| Action                            | Result                              |
|-----------------------------------|-------------------------------------|
| Left click                        | Draw cell or place selected pattern |
| Right click                       | Rotate selected pattern 90°         |
| Drag                              | Draw freely                         |
| Shift + Drag                      | Select rectangular area             |
| Alt + Drag                        | Pan (scroll the view toroidally)    |
| Ctrl + Click on selection         | Move the area                       |
| Ctrl + Shift + Click on selection | Copy the area                       |
| Escape                            | Cancel selection or active pattern  |
| Delete                            | Clear the selection content         |
| R                                 | Rotate selected pattern             |

### Global Shortcuts

| Key       | Action                 |
|-----------|------------------------|
| Space     | Run / Pause            |
| S         | Next step              |
| +         | Increase speed         |
| -         | Decrease speed         |
| Z         | Undo                   |
| Shift + Z | Redo                   |
| A         | Random                 |
| B         | Paint bucket           |
| I         | Performance overlay    |
| C         | Clear                  |
| G         | Show / Hide grid       |
| H         | Show / Hide highlights |
| ?         | Help                   |

---

## Stack

- **Language**: JavaScript ES Modules (ES2022+), HTML5, CSS3
- **Rendering**: Canvas 2D API, WebGL2, WebAssembly (WAT)
- **Concurrency**: Web Workers
- **No frameworks, no build system, no external dependencies**

---

## Architecture

### ES Modules

The project uses native browser ES Modules. The entry point is `scripts/main.js`
(`<script type="module">`). No bundler — the browser resolves the import graph directly.
This requires serving files from an HTTP server (does not work from `file://`).

The three workers (`automaton-worker.js`, `triangle-worker.js`, `hex-worker.js`) remain as
classic scripts — they run in independent Worker contexts where they don't need to import
modules from the main thread.

### Layers

```
main.js  ←  single entry point
│
├── rulesLoader / patternLoader    ← data loaded before building the UI
├── CellularAutomaton              ← main coordinator
│   ├── CellularAutomatonCore      ← B/S math engine
│   ├── GridRenderer               ← canvas/wasm rendering
│   ├── GridWorkerManager          ← offload to worker
│   ├── SpecialEngineManager       ← special engine lifecycle
│   ├── StateManager               ← undo/redo history
│   ├── AnimationLoop              ← RAF loop
│   ├── SimulationLimiter          ← generation/population limits
│   └── EditCoordinator            ← grid editing operations
│
└── UIController                   ← UI coordinator
    ├── CanvasController           ← mouse/touch interaction
    ├── DisplayController          ← header and statistics
    ├── SpecialModeController      ← special mode activation
    ├── GridController             ← dimensions and zoom
    ├── RuleController             ← B/S rule selector
    ├── NeighborhoodController     ← neighborhood selector
    ├── ImportExportController     ← RLE / MCL
    └── EffectsController          ← colors and visual effects
```

### Event Bus

Cross-layer communication uses `eventBus` (singleton exported from `event-bus.js`).
Key events:

| Event                     | Emitted by            | Consumed by                     |
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

### Lazy Loading of Special Engines

`SpecialEngineManager` loads engines with dynamic `import()` the first time they are activated.
The browser caches the module — subsequent activations of the same mode produce no additional
network requests.

Triangle and Hexagonal modes use `Promise.all([...])` to load all their modules in parallel
(engine, grid manager, worker manager, renderer).

---

## Project Structure

```
automaton/
├── index.html                          # Main entry point, UI structure
├── main.css                            # Global styles
│
└── scripts/
    ├── main.js                         # ESM bootstrap: loads data, instantiates modules
    ├── grid-autofit.js                 # Auto-fits grid to available space on load
    │
    ├── utils/
    │   ├── config.js                   # AppConfig: limits, defaults and colors (export const)
    │   └── circular-array.js           # Circular buffer for population history
    │
    ├── infrastructure/
    │   ├── event-bus.js                # EventBus singleton with on() / once() / emit()
    │   └── workers/
    │       ├── automaton-worker.js     # Standard worker (classic script, no ESM)
    │       ├── grid-worker-manager.js  # Standard worker manager
    │       ├── triangle-worker.js      # ETA worker (classic script, no ESM)
    │       ├── triangle-worker-manager.js
    │       ├── hex-worker.js           # Hex worker (classic script, no ESM)
    │       └── hex-worker-manager.js
    │
    ├── core/
    │   ├── cellular-automaton.js       # CA core: applies B/S rules, double buffer
    │   ├── grid-manager.js             # Uint8Array[] grid, serialization, toroidal shift
    │   ├── neighborhood-calculator.js  # Moore / Von Neumann with configurable radius
    │   ├── hex-engine.js               # Hexagonal Life-like (6 neighbors, odd-r)
    │   ├── hex-grid-manager.js         # Pointy-top hexagonal grid
    │   ├── triangle-engine.js          # ETA engine with worker support
    │   ├── triangle-grid-manager.js    # Triangular grid with neighborhood logic
    │   └── engines/
    │       ├── rule-engine.js          # B/S rule engine with Moore r1 fastpath
    │       ├── special-engine-manager.js # Engine lifecycle, dynamic import()
    │       ├── wolfram-engine.js       # Wolfram 1D (rules 0-255)
    │       ├── rd2d-engine.js          # RD-2D 16 states, inlined neighbors, column-major
    │       ├── ulam-warburton-engine.js # UW fractal, O(perimeter) frontier tracking
    │       ├── langton-engine.js       # Multi-agent multi-color Langton's Ant
    │       ├── wireworld-engine.js     # WireWorld 4 states
    │       └── generations-engine.js  # Multi-state Generations
    │
    ├── rendering/
    │   ├── grid-renderer.js            # Canvas 2D, dirty rendering, activity effect
    │   ├── wasm-renderer.js            # WASM fill_full/fill_dirty, zero-copy ImageData
    │   ├── hex-renderer.js             # Hex Path2D cached per zoom level
    │   ├── triangle-renderer.js        # Canvas 2D for triangular grid
    │   └── triangle-webgl2-renderer.js # WebGL2 instanced for triangular grid
    │
    ├── app/
    │   ├── automaton.js                # CellularAutomaton: main coordinator
    │   ├── automaton-loop.js           # AnimationLoop (RAF + stepsPerFrame)
    │   ├── simulator-limiter.js        # Generation and population limits
    │   ├── state-manager.js            # Undo/redo, copy/paste with engineStates
    │   └── edit-coordinator.js         # Randomize, clear, import, export, shift, undo/redo
    │
    ├── config/
    │   ├── rules.js                    # B/S parse utilities (parseRuleString, etc.)
    │   ├── rules-loader.js             # rulesLoader singleton, emits rules:loaded
    │   ├── patterns.js                 # PatternManager, rotateMatrix, getPatternWithRotation
    │   └── pattern-loader.js           # patternLoader singleton, emits patterns:loaded
    │
    └── ui/
        ├── i18n.js                     # i18n singleton + t(), emits i18n:localeChanged
        ├── ui-controller.js            # Main UI coordinator
        ├── canvas-controller.js        # Mouse/touch, drawing, pan, selection
        ├── drawing-tool.js             # Bresenham brush + flood fill
        ├── selection-manager.js        # Rectangular selection, drag, copy/paste
        ├── display-controller.js       # Header: rule, neighborhood, active mode
        ├── special-mode-controller.js  # Special mode activation/deactivation
        ├── special-mode-ui.js          # Panels, toggles, mode indicators
        ├── grid-controller.js          # Grid dimensions, zoom, autofit
        ├── import-export-controller.js # RLE and MCL import/export
        ├── rule-neighborhood-controller.js # B/S selector and neighborhood grid
        ├── effects-controller.js       # Colors, activity effect, influence area
        ├── responsive-controller.js    # Mobile/desktop adaptation
        ├── welcome-modal.js            # Welcome modal
        ├── rle-codec.js                # RLE codec
        └── mcl-codec.js                # MCL codec (WireWorld)
```

---

## Deployment

The project requires no build. To serve locally:

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code
# Live Server extension → right-click index.html → "Open with Live Server"
```

> ES Modules do not work from `file://`. An HTTP server is required.

The server must serve `.js` files with `Content-Type: application/javascript`.
Worker paths in `GridWorkerManager`, `TriangleWorkerManager` and `HexWorkerManager`
are relative to the HTML document (not to the module that instantiates them) — keep this convention.

---

## References

- Conway's Game of Life: [Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
- Automaton rules: [LifeWiki](https://conwaylife.com/wiki/)
- Wolfram Automata: [Wikipedia](https://en.wikipedia.org/wiki/Elementary_cellular_automaton)
- Triangular automata: [triangular-automata.net](https://triangular-automata.net)
- Louis Kauffman: [Mathematics Genealogy](https://www.mathgenealogy.org/id.php?id=4492)
- Ruliology: [Wolfram Writings](https://writings.stephenwolfram.com/2026/01/what-is-ruliology/)