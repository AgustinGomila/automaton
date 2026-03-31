/**
 * scripts/grid-autofit.js
 *
 * Detecta el tamaño óptimo de la cuadrícula al inicio de la app,
 * midiendo el espacio real disponible para el canvas una vez que
 * el layout se ha pintado.
 *
 * Cambios ESM:
 *   - AppConfig y eventBus importados; sin acceso a window.AppConfig / window.eventBus.
 *   - automaton recibido del payload de 'app:ready' en lugar de window.app.automaton.
 */

import {AppConfig} from './utils/config.js';
import {eventBus} from './infrastructure/event-bus.js';

/** Margen de seguridad para no tocar el borde del scroll (px). */
const MARGIN_PX = 6;

/**
 * Mide el área real disponible para el canvas.
 *
 * Desktop: usa getBoundingClientRect sobre .canvas-wrapper.
 * Mobile:  calcula como viewport - header - stats - patterns bar - gaps.
 *
 * @returns {{ w: number, h: number } | null}
 */
function measureAvailableArea() {
    if (window.innerWidth <= 768) return _measureMobile();

    const wrapper = document.querySelector('.canvas-wrapper');
    if (!wrapper) return null;

    const rect = wrapper.getBoundingClientRect();
    const w = Math.floor(rect.width - AppConfig.GRID.CANVAS_MARGIN - MARGIN_PX);
    const h = Math.floor(rect.height - AppConfig.GRID.CANVAS_MARGIN - MARGIN_PX);
    return (w > 0 && h > 0) ? {w, h} : null;
}

/** @private */
function _measureMobile() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const headerEl = document.querySelector('header');
    const statsEl = document.querySelector('.stats');
    const patternsEl = document.querySelector('.patterns-horizontal-container');

    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 60;
    const statsH = statsEl ? statsEl.getBoundingClientRect().height : 40;
    const patternsH = patternsEl ? patternsEl.getBoundingClientRect().height : 120;

    const containerGaps = 40;

    const availW = Math.floor(vw - MARGIN_PX * 2);
    const availH = Math.floor(vh - headerH - statsH - patternsH - containerGaps);

    return (availW > 0 && availH > 0) ? {w: availW, h: availH} : null;
}

/**
 * Calcula el tamaño óptimo del grid en celdas.
 * @param   {{ w: number, h: number }} area — píxeles disponibles
 * @param   {number} cellSize
 * @returns {{ gridWidth: number, gridHeight: number }}
 */
function computeOptimalSize(area, cellSize) {
    const cs = Math.max(1, cellSize);
    return {
        gridWidth: Math.max(AppConfig.GRID.MIN_CELLS, Math.min(AppConfig.GRID.MAX_CELLS, Math.floor(area.w / cs))),
        gridHeight: Math.max(AppConfig.GRID.MIN_CELLS, Math.min(AppConfig.GRID.MAX_CELLS, Math.floor(area.h / cs)))
    };
}

/**
 * Aplica el tamaño al autómata y sincroniza todos los controles UI.
 * @param {CellularAutomaton} automaton
 * @param {number} gridWidth
 * @param {number} gridHeight
 */
function applyOptimalSize(automaton, gridWidth, gridHeight) {
    if (automaton.gridWidth === gridWidth && automaton.gridHeight === gridHeight) return;

    automaton.resizeGrid(gridWidth, gridHeight);

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
 * Punto de entrada. La app emite 'app:ready' con { automaton } en el payload.
 * Se usa doble rAF para garantizar que el navegador completó layout + paint.
 */
eventBus.on('app:ready', ({automaton}) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!automaton) return;
        const area = measureAvailableArea();
        if (!area) return;
        const {gridWidth, gridHeight} = computeOptimalSize(area, automaton.cellSize);
        applyOptimalSize(automaton, gridWidth, gridHeight);
    }));
});