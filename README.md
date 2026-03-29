# Automata Celular Interactivo

![ES](https://flagcdn.com/w20/es.png) Español — ![EN](https://flagcdn.com/w20/gb.png) [English](README_en.md)

Simulador interactivo de autómatas celulares que corre íntegramente en el navegador, sin dependencias ni build system.
Soporta autómatas 2D clásicos con reglas B/S, siete motores especiales, grids rectangulares independientes, edición
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

### Edición e Interacción

- Dibujo libre, bote de pintura (flood fill) y selección rectangular
- Mover, copiar y pegar áreas seleccionadas
- Rotación de patrones (clic derecho o tecla R)
- Historial undo/redo ilimitado (Ctrl+Z / Ctrl+Shift+Z)
- Importar y exportar patrones en formato RLE y MCL (WireWorld)
- Librería de patrones predefinidos filtrada por modo activo
- Randomize con densidad configurable

### Rendimiento

- Dirty rendering: solo renderiza las celdas modificadas
- **ImageData + Uint32Array**: renderizado por pixel buffer — reemplaza N× fillRect por 1× putImageData
- **Dirty bounding box**: putImageData con dirty-rect, transfiriendo solo la región modificada al framebuffer
- **Módulo WASM** (`wasm-renderer.js`): fill_full y fill_dirty compilados en WebAssembly, con memoria compartida con
  ImageData (zero-copy). Activo automáticamente en Conway, Wolfram, ETA y Generations; fallback JS para Langton,
  WireWorld y RD-2D
- Worker en hilo separado para grids grandes (modo estándar y triangular)
- Renderer WebGL2 acelerado para el grid triangular (fallback a Canvas 2D)
- Grid de hasta 2000×2000 celdas
- 10 niveles de velocidad con control de pasos por frame

### UI

- Diseño responsivo: funciona en móvil y escritorio
- Internacionalización ES/EN
- Notificaciones temporales no bloqueantes
- Indicador de modo activo con detalles de regla

---

## Controles

### Ratón y Teclado en el Canvas

| Acción                           | Resultado                                 |
|----------------------------------|-------------------------------------------|
| Clic izquierdo                   | Dibuja celda o coloca patrón seleccionado |
| Clic derecho                     | Rota el patrón seleccionado 90°           |
| Arrastrar                        | Dibuja libremente                         |
| Shift + Arrastrar                | Selecciona área rectangular               |
| Alt + Arrastrar                  | Pan (desplaza la vista)                   |
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
| I         | Performance                 |
| C         | Limpiar                     |
| G         | Mostrar / Ocultar grilla    |
| H         | Mostrar / Ocultar resaltado |
| ?         | Ayuda                       |

---

## Stack

- **Lenguaje**: JavaScript (ES2022+), HTML5, CSS3
- **Renderizado**: Canvas 2D API, WebGL2, WebAssembly (WAT)
- **Concurrencia**: Web Workers
- **Sin frameworks, sin build system, sin dependencias externas**

---

## Estructura del Proyecto

```
automaton/
├── index.html                       # Entrada principal, estructura UI
├── main.css                         # Estilos globales
│
├── main.js                          # Bootstrap: instancia y conecta todos los módulos
│
├── -- Nucleo --
├── automaton.js                     # Coordinador principal de la simulacion
├── automaton-loop.js                # Bucle de animacion (requestAnimationFrame)
├── cellular-automaton.js            # Core CA: aplica reglas B/S sobre el grid
├── grid-manager.js                  # Grid bidimensional Uint8Array[], doble buffer
├── rule-engine.js                   # Motor de reglas B/S, parse de cadenas
├── neighborhood-calculator.js       # Vecindarios Moore y Von Neumann con radio
├── state-manager.js                 # Historial undo/redo, import/export de patrones
├── edit-coordinator.js              # Operaciones de edicion del grid (cortar, pegar, etc.)
├── simulator-limiter.js             # Limites de generacion y poblacion
├── circular-array.js                # Buffer circular para historial
├── config.js                        # Configuracion centralizada (AppConfig: limites, defaults, colores)
├── event-bus.js                     # Bus de eventos global (pub/sub)
│
├── -- Motores Especiales --
├── special-engine-manager.js        # Orquesta activacion y ciclo de vida de motores
├── wolfram-engine.js                # Automata 1D de Wolfram (reglas 0-255)
├── rd2d-engine.js                   # Distincion Recursiva 2D (16 estados)
├── triangle-engine.js               # Automata Triangular Elemental (ETA)
├── triangle-grid-manager.js         # Grid triangular con logica de vecindad
├── triangle-worker.js               # Worker para calculo del ETA
├── triangle-worker-manager.js       # Gestor del worker triangular
├── generations-engine.js            # Generations: extension multiestado de reglas B/S
├── ulam-warburton-engine.js         # Fractal de Ulam-Warburton
├── langton-engine.js                # Hormiga de Langton multi-agente
├── wireworld-engine.js              # WireWorld (4 estados: vacio, cabeza, cola, conductor)
│
├── -- Renderizado --
├── grid-renderer.js                 # Renderer Canvas 2D con dirty rendering y efectos
├── wasm-renderer.js                 # Módulo WASM para fill_full/fill_dirty (zero-copy con ImageData)
├── triangle-renderer.js             # Renderer Canvas 2D para grid triangular
├── triangle-webgl2-renderer.js      # Renderer WebGL2 para grid triangular
├── automaton-worker.js              # Worker para calculo del grid estandar
├── grid-worker-manager.js           # Gestor del worker estandar
│
├── -- Controladores UI --
├── ui-controller.js                 # Coordinador principal de UI
├── canvas-controller.js             # Interaccion con el canvas (dibujo, pan, teclas)
├── drawing-tool.js                  # Pincel con interpolacion Bresenham y flood fill
├── selection-manager.js             # Seleccion rectangular, arrastre y copia de areas
├── display-controller.js            # Header: regla activa, vecindad, indicador de modo
├── special-mode-controller.js       # Coordinacion de activacion de motores especiales
├── special-mode-ui.js               # Paneles, toggles e indicadores de modos especiales
├── grid-controller.js               # Dimensiones del grid, zoom y autofit
├── import-export-controller.js      # Importacion y exportacion de patrones (RLE, MCL)
├── rule-neighborhood-controller.js  # Selector de reglas B/S y grilla visual de vecindad
├── effects-controller.js            # Efecto de actividad, area de influencia y colores
├── responsive-controller.js         # Adaptacion a distintos tamanios de pantalla
├── welcome-modal.js                 # Modal de bienvenida
│
├── -- Utilidades de arranque --
├── grid-autofit.js                  # Ajuste automatico del grid al espacio disponible
│
├── -- Datos y Codecs --
├── patterns.js                      # Libreria de patrones con filtrado por modo
├── pattern-loader.js                # Carga y gestion de la libreria de patrones
├── rules.js                         # Definicion de reglas B/S predefinidas
├── rules-loader.js                  # Carga de reglas
├── rle-codec.js                     # Codec RLE para importacion/exportacion de patrones
├── mcl-codec.js                     # Codec MCL para patrones WireWorld
├── i18n.js                          # Internacionalizacion ES/EN
│
├── patterns.json                    # Patrones predefinidos (RLE)
└── rules.json                       # Reglas predefinidas
```

---

## Referencias

- Conway's Game of Life: [Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
- Reglas de autómatas: [LifeWiki](https://conwaylife.com/wiki/)
- Autómatas de Wolfram: [Wikipedia](https://en.wikipedia.org/wiki/Elementary_cellular_automaton)
- Autómata triangular: [triangular-automata.net](https://triangular-automata.net)
- Louis Kauffman: [Mathematics Genealogy](https://www.mathgenealogy.org/id.php?id=4492)
- Ruliología: [Wolframcloud](https://www.wolframcloud.com/obj/international-essays/Published/WhatIsRuliology_ES.nb)