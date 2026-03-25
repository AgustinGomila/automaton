/**
 * grid-autofit.js
 *
 * Detecta el tamaño óptimo de la cuadrícula al inicio de la app,
 * midiendo el espacio real disponible para el canvas después de que
 * el layout se haya pintado.
 *
 * Estrategia:
 *   1. Espera a que app:ready sea emitido (automaton + UI listos).
 *   2. Mide el área disponible del canvas-wrapper usando getBoundingClientRect.
 *   3. Calcula gridWidth = floor(availableWidth / cellSize),
 *              gridHeight = floor(availableHeight / cellSize).
 *   4. Aplica el resize y sincroniza sliders + badge.
 *
 * Solo se ejecuta una vez al inicio. No reemplaza el resize manual del usuario.
 * En móvil no actúa (ResponsiveController ya fija 200×200).
 *
 * Cargar después de grid-rect-integration.js.
 */

(function initGridAutofit() {
    'use strict';

    /** Margen de seguridad en píxeles para no llegar justo al borde del scroll. */
    const MARGIN_PX = 8;

    /** Mínimo de celdas por eje para que el autofit tenga sentido. */
    const MIN_CELLS = 20;

    /** Tamaño máximo permitido (mismo límite que GridManager). */
    const MAX_CELLS = 1000;

    /**
     * Mide el área disponible para el canvas y devuelve {w, h} en píxeles.
     * Usa el contenedor .canvas-wrapper que es el scroll-parent directo del canvas.
     *
     * @returns {{ w: number, h: number } | null}
     */
    function measureAvailableArea() {
        const wrapper = document.querySelector('.canvas-wrapper');
        if (!wrapper) return null;

        const rect = wrapper.getBoundingClientRect();

        // Descontar el padding del canvas-container (10px × 2 lados = 20px)
        const containerPadding = 20;

        const w = Math.floor(rect.width - containerPadding - MARGIN_PX);
        const h = Math.floor(rect.height - containerPadding - MARGIN_PX);

        return w > 0 && h > 0 ? {w, h} : null;
    }

    /**
     * Calcula el tamaño óptimo del grid dado el área disponible y el cellSize.
     *
     * @param {{ w: number, h: number }} area
     * @param {number} cellSize
     * @returns {{ gridWidth: number, gridHeight: number }}
     */
    function computeOptimalSize(area, cellSize) {
        const cs = Math.max(1, cellSize);
        const gridWidth = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(area.w / cs)));
        const gridHeight = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(area.h / cs)));
        return {gridWidth, gridHeight};
    }

    /**
     * Aplica el tamaño óptimo al autómata y sincroniza todos los controles UI.
     *
     * @param {CellularAutomaton} automaton
     * @param {UIController}      uiController
     * @param {number}            gridWidth
     * @param {number}            gridHeight
     */
    function applyOptimalSize(automaton, uiController, gridWidth, gridHeight) {
        // Evitar resize innecesario si ya coincide
        if (automaton.gridWidth === gridWidth && automaton.gridHeight === gridHeight) return;

        automaton.resizeGrid(gridWidth, gridHeight);

        // ── Sincronizar sliders rectangulares ─────────────────────────────
        const wSlider = document.getElementById('gridWidth');
        const hSlider = document.getElementById('gridHeight');
        const wDisplay = document.getElementById('gridWidthValue');
        const hDisplay = document.getElementById('gridHeightValue');
        const badge = document.getElementById('gridDimensionsBadge');

        if (wSlider) wSlider.value = gridWidth;
        if (hSlider) hSlider.value = gridHeight;
        if (wDisplay) wDisplay.textContent = gridWidth;
        if (hDisplay) hDisplay.textContent = gridHeight;
        if (badge) {
            badge.textContent = `${gridWidth}×${gridHeight}`;
            badge.classList.toggle('rect-badge', gridWidth !== gridHeight);
        }

        // ── Sincronizar slider legacy (#gridSize) si existe ───────────────
        const legacySlider = document.getElementById('gridSize');
        const legacyDisplay = document.getElementById('gridSizeValue');
        const maxDim = Math.max(gridWidth, gridHeight);
        if (legacySlider) legacySlider.value = maxDim;
        if (legacyDisplay) legacyDisplay.textContent = `${gridWidth}×${gridHeight}`;

        // ── Notificar en consola para facilitar ajuste manual ─────────────
        console.info(
            `🔲 Grid autofit: ${gridWidth}×${gridHeight} ` +
            `(cellSize=${automaton.cellSize}, ` +
            `viewport=${window.innerWidth}×${window.innerHeight})`
        );
    }

    /**
     * Punto de entrada principal.
     * Se llama una vez cuando app:ready es emitido.
     */
    function run() {
        const app = window.app;
        if (!app?.automaton || !app?.uiController) return;

        const automaton = app.automaton;
        const uiController = app.uiController;

        // En móvil, ResponsiveController ya gestiona el tamaño → no interferir
        if (window.innerWidth <= 768) return;

        const area = measureAvailableArea();
        if (!area) return;

        const {gridWidth, gridHeight} = computeOptimalSize(area, automaton.cellSize);
        applyOptimalSize(automaton, uiController, gridWidth, gridHeight);
    }

    // Esperar a que el layout esté completamente pintado antes de medir.
    // app:ready dispara cuando el autómata y la UI están listos, pero el
    // layout puede no haber alcanzado su tamaño definitivo todavía.
    // Dos rAF garantizan que el navegador haya completado al menos un ciclo
    // de layout + paint antes de medir getBoundingClientRect().
    eventBus.on('app:ready', () => {
        requestAnimationFrame(() => {
            requestAnimationFrame(run);
        });
    });

})();