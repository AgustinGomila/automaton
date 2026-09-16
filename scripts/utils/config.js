/**
 * config.js — Configuración centralizada de la aplicación.
 *
 * Todos los literales numéricos y booleanos que afectan comportamiento
 * en más de un archivo viven aquí. Modificar este archivo es suficiente
 * para ajustar los límites globales de la app.
 *
 * Convención de uso:
 *   const { GRID, RENDER, WORKER, STATE } = window.AppConfig;
 */

export const AppConfig = Object.freeze({

    // =========================================================================
    // GRID
    // =========================================================================
    GRID: Object.freeze({
        /** Dimensiones por defecto al arrancar (celdas). */
        DEFAULT_WIDTH: 500,
        DEFAULT_HEIGHT: 500,

        /** Mínimo de celdas por eje. */
        MIN_CELLS: 20,

        /** Máximo de celdas por eje. */
        MAX_CELLS: 2000,

        /** Tamaño de celda por defecto (px). */
        DEFAULT_CELL_SIZE: 1,

        /** Rango de zoom (px/celda). */
        MIN_CELL_SIZE: 1,
        MAX_CELL_SIZE: 20,

        /** Intervalo de líneas de énfasis en la grilla visual. */
        MAJOR_INTERVAL: 10,

        /** Grilla visual activada por defecto. */
        DEFAULT_SHOW_GRID: false,

        /** Resaltado de líneas principales activado por defecto. */
        DEFAULT_SHOW_HIGHLIGHTS: false,

        /**
         * Padding del #canvas-container (10px × 2 lados = 20px) que se descuenta
         * del área disponible al calcular cuántas celdas caben en pantalla.
         * Debe coincidir con la propiedad padding del selector #canvas-container en main.css.
         */
        CANVAS_MARGIN: 20,
    }),

    // =========================================================================
    // RENDER
    // =========================================================================
    RENDER: Object.freeze({
        /** Umbral de % dirty cells para degradar a full-render (0-1). */
        FULL_RENDER_THRESHOLD: 0.15,

        /**
         * cellSize máximo para usar el path ImageData/WASM (putImageData,
         * 1 transferencia/frame). Cubre todo el rango de zoom: el kernel pinta
         * bloques sólidos de cellSize×cellSize sin borde, igual a cualquier zoom.
         * Por encima de este valor (no alcanzable hoy: == MAX_CELL_SIZE) se usa
         * el path fillRect, que pinta celda a celda con un borde de 1px.
         */
        PIXEL_PATH_MAX_CELL_SIZE: 20,

        /**
         * Tope de píxeles del canvas (gridW×cellSize × gridH×cellSize) para
         * habilitar el path pixel. Por encima, el framebuffer RGBA extra sería
         * demasiado grande → se cae al path fillRect, que no asigna buffer propio.
         * 32M px ≈ 128 MB de buffer RGBA.
         */
        PIXEL_PATH_MAX_CANVAS_PIXELS: 32_000_000,

        /**
         * Frames de cooldown del efecto de actividad.
         * Controla cuántos frames permanece visible el color born/dying.
         */
        ACTIVITY_COOLDOWN: 3,

        /** Colores por defecto de los 4 estados binarios. */
        COLOR_DEAD: '#0f172a',
        COLOR_ALIVE: '#059669',
        COLOR_BORN: '#b9b610',
        COLOR_DYING: '#ef4444',
    }),

    // =========================================================================
    // WORKER
    // =========================================================================
    WORKER: Object.freeze({
        /**
         * max(gridWidth, gridHeight) mínimo para activar el Web Worker.
         * Por debajo de este valor el step corre en el hilo principal.
         */
        THRESHOLD: 600,
        TRIANGLE_THRESHOLD: 100,

        /**
         * Intervalo (ms) de AnimationLoop que marca la banda de "máxima
         * velocidad" (niveles 6-10, todos con interval mínimo). En esa banda se
         * activan el pipeline del worker y el N adaptativo; por encima, las
         * velocidades bajas siguen moduladas por su intervalo.
         */
        MAX_SPEED_INTERVAL_MS: 16,

        /**
         * Objetivo de duración de frame (ms) para el N adaptativo. Con el worker
         * pipelineado, gen/s queda topado por el cómputo (~1/costo_por_paso)
         * independiente de N, así que se elige N para que cada frame dure ~esto
         * → ~60fps. Grid grande ⇒ N chico; grid chico ⇒ N grande.
         */
        TARGET_FRAME_MS: 16,

        /** Tope de pasos/frame del N adaptativo (evita batches enormes en grids chicos). */
        MAX_ADAPTIVE_STEPS: 64,

        /** Suavizado EMA del N adaptativo (mayor = converge más rápido, más ruidoso). */
        ADAPTIVE_ALPHA: 0.25
    }),

    // =========================================================================
    // ESTADO / HISTORIAL
    // =========================================================================
    STATE: Object.freeze({
        /** Máximo de pasos en la pila de undo/redo. */
        MAX_HISTORY: 50,

        /** Máximo de muestras de población en el historial. */
        MAX_POPULATION_HISTORY: 100,
    }),

    // =========================================================================
    // VECINDAD
    // =========================================================================
    NEIGHBORHOOD: Object.freeze({
        /** Radio de vecindad por defecto. */
        DEFAULT_RADIUS: 1,

        /** Radio mínimo. */
        MIN_RADIUS: 1,

        /** Radio máximo. */
        MAX_RADIUS: 10,
    }),
});