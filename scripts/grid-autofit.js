/**
 * grid-autofit.js
 *
 * Detecta el tamaño óptimo de la cuadrícula al inicio de la app,
 * midiendo el espacio real disponible para el canvas una vez que
 * el layout se ha pintado.
 *
 * Funciona tanto en desktop como en móvil. En móvil el panel izquierdo
 * está oculto (drawer) y el canvas-wrapper ocupa toda la pantalla menos
 * el header y la barra de patrones, por lo que el cálculo se hace sobre
 * el viewport en lugar del wrapper (que puede tener height:0 si aún
 * no se renderizó el layout flex).
 *
 * Cargar después de grid-rect-integration.js y responsive-controller.js.
 */

(function initGridAutofit() {
    'use strict';

    /** Margen de seguridad para no tocar el borde del scroll. */
    const MARGIN_PX = 6;

    /** Mínimo de celdas por eje. */
    const MIN_CELLS = AppConfig.GRID.MIN_CELLS;

    /** Máximo permitido (igual a GridManager). */
    const MAX_CELLS = AppConfig.GRID.MAX_CELLS;

    /**
     * Mide el área real disponible para el canvas.
     *
     * Desktop: usa getBoundingClientRect sobre .canvas-wrapper que ya
     *          tiene su altura definitiva dentro del layout flex.
     *
     * Mobile:  el canvas-wrapper puede estar colapsado o con scroll.
     *          Se calcula como: viewport - header - stats - patterns bar - gaps.
     *
     * @returns {{ w: number, h: number } | null}
     */
    function measureAvailableArea() {
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            return measureMobile();
        }

        // ── Desktop: medir el wrapper directamente ────────────────────────
        const wrapper = document.querySelector('.canvas-wrapper');
        if (!wrapper) return null;

        const rect = wrapper.getBoundingClientRect();
        // Descontar el padding del #canvas-container (AppConfig.GRID.CANVAS_MARGIN)
        const w = Math.floor(rect.width - AppConfig.GRID.CANVAS_MARGIN - MARGIN_PX);
        const h = Math.floor(rect.height - AppConfig.GRID.CANVAS_MARGIN - MARGIN_PX);
        return (w > 0 && h > 0) ? {w, h} : null;
    }

    /**
     * Calcula el área disponible en móvil sustrayendo las alturas reales
     * de header, stats y patterns bar al viewport.
     */
    function measureMobile() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Medir componentes que consumen espacio vertical
        const headerEl = document.querySelector('header');
        const statsEl = document.querySelector('.stats');
        const patternsEl = document.querySelector('.patterns-horizontal-container');

        const headerH = headerEl ? headerEl.getBoundingClientRect().height : 60;
        const statsH = statsEl ? statsEl.getBoundingClientRect().height : 40;
        const patternsH = patternsEl ? patternsEl.getBoundingClientRect().height : 120;

        // Gaps del container (padding top + bottom + gaps internos)
        const containerGaps = 40;

        const availW = Math.floor(vw - MARGIN_PX * 2);
        const availH = Math.floor(vh - headerH - statsH - patternsH - containerGaps);

        return (availW > 0 && availH > 0) ? {w: availW, h: availH} : null;
    }

    /**
     * Calcula el tamaño óptimo del grid en celdas.
     * @param {{ w: number, h: number }} area — píxeles disponibles
     * @param {number} cellSize
     * @returns {{ gridWidth: number, gridHeight: number }}
     */
    function computeOptimalSize(area, cellSize) {
        const cs = Math.max(1, cellSize);
        return {
            gridWidth: Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(area.w / cs))),
            gridHeight: Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(area.h / cs)))
        };
    }

    /**
     * Aplica el tamaño al autómata y sincroniza todos los controles UI.
     */
    function applyOptimalSize(automaton, gridWidth, gridHeight) {
        if (automaton.gridWidth === gridWidth && automaton.gridHeight === gridHeight) return;

        automaton.resizeGrid(gridWidth, gridHeight);

        // ── Sliders rectangulares ─────────────────────────────────────────
        _setEl('gridWidth', 'value', gridWidth);
        _setEl('gridHeight', 'value', gridHeight);
        _setEl('gridWidthValue', 'textContent', gridWidth);
        _setEl('gridHeightValue', 'textContent', gridHeight);

        const badge = document.getElementById('gridDimensionsBadge');
        if (badge) {
            badge.textContent = `${gridWidth}×${gridHeight}`;
            badge.classList.toggle('rect-badge', gridWidth !== gridHeight);
        }

        console.info(
            `🔲 Grid autofit: ${gridWidth}×${gridHeight} ` +
            `(cellSize=${automaton.cellSize}, ` +
            `${window.innerWidth <= 768 ? 'mobile' : 'desktop'}, ` +
            `viewport=${window.innerWidth}×${window.innerHeight})`
        );
    }

    function _setEl(id, prop, value) {
        const el = document.getElementById(id);
        if (el) el[prop] = value;
    }

    /**
     * Punto de entrada. Se llama tras app:ready con doble rAF para garantizar
     * que el navegador completó al menos un ciclo layout + paint antes de medir.
     */
    function run() {
        const automaton = window.app?.automaton;
        if (!automaton) return;

        const area = measureAvailableArea();
        if (!area) return;

        const {gridWidth, gridHeight} = computeOptimalSize(area, automaton.cellSize);
        applyOptimalSize(automaton, gridWidth, gridHeight);
    }

    eventBus.on('app:ready', () => {
        requestAnimationFrame(() => requestAnimationFrame(run));
    });

})();