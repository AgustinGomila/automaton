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

window.AppConfig = Object.freeze({

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
    }),

    // =========================================================================
    // RENDER
    // =========================================================================
    RENDER: Object.freeze({
        /** Umbral de % dirty cells para degradar a full-render (0-1). */
        FULL_RENDER_THRESHOLD: 0.15,

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
        TRIANGLE_THRESHOLD: 100
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