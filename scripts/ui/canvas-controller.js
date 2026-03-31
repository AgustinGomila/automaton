/**
 * CanvasController - Gestiona toda la interacción con el canvas.
 *
 * Responsabilidad: eventos de mouse/touch, dibujo continuo,
 * selección de área, arrastre, y overlays visuales asociados.
 *
 * No conoce motores especiales, reglas ni estadísticas.
 */
import {eventBus} from '../infrastructure/event-bus.js';
import {DrawingTool} from './drawing-tool.js';
import {SelectionManager} from './selection-manager.js';
import {getPatternWithRotation} from '../config/patterns.js';
import {SpecialEngineManager} from '../core/engines/special-engine-manager.js';
import {t} from './i18n.js';

class CanvasController {
    /**
     * @param {Object} options
     * @param {CellularAutomaton} options.automaton
     * @param {Object}   options.patternState    - Referencia compartida { pattern, key, rotation }
     * @param {Function} options.onUpdateDrawMode - () => void
     */
    constructor({automaton, patternState, onUpdateDrawMode, getPatternManager}) {
        this.automaton = automaton;
        this._patternState = patternState;
        this._onUpdateDrawMode = onUpdateDrawMode || (() => {
        });
        this._getPatternManager = getPatternManager || (() => null);

        // Estado de interacción del canvas
        this.isMouseDown = false;
        this.lastCell = null;

        // Estado de teclado (escrito por UIController)
        this.shiftPressed = false;
        this._ctrlPressed = false;
        this._altPressed = false;

        // Pan toroidal (Alt+drag)
        this._isPanning = false;
        this._panLastCell = null;

        // Estado de dibujo WireWorld (determinado al inicio del drag)
        this._wwDrawState = null;

        // Herramienta bote de pintura
        this.bucketToolActive = false;

        // Estado visual
        this.showInfluenceArea = true;

        // Internos
        this._cleanups = [];
        this._mouseTimeout = null;
        this._throttledMouseMove = this._throttle(this._handleMouseMove.bind(this), 16);

        // Herramienta de dibujo: pincel continuo y flood fill
        this._drawingTool = new DrawingTool({
            automaton: this.automaton,
            getCtrlPressed: () => this._ctrlPressed
        });

        // Gestión de selección rectangular y arrastre
        this._selectionManager = new SelectionManager({
            automaton: this.automaton,
            getIsCopying: () => this._ctrlPressed && this.shiftPressed
        });

        this._bindEvents();
        this._setupSelectionDelegation();
    }

    // =========================================
    // PROXIES — SelectionManager state
    // Los accesos externos usan estos getters para leer el estado de selección
    // sin acoplar a la implementación interna de SelectionManager.
    // =========================================

    get selection() {
        return this._selectionManager.selection;
    }

    get selectionContent() {
        return this._selectionManager.selectionContent;
    }

    get isSelecting() {
        return this._selectionManager.isSelecting;
    }

    get isDragging() {
        return this._selectionManager.isDragging;
    }

    get ctrlPressed() {
        return this._ctrlPressed;
    }

    set ctrlPressed(val) {
        this._ctrlPressed = val;
        this._updateCursor();
    }

    get altPressed() {
        return this._altPressed;
    }

    set altPressed(val) {
        this._altPressed = val;
        this._updateCursor();
    }

    // Proxies públicos — llamados desde UIController y _setupSelectionDelegation
    clearSelection() {
        this._selectionManager.clearSelection();
    }

    deleteSelection() {
        this._selectionManager.deleteSelection();
    }

    cancelDrag() {
        this._selectionManager.cancelDrag();
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        if (this._mouseTimeout) clearTimeout(this._mouseTimeout);

        this._selectionManager.destroy();
        this._selectionManager = null;
        this._drawingTool = null;

        document.getElementById('patternPreview')?.remove();
        document.getElementById('influenceArea')?.remove();
        document.getElementById('selectionOverlay')?.remove();
        document.getElementById('selectionInfo')?.remove();
        document.getElementById('dragPreview')?.remove();

        this._cleanups.forEach(fn => {
            try {
                fn();
            } catch (e) {
            }
        });
        this._cleanups = [];

        this.automaton = null;
        this._patternState = null;
        this.lastCell = null;
    }

    // =========================================
    // BINDING
    // =========================================

    _bindEvents() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        this._addEventListener(canvas, 'mousedown', (e) => this._handleMouseDown(e));
        this._addEventListener(canvas, 'mousemove', this._throttledMouseMove);
        this._addEventListener(canvas, 'mouseup', (e) => this._handleMouseUp(e));
        this._addEventListener(canvas, 'mouseleave', () => this._handleMouseLeave());
        this._addEventListener(canvas, 'contextmenu', (e) => this._handleRightClick(e));

        // Actualizar cursor cuando cambia el modo especial (activa/desactiva dibujo)
        const modeUnsub = eventBus.on('automaton:modeChanged', () => this._updateCursor());
        this._cleanups.push(modeUnsub);

        this._setupTouchEvents();
    }

    _setupSelectionDelegation() {
        const container = document.querySelector('.canvas-controls');
        if (!container) return;

        const handler = (e) => {
            if (e.target.closest('#deleteSelectionBtn')) {
                e.preventDefault();
                this._selectionManager.deleteSelection();
            } else if (e.target.closest('#clearSelectionBtn')) {
                e.preventDefault();
                this._selectionManager.clearSelection();
            }
        };

        container.addEventListener('click', handler);
        this._cleanups.push(() => container.removeEventListener('click', handler));
    }

    _setupTouchEvents() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        let isTouchDrawing = false;

        this._addEventListener(canvas, 'touchstart', (e) => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            const touch = e.touches[0];
            const {x, y} = this.automaton.getCellFromMouse(touch);

            if (this._patternState.pattern) {
                this.automaton.importPattern(this._patternState.pattern, x, y);
            } else {
                isTouchDrawing = true;
                this.automaton.setCell(x, y, !this.automaton.grid[x][y]);
                this.automaton.updateStats();
                this.automaton.render();
            }
        }, {passive: false});

        this._addEventListener(canvas, 'touchmove', (e) => {
            if (!isTouchDrawing || e.touches.length !== 1) return;
            e.preventDefault();
            const touch = e.touches[0];
            const {x, y} = this.automaton.getCellFromMouse(touch);
            this.automaton.setCell(x, y, true);
            this.automaton.updateStats();
            this.automaton.render();
        }, {passive: false});

        this._addEventListener(canvas, 'touchend', (e) => {
            e.preventDefault();
            isTouchDrawing = false;
        });
    }

    // =========================================
    // MOUSE HANDLERS
    // =========================================

    _handleMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();

        this.isMouseDown = true;

        // Pan toroidal: Alt tiene prioridad sobre cualquier modo de dibujo
        if (this.altPressed) {
            // Para triangle/hex usamos coordenadas de celda propias; para el resto getCellFromMouse
            if (this.automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.automaton.triangleEngine?.isActive) {
                const result = this.automaton.getCellCoords(e.clientX, e.clientY);
                this._panLastCell = result ? {x: result.q, y: result.r} : null;
            } else if (this.automaton.specialMode === SpecialEngineManager.MODES.HEXAGONAL && this.automaton.hexEngine?.isActive) {
                const result = this.automaton.getCellCoords(e.clientX, e.clientY);
                this._panLastCell = result ? {x: result.col, y: result.row} : null;
            } else {
                const {x, y} = this.automaton.getCellFromMouse(e);
                this._panLastCell = {x, y};
                this.lastCell = {x, y};
            }
            this._isPanning = true;
            this._updateCursor();
            return;
        }

        if (this.automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.automaton.triangleEngine?.isActive) {
            // Patrón Random: randomizar el grid del engine, igual que la tecla A
            if (this._patternState?.pattern?.pattern === 'random') {
                const density = parseInt(document.getElementById('randomPercentage')?.value ?? 35, 10) / 100;
                const wasRunning = this.automaton.isRunning;
                if (wasRunning) this.automaton.stop();
                this.automaton.randomize(density);
                if (wasRunning) requestAnimationFrame(() => this.automaton.start());
                return;
            }
            const result = this.automaton.getCellCoords(e.clientX, e.clientY);
            if (result) {
                this.lastCell = {q: result.q, r: result.r, mode: SpecialEngineManager.MODES.TRIANGLE};
                this.automaton.drawCellAt(result, !this.ctrlPressed ? 1 : 0);
            }
            return;
        }

        if (this.automaton.specialMode === SpecialEngineManager.MODES.HEXAGONAL && this.automaton.hexEngine?.isActive) {
            // Patrón Random: randomizar el grid del engine, igual que la tecla A
            if (this._patternState?.pattern?.pattern === 'random') {
                const density = parseInt(document.getElementById('randomPercentage')?.value ?? 35, 10) / 100;
                const wasRunning = this.automaton.isRunning;
                if (wasRunning) this.automaton.stop();
                this.automaton.randomize(density);
                if (wasRunning) requestAnimationFrame(() => this.automaton.start());
                return;
            }
            const result = this.automaton.getCellCoords(e.clientX, e.clientY);
            if (result) {
                this.lastCell = {col: result.col, row: result.row, mode: SpecialEngineManager.MODES.HEXAGONAL};
                this.automaton.drawCellAt(result, !this.ctrlPressed ? 1 : 0);
            }
            return;
        }

        const {x, y} = this.automaton.getCellFromMouse(e);
        this.lastCell = {x, y};
        // Sincronizar lastCell del DrawingTool para que el primer segmento
        // del trazo continuo arranque desde la celda del clic, no desde null.
        this._drawingTool.lastCell = {x, y};

        // Bote de pintura: flood fill en el área cerrada
        if (this.bucketToolActive) {
            this._drawingTool.floodFill(x, y, !this.ctrlPressed ? 1 : 0);
            return;
        }

        if (this.shiftPressed && !this.ctrlPressed) {
            if (this.selection && this._selectionManager.isPointInSelection(x, y)) {
                this._selectionManager.startDrag(x, y, false);
            } else {
                this._selectionManager.startSelection(x, y);
            }
            return;
        }

        if (this.selection && this._selectionManager.isPointInSelection(x, y)) {
            this._selectionManager.startDrag(x, y, this.ctrlPressed && this.shiftPressed);
            return;
        }

        if (this._patternState.pattern) {
            const wasRunning = this.automaton.isRunning;
            if (wasRunning) this.automaton.stop();

            this.automaton.importPattern(this._patternState.pattern, x, y);

            if (wasRunning) {
                requestAnimationFrame(() => this.automaton.start());
            }
            return;
        }

        // Langton: clic coloca una hormiga / Ctrl+clic borra
        if (this.automaton.specialMode === SpecialEngineManager.MODES.LANGTON && this.automaton.langtonEngine?.isActive) {
            if (this.ctrlPressed) {
                this.automaton.eraseEngineAt(x, y);
            } else {
                this.automaton.addEngineAgentAt(x, y);
            }
            eventBus.emit('automaton:ruleChanged');
            return;
        }

        // WireWorld: left-click toggle Conductor↔Vacío / drag usa el estado inicial
        if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.automaton.wireworldEngine?.isActive) {
            // Conductor → Vacío; cualquier otro estado → Conductor
            const newState = this.automaton.getEngineStateAt(x, y) === 3 ? 0 : 3;
            this._wwDrawState = newState;
            this.automaton.setEngineStateAt(x, y, newState);
            return;
        }

        const changed = this.automaton.setCell(x, y, !this.ctrlPressed);
        if (changed) {
            this.automaton.updateStats();
            this.automaton.render();
        }
    }

    _handleMouseMove(e) {
        // Pan tiene prioridad sobre cualquier modo de dibujo
        if (this.isMouseDown && this._isPanning) {
            if (this.automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.automaton.triangleEngine?.isActive) {
                const result = this.automaton.getCellCoords(e.clientX, e.clientY);
                if (result && this._panLastCell) {
                    const dx = result.q - this._panLastCell.x;
                    const dy = result.r - this._panLastCell.y;
                    if (dx !== 0 || dy !== 0) {
                        this.automaton.shiftGrid(dx, dy);
                        this._panLastCell = {x: result.q, y: result.r};
                    }
                }
            } else if (this.automaton.specialMode === SpecialEngineManager.MODES.HEXAGONAL && this.automaton.hexEngine?.isActive) {
                const result = this.automaton.getCellCoords(e.clientX, e.clientY);
                if (result && this._panLastCell) {
                    const dx = result.col - this._panLastCell.x;
                    const dy = result.row - this._panLastCell.y;
                    if (dx !== 0 || dy !== 0) {
                        this.automaton.shiftGrid(dx, dy);
                        this._panLastCell = {x: result.col, y: result.row};
                    }
                }
            } else {
                const {x, y} = this.automaton.getCellFromMouse(e);
                if (this._panLastCell) {
                    const dx = x - this._panLastCell.x;
                    const dy = y - this._panLastCell.y;
                    if (dx !== 0 || dy !== 0) {
                        this.automaton.shiftGrid(dx, dy);
                        this._panLastCell = {x, y};
                    }
                }
            }
            return;
        }

        if (this.automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.automaton.triangleEngine?.isActive) {
            const result = this.automaton.getCellCoords(e.clientX, e.clientY);
            if (result) {
                this._updateMouseCoords(result.q, result.r);

                if (this.isMouseDown && this.lastCell?.mode === SpecialEngineManager.MODES.TRIANGLE) {
                    const {q, r} = result;
                    if (this.lastCell.q === q && this.lastCell.r === r) return;

                    if (this.automaton.drawCellAt(result, !this.ctrlPressed ? 1 : 0)) {
                        this.lastCell = {q, r, mode: SpecialEngineManager.MODES.TRIANGLE};
                    }
                }
            }
            return;
        }

        if (this.automaton.specialMode === SpecialEngineManager.MODES.HEXAGONAL && this.automaton.hexEngine?.isActive) {
            const result = this.automaton.getCellCoords(e.clientX, e.clientY);
            if (result) {
                this._updateMouseCoords(result.col, result.row);

                if (this.isMouseDown && this.lastCell?.mode === SpecialEngineManager.MODES.HEXAGONAL) {
                    const {col, row} = result;
                    if (this.lastCell.col === col && this.lastCell.row === row) return;

                    if (this.automaton.drawCellAt(result, !this.ctrlPressed ? 1 : 0)) {
                        this.lastCell = {col, row, mode: SpecialEngineManager.MODES.HEXAGONAL};
                    }
                }
            }
            return;
        }

        const {x, y} = this.automaton.getCellFromMouse(e);
        this._updateMouseCoords(x, y);

        if (this._patternState.pattern) {
            this._getPatternManager()?.showPatternPreview(x, y);
            if (this.showInfluenceArea) this._getPatternManager()?.showInfluenceArea(x, y);
        } else {
            this._getPatternManager()?.hidePatternPreview();
            if (this.showInfluenceArea && !this.selection) this._getPatternManager()?.showInfluenceArea(x, y);
        }

        if (this.isMouseDown) {
            if (this.isSelecting) {
                this._selectionManager.updateSelection(x, y);
            } else if (this.isDragging) {
                this._selectionManager.updateDrag(x, y);
            } else if (this.automaton.specialMode === SpecialEngineManager.MODES.LANGTON && this.automaton.langtonEngine?.isActive && !this._patternState.pattern) {
                // Langton: arrastrar coloca/borra hormigas a lo largo del trazo
                if (!this.lastCell || (this.lastCell.x === x && this.lastCell.y === y)) {
                    this.lastCell = {x, y};
                } else {
                    const cells = this._drawingTool._getLineCells(this.lastCell.x, this.lastCell.y, x, y);
                    let changed = false;
                    for (const cell of cells) {
                        if (cell.x === this.lastCell.x && cell.y === this.lastCell.y) continue;
                        if (this.ctrlPressed) {
                            this.automaton.eraseEngineAt(cell.x, cell.y);
                        } else {
                            this.automaton.addEngineAgentAt(cell.x, cell.y);
                        }
                        changed = true;
                    }
                    this.lastCell = {x, y};
                    if (changed) {
                        eventBus.emit('automaton:ruleChanged');
                    }
                }
            } else if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.automaton.wireworldEngine?.isActive && !this._patternState.pattern) {
                // WireWorld: arrastrar aplica el estado decidido al inicio del drag
                if (this._wwDrawState === null) {
                    this.lastCell = {x, y};
                    return;
                }
                if (!this.lastCell || (this.lastCell.x === x && this.lastCell.y === y)) {
                    this.lastCell = {x, y};
                } else {
                    const cells = this._drawingTool._getLineCells(this.lastCell.x, this.lastCell.y, x, y);
                    let needsRender = false;
                    for (const cell of cells) {
                        if (cell.x === this.lastCell.x && cell.y === this.lastCell.y) continue;
                        if (this.automaton.setEngineStateAt(cell.x, cell.y, this._wwDrawState)) {
                            needsRender = true;
                        }
                    }
                    this.lastCell = {x, y};
                    if (needsRender) {
                        this.automaton.updateStats();
                        this.automaton.render();
                    }
                }
            } else if (!this._patternState.pattern) {
                this._drawingTool.handleContinuousDrawing(x, y);
            }
        }
    }

    _handleMouseUp(e) {
        if (e.button !== 0) return;

        this.isMouseDown = false;
        this._wwDrawState = null;

        if (this._isPanning) {
            this._isPanning = false;
            this._panLastCell = null;
            this._updateCursor();
            // El pan ya sincroniza el worker vía shiftGrid → no es necesario aquí.
            return;
        }

        if (this.isSelecting) this._selectionManager.endSelection();
        if (this.isDragging) this._selectionManager.endDrag();

        this.lastCell = null;
        this._drawingTool.lastCell = null;

        // Sincronizar el worker tras cualquier edición con el pincel (o con el
        // drag de selección). Sin esta llamada, en grids ≥ 600 donde el worker
        // está activo, las celdas dibujadas/pegadas manualmente no llegan al
        // worker: éste computa desde su estado interno y el XOR resultante
        // "congela" las celdas nuevas en vez de hacerlas evolucionar.
        this.automaton?._syncWorkerGrid();
    }

    _handleMouseLeave() {
        this.isMouseDown = false;
        if (this._isPanning) {
            this._isPanning = false;
            this._panLastCell = null;
            this._updateCursor();
        }
        // Si hay selección en curso, NO la terminamos — los listeners de documento
        // siguen capturando mousemove/mouseup fuera del canvas.
        if (!this.isSelecting && this.isDragging) this._selectionManager.endDrag();

        this._getPatternManager()?.hidePatternPreview();
        if (this.showInfluenceArea) this._getPatternManager()?.hideInfluenceArea();

        this.lastCell = null;
        this._drawingTool.lastCell = null;

        // Sincronizar el worker por si el usuario dibujó y salió del canvas
        // sin soltar el botón (el mouseup no se dispara fuera del canvas).
        this.automaton?._syncWorkerGrid();
    }

    _handleRightClick(e) {
        e.preventDefault();

        // WireWorld: right-click sobre Head→Tail, sobre Tail→Head, sobre otro→Head
        if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.automaton.wireworldEngine?.isActive && !this._patternState.pattern) {
            const {x, y} = this.automaton.getCellFromMouse(e);
            const current = this.automaton.getEngineStateAt(x, y);
            const newState = current === 1 ? 2 : 1; // HEAD→TAIL, anything else→HEAD
            this.automaton.setEngineStateAt(x, y, newState);
            return false;
        }

        if (this._patternState.pattern && this._patternState.pattern.pattern !== 'random') {
            this._patternState.rotation = (this._patternState.rotation + 90) % 360;
            this._patternState.pattern = getPatternWithRotation(
                this._patternState.key,
                this._patternState.rotation
            );

            eventBus.emit('pattern:rotationChanged', {
                pattern: this._patternState.pattern,
                rotation: this._patternState.rotation
            });

            const {x, y} = this.automaton.getCellFromMouse(e);
            this._getPatternManager()?.showPatternPreview(x, y);
            if (this.showInfluenceArea) this._getPatternManager()?.showInfluenceArea(x, y);
        }

        return false;
    }

    // =========================================

    _updateMouseCoords(x, y) {
        const coords = document.getElementById('mouseCoords');
        if (!coords) return;
        if (typeof x === 'object' && x.q !== undefined) {
            coords.textContent = `Q: ${x.q}, R: ${x.r}`;
        } else {
            coords.textContent = t('header.coords', {x, y});
        }
    }

    // =========================================

    _updateCursor() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        if (this._isPanning) {
            canvas.style.cursor = 'grabbing';
        } else if (this.altPressed) {
            canvas.style.cursor = 'grab';
        } else if (this.bucketToolActive) {
            canvas.style.cursor = this.ctrlPressed
                ? 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><text y=\'16\' font-size=\'16\'>🪣</text></svg>") 2 18, cell'
                : 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><text y=\'16\' font-size=\'16\'>🪣</text></svg>") 2 18, cell';
        } else if (this.automaton.specialMode === SpecialEngineManager.MODES.LANGTON) {
            canvas.style.cursor = 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><text y=\'16\' font-size=\'16\'>🐜</text></svg>") 10 10, crosshair';
        } else if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD) {
            canvas.style.cursor = 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><text y=\'16\' font-size=\'16\'>⚡</text></svg>") 10 10, crosshair';
        } else {
            canvas.style.cursor = this._ctrlPressed
                ? 'url("data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\'><circle cx=\'8\' cy=\'8\' r=\'6\' fill=\'%23ef4444\' opacity=\'0.8\'/></svg>") 8 8, crosshair'
                : 'crosshair';
        }
    }

    _throttle(func, limit) {
        let inThrottle = false;
        let lastArgs = null, lastContext = null;

        return (...args) => {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                    if (lastArgs) {
                        func.apply(lastContext, lastArgs);
                        lastArgs = lastContext = null;
                    }
                }, limit);
            } else {
                lastArgs = args;
                lastContext = this;
            }
        };
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        this._cleanups.push(() => target.removeEventListener(event, handler, options));
    }
}

export {CanvasController};