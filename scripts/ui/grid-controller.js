import {AppConfig} from '../utils/config.js';
import {eventBus} from '../infrastructure/event-bus.js';
import {SpecialEngineManager} from '../core/engines/special-engine-manager.js';

/**
 * GridController — Controlador de tamaño de grid y zoom.
 *
 * Responsabilidades:
 *   - Sliders de gridWidth, gridHeight y cellSize
 *   - Autofit del grid al espacio disponible del canvas
 *   - Aspect lock y presets de dimensiones
 *   - Toggle de grilla visual y highlights
 *   - Display y sincronización de badges de dimensiones
 *
 * Extraído de UIController para aislar la lógica de dimensionado del grid
 * del resto de responsabilidades de la UI.
 *
 * Dependencias externas (inyectadas en el constructor):
 *   - automaton            — instancia de CellularAutomaton
 *   - onStopAutomaton      — callback para detener la simulación
 *   - onSyncPlayButton     — callback para actualizar el botón play/pause
 *   - onShowNotification   — callback para mostrar notificaciones
 *   - addEventListener     — helper compartido para registro+cleanup de listeners
 */
class GridController {

    /**
     * @param {Object}   options
     * @param {Object}   options.automaton
     * @param {Function} options.onStopAutomaton    — detiene la simulación en curso
     * @param {Function} options.onSyncPlayButton   — sincroniza el estado visual del botón play
     * @param {Function} options.onShowNotification — (msg, type, duration) muestra toast
     * @param {Function} options.addEventListener   — (target, event, handler) registra+cleanup
     */
    constructor({automaton, onStopAutomaton, onSyncPlayButton, onShowNotification, addEventListener}) {
        this.automaton = automaton;

        // Callbacks hacia UIController para operaciones que cruzan dominios
        this._stopAutomaton = onStopAutomaton;
        this._syncPlayButton = onSyncPlayButton;
        this._showNotification = onShowNotification;
        this._addEventListener = addEventListener;

        // Estado del debounce compartido para sliders de grid
        this._gridSizeDebounceTimer = null;
        this._gridSizePendingValue = null;
        this._gridSizePendingHeight = undefined;  // undefined = cuadrado; number = rect
        this._rectAspectRatio = 1;          // ratio w/h cuando el candado está activo

        // Referencia al thumbnail random (si PatternManager lo necesita)
        // No corresponde a este controlador — está en patterns.js
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    /**
     * Enlaza todos los listeners del dominio de grid.
     * Llamado desde UIController._bindEvents().
     */
    bindEvents() {
        this._addEventListener(document.getElementById('cellSize'), 'input', () => this.updateCellSize());
        this._addEventListener(document.getElementById('autoSizeBtn'), 'click', () => this.autoSizeGrid());
        this._addEventListener(document.getElementById('gridToggle'), 'click', () => this.toggleGrid());
        this._addEventListener(document.getElementById('gridHighlightsToggle'), 'click', () => this.toggleHighlightsGrid());
        this._bindGridRectEvents();
    }

    /**
     * Sincronización inicial de displays.
     * Llamado desde UIController._init() tras cargar reglas.
     */
    initDisplays() {
        this.updateGridSizeDisplay();
        this.updateCellSizeDisplay();
    }

    /**
     * Inicializa la UI rectangular: sliders, aspect lock, presets.
     * Llamado desde UIController._init() en app:ready.
     */
    initGridRectUI() {
        this._syncSlidersToAutomaton();
        this._setupAspectLockFeedback();
        this._bindPresetButtons();

        // eventBus.on() — no es un elemento DOM, no pasa por _addEventListener
        eventBus.on('automaton:resized', ({width, height}) => {
            const wSlider = document.getElementById('gridWidth');
            const hSlider = document.getElementById('gridHeight');
            const wDisplay = document.getElementById('gridWidthValue');
            const hDisplay = document.getElementById('gridHeightValue');
            if (wSlider) wSlider.value = width;
            if (hSlider) hSlider.value = height;
            if (wDisplay) wDisplay.textContent = width;
            if (hDisplay) hDisplay.textContent = height;
            this._updateAspectRatioBadge(width, height);
        });
    }

    destroy() {
        if (this._gridSizeDebounceTimer) clearTimeout(this._gridSizeDebounceTimer);
        this._gridSizeDebounceTimer = null;
    }

    // =========================================
    // GRID SIZE DISPLAY
    // =========================================

    updateGridSizeDisplay() {
        this._updateRectDisplays();
    }

    // =========================================
    // CELL SIZE — ZOOM
    // =========================================

    updateCellSize() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        const display = document.getElementById('cellSizeValue');
        if (display) display.textContent = `${value}px`;
        this.automaton.setCellSize(value);
    }

    updateCellSizeDisplay() {
        const slider = document.getElementById('cellSize');
        const display = document.getElementById('cellSizeValue');
        if (slider && display) display.textContent = `${parseInt(slider.value)}px`;
    }

    // =========================================
    // AUTOFIT
    // =========================================

    /**
     * Calcula el máximo grid que cabe en el espacio disponible del canvas
     * manteniendo el cellSize actual, y redimensiona sin tocar el zoom.
     *
     * En modo Triangle usa la geometría del canvas triangular para calcular
     * gh correctamente: gh = floor(availH / (√3/2 × cs)).
     */
    autoSizeGrid() {
        const automaton = this.automaton;
        const isMobile = window.innerWidth <= 768;
        const MARGIN = 6;
        const MIN_CELLS = AppConfig.GRID.MIN_CELLS;
        const MAX_CELLS = AppConfig.GRID.MAX_CELLS;

        let availW, availH;
        if (isMobile) {
            const headerH = document.querySelector('header')?.getBoundingClientRect().height ?? 60;
            const statsH = document.querySelector('.stats')?.getBoundingClientRect().height ?? 40;
            const patH = document.querySelector('.patterns-horizontal-container')?.getBoundingClientRect().height ?? 120;
            availW = Math.floor(window.innerWidth - MARGIN * 2);
            availH = Math.floor(window.innerHeight - headerH - statsH - patH - 40);
        } else {
            const wrapper = document.querySelector('.canvas-wrapper');
            if (!wrapper) return;
            const rect = wrapper.getBoundingClientRect();
            availW = Math.floor(rect.width - AppConfig.GRID.CANVAS_MARGIN - MARGIN);
            availH = Math.floor(rect.height - AppConfig.GRID.CANVAS_MARGIN - MARGIN);
        }

        if (availW <= 0 || availH <= 0) return;

        const cs = automaton.cellSize;
        let gw, gh;

        if (automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE
            && automaton.triangleEngine?.isActive) {
            // Geometría del canvas triangular:
            //   canvasWidth  ≈ (gw + 0.5) × cs  →  gw = floor(availW/cs - 0.5)
            //   canvasHeight = gh × (√3/2) × cs  →  gh = floor(availH / (√3/2 × cs))
            const sqrt3_2 = Math.sqrt(3) / 2;
            gw = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(availW / cs - 0.5)));
            gh = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(availH / (sqrt3_2 * cs))));
        } else if (automaton.specialMode === SpecialEngineManager.MODES.HEXAGONAL
            && automaton.hexEngine?.isActive) {
            // Geometría hex (pointy-top):
            //   canvasW = cols × cs×√3 + cs×√3/2  →  cols = (availW - cs×√3/2) / (cs×√3)
            //   canvasH = rows × cs×1.5 + cs×0.5  →  rows = (availH - cs×0.5)  / (cs×1.5)
            const SQRT3 = Math.sqrt(3);
            const hexCols = Math.max(MIN_CELLS, Math.min(MAX_CELLS,
                Math.floor((availW - cs * SQRT3 / 2) / (cs * SQRT3))
            ));
            const hexRows = Math.max(MIN_CELLS, Math.min(MAX_CELLS,
                Math.floor((availH - cs * 0.5) / (cs * 1.5))
            ));
            const hgm = automaton.hexEngine.gridManager;
            if (hgm && hgm.width === hexCols && hgm.height === hexRows) return;
            automaton.resizeGrid(hexCols, hexRows);
            this._showNotification(`Grid hex: ${hexCols}×${hexRows}`, 'info', 1200);
            return;
        } else {
            gw = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(availW / cs)));
            gh = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.floor(availH / cs)));
        }

        if (automaton.gridWidth === gw && automaton.gridHeight === gh) return;

        automaton.resizeGrid(gw, gh);
        this._syncAllGridDisplays(gw, gh);
        this._showNotification(`Grid: ${gw}×${gh}`, 'info', 1200);
    }

    // =========================================
    // TOGGLE DE GRILLA VISUAL
    // =========================================

    toggleGrid() {
        const newState = this.automaton.toggleGrid();
        const gridToggle = document.getElementById('gridToggle');
        if (gridToggle) gridToggle.classList.toggle('active', newState);
        this.automaton.render();
        return newState;
    }

    toggleHighlightsGrid() {
        const newState = this.automaton.toggleGridHighlights();
        const btn = document.getElementById('gridHighlightsToggle');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) icon.className = newState ? 'fa-solid fa-border-all' : 'fa-solid fa-border-none';
        }
        this.automaton.render();
        return newState;
    }

    // =========================================
    // GRID RECTANGULAR — SLIDERS INDEPENDIENTES
    // =========================================

    _bindGridRectEvents() {
        const widthSlider = document.getElementById('gridWidth');
        const heightSlider = document.getElementById('gridHeight');
        const lockChk = document.getElementById('gridAspectLock');

        if (widthSlider) this._addEventListener(widthSlider, 'input', () => this.updateGridWidth());
        if (heightSlider) this._addEventListener(heightSlider, 'input', () => this.updateGridHeight());

        if (lockChk) {
            this._addEventListener(lockChk, 'change', () => {
                if (lockChk.checked) {
                    const w = parseInt(document.getElementById('gridWidth')?.value || this.automaton.gridWidth);
                    const h = parseInt(document.getElementById('gridHeight')?.value || this.automaton.gridHeight);
                    this._rectAspectRatio = h > 0 ? w / h : 1;
                }
            });
        }
    }

    updateGridWidth() {
        const slider = document.getElementById('gridWidth');
        if (!slider) return;
        this._syncAspectRatio('width', parseInt(slider.value));
        this._updateRectDisplays();
        this._scheduleRectResize();
    }

    updateGridHeight() {
        const slider = document.getElementById('gridHeight');
        if (!slider) return;
        this._syncAspectRatio('height', parseInt(slider.value));
        this._updateRectDisplays();
        this._scheduleRectResize();
    }

    /**
     * Si el candado de aspecto está activo, propaga el cambio al otro eje.
     * @param {'width'|'height'} axis
     * @param {number} value
     */
    _syncAspectRatio(axis, value) {
        const lockChk = document.getElementById('gridAspectLock');
        if (!lockChk?.checked) return;

        const ratio = this._rectAspectRatio || 1;
        const clamp = v => Math.max(20, Math.min(AppConfig.GRID.MAX_CELLS, Math.round(v)));

        if (axis === 'width') {
            const newH = clamp(value / ratio);
            const hSlider = document.getElementById('gridHeight');
            if (hSlider) {
                hSlider.value = newH;
                const hDisplay = document.getElementById('gridHeightValue');
                if (hDisplay) hDisplay.textContent = newH;
            }
        } else {
            const newW = clamp(value * ratio);
            const wSlider = document.getElementById('gridWidth');
            if (wSlider) {
                wSlider.value = newW;
                const wDisplay = document.getElementById('gridWidthValue');
                if (wDisplay) wDisplay.textContent = newW;
            }
        }
    }

    _scheduleRectResize() {
        if (this._gridSizeDebounceTimer) clearTimeout(this._gridSizeDebounceTimer);

        const w = parseInt(document.getElementById('gridWidth')?.value || this.automaton.gridWidth);
        const h = parseInt(document.getElementById('gridHeight')?.value || this.automaton.gridHeight);
        this._gridSizePendingValue = w;
        this._gridSizePendingHeight = h;

        this._gridSizeDebounceTimer = setTimeout(() => this._applyRectGridSizeChange(), 500);
    }

    _applyRectGridSizeChange() {
        const w = this._gridSizePendingValue;
        const h = this._gridSizePendingHeight;
        if (w == null || h == null) return;

        this._gridSizePendingValue = null;
        this._gridSizePendingHeight = undefined;

        if (this.automaton.isRunning) {
            this._stopAutomaton();
            eventBus.emit('automaton:runningChanged', {isRunning: false});
            this._syncPlayButton();
        }

        this.automaton.resizeGrid(w, h);
        this._gridSizeDebounceTimer = null;
        this._syncAllGridDisplays(w, h);
    }

    /**
     * Aplica un preset de dimensiones directamente (sin debounce).
     */
    applyGridPreset(w, h) {
        const wSlider = document.getElementById('gridWidth');
        const hSlider = document.getElementById('gridHeight');
        if (wSlider) wSlider.value = w;
        if (hSlider) hSlider.value = h;
        this._updateRectDisplays();
        this.automaton.resizeGrid(w, h);
    }

    // =========================================
    // DISPLAYS
    // =========================================

    _updateRectDisplays() {
        const wSlider = document.getElementById('gridWidth');
        const hSlider = document.getElementById('gridHeight');
        const wDisplay = document.getElementById('gridWidthValue');
        const hDisplay = document.getElementById('gridHeightValue');
        if (wSlider && wDisplay) wDisplay.textContent = wSlider.value;
        if (hSlider && hDisplay) hDisplay.textContent = hSlider.value;

        const badge = document.getElementById('gridDimensionsBadge');
        if (badge) {
            const w = wSlider ? parseInt(wSlider.value) : this.automaton.gridWidth;
            const h = hSlider ? parseInt(hSlider.value) : this.automaton.gridHeight;
            badge.textContent = `${w}×${h}`;
            badge.classList.toggle('rect-badge', w !== h);
        }
    }

    /**
     * Sincroniza todos los displays (legacy + rect) con los valores gw/gh dados.
     * Usado por autoSizeGrid y _applyRectGridSizeChange.
     */
    _syncAllGridDisplays(gw, gh) {
        const _set = (id, prop, val) => {
            const el = document.getElementById(id);
            if (el) el[prop] = val;
        };
        _set('gridWidth', 'value', gw);
        _set('gridWidthValue', 'textContent', gw);
        _set('gridHeight', 'value', gh);
        _set('gridHeightValue', 'textContent', gh);

        const badge = document.getElementById('gridDimensionsBadge');
        if (badge) {
            badge.textContent = `${gw}×${gh}`;
            badge.classList.toggle('rect-badge', gw !== gh);
        }
    }

    // =========================================
    // INICIALIZACIÓN RECT UI (en app:ready)
    // =========================================

    _syncSlidersToAutomaton() {
        const w = this.automaton.gridWidth;
        const h = this.automaton.gridHeight;
        const wSlider = document.getElementById('gridWidth');
        const hSlider = document.getElementById('gridHeight');
        const wDisplay = document.getElementById('gridWidthValue');
        const hDisplay = document.getElementById('gridHeightValue');
        if (wSlider) wSlider.value = w;
        if (hSlider) hSlider.value = h;
        if (wDisplay) wDisplay.textContent = w;
        if (hDisplay) hDisplay.textContent = h;
        this._updateAspectRatioBadge(w, h);

        const badge = document.getElementById('gridDimensionsBadge');
        if (badge) {
            badge.textContent = `${w}×${h}`;
            badge.classList.toggle('rect-badge', w !== h);
        }
    }

    _setupAspectLockFeedback() {
        const lockChk = document.getElementById('gridAspectLock');
        const lockIcon = document.getElementById('gridAspectLockIcon');
        if (!lockChk) return;

        lockChk.addEventListener('change', () => {
            const locked = lockChk.checked;
            if (lockIcon) {
                lockIcon.innerHTML = locked
                    ? '<i class="fas fa-lock"></i>'
                    : '<i class="fas fa-link"></i>';
                lockIcon.classList.toggle('locked', locked);
            }
            if (locked) {
                const w = parseInt(document.getElementById('gridWidth')?.value || this.automaton.gridWidth);
                const h = parseInt(document.getElementById('gridHeight')?.value || this.automaton.gridHeight);
                this._rectAspectRatio = h > 0 ? w / h : 1;
                this._updateAspectRatioBadge(w, h);
            }
        });

        ['gridWidth', 'gridHeight'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const w = parseInt(document.getElementById('gridWidth')?.value || this.automaton.gridWidth);
                const h = parseInt(document.getElementById('gridHeight')?.value || this.automaton.gridHeight);
                this._updateAspectRatioBadge(w, h);
            });
        });
    }

    _updateAspectRatioBadge(w, h) {
        const badge = document.getElementById('gridAspectRatioDisplay');
        if (!badge || !w || !h) return;
        const g = this._gcd(w, h);
        const rw = w / g;
        const rh = h / g;
        badge.textContent = (rw > 20 || rh > 20)
            ? `${(w / h).toFixed(2)}:1`
            : `${rw}:${rh}`;
    }

    /** Máximo común divisor (algoritmo de Euclides). */
    _gcd(a, b) {
        a = Math.abs(a);
        b = Math.abs(b);
        while (b) {
            [a, b] = [b, a % b];
        }
        return a;
    }

    _bindPresetButtons() {
        document.querySelectorAll('.btn-grid-preset[data-w]').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = parseInt(btn.dataset.w);
                const h = parseInt(btn.dataset.h);
                if (!w || !h) return;

                const wSlider = document.getElementById('gridWidth');
                const hSlider = document.getElementById('gridHeight');
                if (wSlider) wSlider.value = w;
                if (hSlider) hSlider.value = h;

                this._updateRectDisplays();
                this._updateAspectRatioBadge(w, h);

                const lockChk = document.getElementById('gridAspectLock');
                const lockIcon = document.getElementById('gridAspectLockIcon');
                if (lockChk) lockChk.checked = false;
                if (lockIcon) {
                    lockIcon.innerHTML = '<i class="fas fa-link"></i>';
                    lockIcon.classList.remove('locked');
                }

                this.automaton.resizeGrid(w, h);
                this._syncAllGridDisplays(w, h);
            });
        });
    }
}

export {GridController};