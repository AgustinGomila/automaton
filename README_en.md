# Interactive Cellular Automaton

![EN](https://flagcdn.com/w20/gb.png) English — ![ES](https://flagcdn.com/w20/es.png) [Español](README.md)

An interactive cellular automaton simulator that runs entirely in the browser, with no dependencies or build system.
Supports classic 2D B/S automata, seven special engines, independent rectangular grids, full grid editing, and ES/EN
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

- **Wolfram 1D** — One-dimensional elementary automata (rules 0–255), vertical or horizontal evolution, free drawing as
  seed
- **RD-2D** — 2D Recursive Distinction with 16 states encoding N/S/E/W boundaries and XOR rule
- **ETA (Elementary Triangular Automaton)** — Triangular grid with Wolfram-style rules, edge and vertex modes,
  destroboscope
- **Generations** — Multi-state extension of B/S rules with N decay states and configurable color palette
- **Ulam-Warburton** — Two-dimensional fractal with free drawing and randomize
- **Langton's Ant** — Multi-agent, multi-color with configurable rules and presets
- **WireWorld** — Electronic circuit simulation with 4 states (empty, head, tail, conductor); free drawing, import and
  export in MCL format

### Editing and Interaction

- Free drawing, paint bucket (flood fill), and rectangular selection
- Move, copy, and paste selected areas
- Pattern rotation (right-click or R key)
- Unlimited undo/redo history (Ctrl+Z / Ctrl+Shift+Z)
- Import and export patterns in RLE and MCL (WireWorld) formats
- Predefined pattern library filtered by active mode
- Randomize with configurable density

### Performance

- Dirty rendering: only re-renders modified cells
- Background worker thread for large grids (standard and triangular modes)
- WebGL2 accelerated renderer for the triangular grid (Canvas 2D fallback)
- 10 speed levels with steps-per-frame control

### UI

- Responsive design: works on mobile and desktop
- ES/EN internationalization
- Non-blocking temporary notifications
- Active mode indicator with rule details

---

## Controls

### Mouse and Keyboard on the Canvas

| Action                            | Result                              |
|-----------------------------------|-------------------------------------|
| Left click                        | Draw cell or place selected pattern |
| Right click                       | Rotate selected pattern 90°         |
| Drag                              | Draw freely                         |
| Shift + Drag                      | Select rectangular area             |
| Alt + Drag                        | Pan (scroll the view)               |
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
| I         | Performance            |
| C         | Clear                  |
| G         | Show / Hide grid       |
| H         | Show / Hide highlights |
| ?         | Help                   |

---

## Stack

- **Language**: JavaScript (ES2022+), HTML5, CSS3
- **Rendering**: Canvas 2D API, WebGL2
- **Concurrency**: Web Workers
- **No frameworks, no build system, no external dependencies**

---

## Project Structure

```
automaton/
├── index.html                       # Main entry point, UI structure
├── main.css                         # Global styles
│
├── main.js                          # Bootstrap: instantiates and connects all modules
│
├── -- Core --
├── automaton.js                     # Main coordinator of the simulation
├── automaton-loop.js                # Animation loop (requestAnimationFrame)
├── cellular-automaton.js            # CA core: applies B/S rules on the grid
├── grid-manager.js                  # 2D grid Uint8Array[], double buffer
├── rule-engine.js                   # B/S rule engine, rule string parser
├── neighborhood-calculator.js       # Moore and Von Neumann neighborhoods with radius
├── state-manager.js                 # Undo/redo history, pattern import/export
├── edit-coordinator.js              # Grid editing operations (cut, paste, clear, etc.)
├── simulator-limiter.js             # Generation and population limits
├── circular-array.js                # Circular buffer for history
├── event-bus.js                     # Global event bus (pub/sub)
│
├── -- Special Engines --
├── special-engine-manager.js        # Orchestrates activation and lifecycle of engines
├── wolfram-engine.js                # Wolfram 1D automaton (rules 0-255)
├── rd2d-engine.js                   # 2D Recursive Distinction (16 states)
├── triangle-engine.js               # Elementary Triangular Automaton (ETA)
├── triangle-grid-manager.js         # Triangular grid with neighborhood logic
├── triangle-worker.js               # Worker for ETA computation
├── triangle-worker-manager.js       # Triangular worker manager
├── generations-engine.js            # Generations: multi-state extension of B/S rules
├── ulam-warburton-engine.js         # Ulam-Warburton fractal
├── langton-engine.js                # Multi-agent Langton's Ant
├── wireworld-engine.js              # WireWorld (4 states: empty, head, tail, conductor)
│
├── -- Rendering --
├── grid-renderer.js                 # Canvas 2D renderer with dirty rendering and effects
├── triangle-renderer.js             # Canvas 2D renderer for triangular grid
├── triangle-webgl2-renderer.js      # WebGL2 renderer for triangular grid
├── automaton-worker.js              # Worker for standard grid computation
├── grid-worker-manager.js           # Standard worker manager
│
├── -- UI Controllers --
├── ui-controller.js                 # Main UI coordinator
├── canvas-controller.js             # Canvas interaction (drawing, pan, keyboard)
├── drawing-tool.js                  # Bresenham pencil interpolation and flood fill
├── selection-manager.js             # Rectangular selection, drag and copy of areas
├── display-controller.js            # Header: active rule, neighborhood, mode indicator
├── special-mode-controller.js       # Coordination of special engine activation
├── special-mode-ui.js               # Panels, toggles and indicators for special modes
├── grid-controller.js               # Grid dimensions, zoom and autofit
├── import-export-controller.js      # Pattern import and export (RLE, MCL)
├── rule-neighborhood-controller.js  # B/S rule selector and neighborhood visual grid
├── effects-controller.js            # Activity effect, influence area and colors
├── responsive-controller.js         # Adaptation to different screen sizes
├── welcome-modal.js                 # Welcome modal
│
├── -- Startup Utilities --
├── grid-autofit.js                  # Automatic grid fit to available space on load
│
├── -- Data and Codecs --
├── patterns.js                      # Pattern library with mode-based filtering
├── pattern-loader.js                # Pattern library loading and management
├── rules.js                         # Predefined B/S rule definitions
├── rules-loader.js                  # Rule loader
├── rle-codec.js                     # RLE codec for pattern import/export
├── mcl-codec.js                     # MCL codec for WireWorld patterns
├── i18n.js                          # ES/EN internationalization
│
├── patterns.json                    # Predefined patterns (RLE)
└── rules.json                       # Predefined rules
```

---

## References

- Conway's Game of Life: [Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
- Automaton rules: [LifeWiki](https://conwaylife.com/wiki/)
- Wolfram Automata: [Wikipedia](https://en.wikipedia.org/wiki/Elementary_cellular_automaton)
- Triangular automata: [triangular-automata.net](https://triangular-automata.net)
- Louis Kauffman: [Mathematics Genealogy](https://www.mathgenealogy.org/id.php?id=4492)
- Ruliology: [Wolfram Writings](https://writings.stephenwolfram.com/2026/01/what-is-ruliology/)