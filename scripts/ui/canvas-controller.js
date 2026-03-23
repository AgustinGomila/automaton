/**
 * CanvasController - Gestiona toda la interacción con el canvas.
 *
 * Responsabilidad: eventos de mouse/touch, dibujo continuo,
 * selección de área, arrastre, y overlays visuales asociados.
 *
 * No conoce motores especiales, reglas ni estadísticas.
 */
class CanvasController {
    /**
     * @param {Object} options
     * @param {CellularAutomaton} options.automaton
     * @param {Object}   options.patternState    - Referencia compartida { pattern, key, rotation }
     * @param {Function} options.onUpdateDrawMode - () => void
     */
    constructor({automaton, patternState, onUpdateDrawMode}) {
        this.automaton = automaton;
        this._patternState = patternState;
        this._onUpdateDrawMode = onUpdateDrawMode || (() => {
        });

        // Estado de interacción
        this.isMouseDown = false;
        this.lastCell = null;
        this.isSelecting = false;
        this.selection = null;
        this.selectionContent = null;
        this.isDragging = false;
        this.isCopying = false;
        this.dragOffset = null;

        // Estado de teclado (escrito por UIController)
        this.shiftPressed = false;
        this._ctrlPressed = false;
        this._altPressed = false;

        // Pan toroidal (Alt+drag)
        this._isPanning = false;
        this._panLastCell = null;

        // Estado de dibujo WireWorld (determinado al inicio del drag)
        this._wwDrawState = null; // null | 0 (borrar) | 3 (conductor)

        // Herramienta bote de pintura
        this.bucketToolActive = false;

        // Estado visual
        this.showInfluenceArea = true;

        // Internos
        this._cleanups = [];
        this._mouseTimeout = null;
        this._throttledMouseMove = this._throttle(this._handleMouseMove.bind(this), 16);

        this._bindEvents();
        this._setupSelectionDelegation();
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

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        if (this._mouseTimeout) clearTimeout(this._mouseTimeout);

        this._removeSelectionVisual();
        this._removeDragPreview();
        this._hideSelectionInfo();

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
        this._detachDocumentSelectionListeners();

        this.automaton = null;
        this._patternState = null;
        this.selection = null;
        this.selectionContent = null;
        this.dragOffset = null;
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
                this.deleteSelection();
            } else if (e.target.closest('#clearSelectionBtn')) {
                e.preventDefault();
                this.clearSelection();
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
            // Para triangle usamos coordenadas de celda propias; para el resto getCellFromMouse
            if (this.automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.automaton.triangleEngine?.isActive) {
                const result = this.automaton.getCellCoords(e.clientX, e.clientY);
                this._panLastCell = result ? {x: result.q, y: result.r} : null;
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
            const result = this.automaton.getCellCoords(e.clientX, e.clientY);
            if (result) {
                this.lastCell = {q: result.q, r: result.r, mode: SpecialEngineManager.MODES.TRIANGLE};
                this.automaton.drawCellAt(result, !this.ctrlPressed ? 1 : 0);
            }
            return;
        }

        const {x, y} = this.automaton.getCellFromMouse(e);
        this.lastCell = {x, y};

        // Bote de pintura: flood fill en el área cerrada
        if (this.bucketToolActive) {
            this._floodFill(x, y, !this.ctrlPressed ? 1 : 0);
            return;
        }

        if (this.shiftPressed && !this.ctrlPressed) {
            if (this.selection && this.isPointInSelection(x, y)) {
                this.startDrag(x, y, false);
            } else {
                this.startSelection(x, y);
            }
            return;
        }

        if (this.selection && this.isPointInSelection(x, y)) {
            this.startDrag(x, y, this.ctrlPressed && this.shiftPressed);
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

        const {x, y} = this.automaton.getCellFromMouse(e);
        this._updateMouseCoords(x, y);

        if (this._patternState.pattern) {
            window.patternManager?.showPatternPreview(x, y);
            if (this.showInfluenceArea) window.patternManager?.showInfluenceArea(x, y);
        } else {
            window.patternManager?.hidePatternPreview();
            if (this.showInfluenceArea && !this.selection) window.patternManager?.showInfluenceArea(x, y);
        }

        if (this.isMouseDown) {
            if (this.isSelecting) {
                this.updateSelection(x, y);
            } else if (this.isDragging) {
                this.updateDrag(x, y);
            } else if (this.automaton.specialMode === SpecialEngineManager.MODES.LANGTON && this.automaton.langtonEngine?.isActive && !this._patternState.pattern) {
                // Langton: arrastrar coloca/borra hormigas a lo largo del trazo
                if (!this.lastCell || (this.lastCell.x === x && this.lastCell.y === y)) {
                    this.lastCell = {x, y};
                } else {
                    const cells = this._getLineCells(this.lastCell.x, this.lastCell.y, x, y);
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
                    const cells = this._getLineCells(this.lastCell.x, this.lastCell.y, x, y);
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
                this.handleContinuousDrawing(x, y);
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
            return;
        }

        if (this.isSelecting) this.endSelection();
        if (this.isDragging) this.endDrag();

        this.lastCell = null;
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
        if (!this.isSelecting && this.isDragging) this.endDrag();

        window.patternManager?.hidePatternPreview();
        if (this.showInfluenceArea) window.patternManager?.hideInfluenceArea();

        this.lastCell = null;
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
            window.patternManager?.showPatternPreview(x, y);
            if (this.showInfluenceArea) window.patternManager?.showInfluenceArea(x, y);
        }

        return false;
    }

    // =========================================
    // DIBUJO CONTINUO
    // =========================================

    handleContinuousDrawing(x, y) {
        x = Math.max(0, Math.min(x, this.automaton.gridSize - 1));
        y = Math.max(0, Math.min(y, this.automaton.gridSize - 1));

        if (!this.lastCell || (this.lastCell.x === x && this.lastCell.y === y)) {
            this.lastCell = {x, y};
            return;
        }

        const cells = this._getLineCells(this.lastCell.x, this.lastCell.y, x, y);
        let needsRender = false;

        for (const cell of cells) {
            if (cell.x === this.lastCell.x && cell.y === this.lastCell.y) continue;
            const changed = this.automaton.setCell(cell.x, cell.y, !this.ctrlPressed);
            if (changed) needsRender = true;
        }

        this.lastCell = {x, y};

        if (needsRender) {
            this.automaton.updateStats();
            this.automaton.render();
        }
    }

    _getLineCells(x0, y0, x1, y1) {
        const cells = [];
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        const maxX = this.automaton.gridSize - 1;
        const maxY = this.automaton.gridSize - 1;

        while (true) {
            if (x0 >= 0 && x0 <= maxX && y0 >= 0 && y0 <= maxY) {
                cells.push({x: x0, y: y0});
            }

            if (x0 === x1 && y0 === y1) break;

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }

            if (cells.length > this.automaton.gridSize * 2) break;
        }

        return cells;
    }

    // =========================================
    // SELECCIÓN
    // =========================================

    startSelection(x, y) {
        this.clearSelection();
        this.isSelecting = true;
        this.selection = {startX: x, startY: y, endX: x, endY: y};
        this._updateSelectionVisual();
        this._attachDocumentSelectionListeners();
    }

    updateSelection(x, y) {
        if (!this.isSelecting || !this.selection) return;
        this.selection.endX = x;
        this.selection.endY = y;
        this._updateSelectionVisual();
    }

    endSelection() {
        if (!this.isSelecting || !this.selection) return;
        this.isSelecting = false;
        this._detachDocumentSelectionListeners();

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);

        this.selectionContent = this.automaton.copyArea(minX, minY, maxX, maxY);
        this._showSelectionInfo();
    }

    clearSelection() {
        this.selection = null;
        this.selectionContent = null;
        this._removeSelectionVisual();
        this._hideSelectionInfo();
    }

    isPointInSelection(x, y) {
        if (!this.selection) return false;
        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }

    /**
     * Adjunta listeners de document para continuar la selección fuera del canvas.
     * getCellFromMouse ya hace clamp a los bounds del grid, por lo que las
     * coordenadas se detienen naturalmente en el borde correcto según el eje.
     */
    _attachDocumentSelectionListeners() {
        this._docSelectionMove = (e) => {
            if (!this.isSelecting) return;
            const {x, y} = this.automaton.getCellFromMouse(e);
            this.updateSelection(x, y);
        };
        this._docSelectionUp = () => {
            if (this.isSelecting) this.endSelection();
            this._detachDocumentSelectionListeners();
        };
        document.addEventListener('mousemove', this._docSelectionMove);
        document.addEventListener('mouseup', this._docSelectionUp);
    }

    _detachDocumentSelectionListeners() {
        if (this._docSelectionMove) {
            document.removeEventListener('mousemove', this._docSelectionMove);
            this._docSelectionMove = null;
        }
        if (this._docSelectionUp) {
            document.removeEventListener('mouseup', this._docSelectionUp);
            this._docSelectionUp = null;
        }
    }

    cancelDrag() {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.isCopying = false;
        this.dragOffset = null;
        this._removeDragPreview();
        // No tocar el grid — el patrón sigue en su posición original
    }

    deleteSelection() {
        if (!this.selection) return;
        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);

        this.automaton.clearArea(minX, minY, maxX, maxY);
        this.clearSelection();
    }

    // =========================================
    // ARRASTRE
    // =========================================

    startDrag(x, y, isCopy) {
        if (!this.selection || !this.selectionContent) return;

        this.isDragging = true;
        this.isCopying = isCopy;

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        this.dragOffset = {x: x - minX, y: y - minY};

        this._createDragPreview();
    }

    updateDrag(x, y) {
        if (!this.isDragging || !this.selectionContent) return;
        this._updateDragPreview(x - this.dragOffset.x, y - this.dragOffset.y);
    }

    endDrag() {
        if (!this.isDragging || !this.selectionContent) return;
        this.isDragging = false;

        const dragPreview = document.getElementById('dragPreview');
        if (!dragPreview) return;

        const targetX = parseInt(dragPreview.dataset.targetX) || 0;
        const targetY = parseInt(dragPreview.dataset.targetY) || 0;

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;

        if (!this.isCopying) {
            // Borrar solo las celdas vivas del patrón en la posición actual,
            // no el rectángulo completo — así no se eliminan celdas ajenas.
            this.automaton.clearPatternCells(this.selectionContent, minX, minY);
        }

        this.automaton.pasteArea(this.selectionContent, targetX, targetY);

        if (this.isCopying) {
            // En copia: la nueva selección es el contenido recién pegado en destino
            this.selectionContent = this.automaton.copyArea(
                targetX, targetY, targetX + width - 1, targetY + height - 1
            );
        }
        // En move: selectionContent se preserva intacto — es el patrón original.
        // Si el usuario vuelve a arrastrar, moverá exactamente lo mismo, no la
        // mezcla resultante de haberlo pegado sobre celdas existentes.

        this.selection.startX = targetX;
        this.selection.startY = targetY;
        this.selection.endX = targetX + width - 1;
        this.selection.endY = targetY + height - 1;

        this._removeDragPreview();
        // Sincroniza motores especiales tras el move: la fuente de verdad
        // pasa a ser grid[][] (modificado por clearPatternCells + pasteArea).
        this.automaton.syncEngineAfterEdit();

        this.automaton.render();
        this._updateSelectionVisual();
        this._showSelectionInfo();
    }

    // =========================================
    // OVERLAYS VISUALES
    // =========================================

    _removeSelectionVisual() {
        document.getElementById('selectionOverlay')?.remove();
    }

    _updateSelectionVisual() {
        if (!this.selection) {
            this._removeSelectionVisual();
            return;
        }

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);

        let overlay = document.getElementById('selectionOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'selectionOverlay';
            overlay.className = 'selection-overlay';
            document.getElementById('canvas-container')?.appendChild(overlay);
        }

        const cellSize = this.automaton.cellSize;
        const canvasRect = this.automaton.canvas.getBoundingClientRect();
        const containerRect = document.getElementById('canvas-container')?.getBoundingClientRect();
        if (!containerRect) return;

        const scaleX = this.automaton.canvas.width / canvasRect.width;
        const scaleY = this.automaton.canvas.height / canvasRect.height;

        overlay.style.cssText = `
            display: block;
            position: absolute;
            left: ${canvasRect.left - containerRect.left + minX * cellSize / scaleX}px;
            top: ${canvasRect.top - containerRect.top + minY * cellSize / scaleY}px;
            width: ${(maxX - minX + 1) * cellSize / scaleX}px;
            height: ${(maxY - minY + 1) * cellSize / scaleY}px;
            border: 2px solid #3b82f6;
            pointer-events: none;
            z-index: 10;
        `;
    }

    _createDragPreview() {
        this._removeDragPreview();
        if (!this.selectionContent) return;

        const dragPreview = document.createElement('div');
        dragPreview.id = 'dragPreview';
        dragPreview.className = 'drag-preview';

        const canvas = document.createElement('canvas');
        const width = this.selectionContent.width;
        const height = this.selectionContent.height;
        const cellSize = this.automaton.cellSize;
        canvas.width = width * cellSize;
        canvas.height = height * cellSize;

        const ctx = canvas.getContext('2d');

        // Fondo semitransparente sutil para delimitar el área
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Celdas vivas en su color real con transparencia para ver el destino debajo
        ctx.fillStyle = 'rgba(5, 150, 105, 0.65)';
        const drawSize = cellSize > 2 ? cellSize - 2 : cellSize;
        const drawOffset = cellSize > 2 ? 1 : 0;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                if (this.selectionContent.grid[x][y]) {
                    ctx.fillRect(
                        x * cellSize + drawOffset,
                        y * cellSize + drawOffset,
                        drawSize,
                        drawSize
                    );
                }
            }
        }

        dragPreview.appendChild(canvas);
        document.getElementById('canvas-container')?.appendChild(dragPreview);

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        this._updateDragPreview(minX, minY);
    }

    _updateDragPreview(targetX, targetY) {
        const dragPreview = document.getElementById('dragPreview');
        if (!dragPreview) return;

        dragPreview.dataset.targetX = targetX;
        dragPreview.dataset.targetY = targetY;

        const width = this.selectionContent.width;
        const height = this.selectionContent.height;
        const cellSize = this.automaton.cellSize;
        const canvasRect = this.automaton.canvas.getBoundingClientRect();
        const containerRect = document.getElementById('canvas-container')?.getBoundingClientRect();
        if (!containerRect) return;

        const scaleX = this.automaton.canvas.width / canvasRect.width;
        const scaleY = this.automaton.canvas.height / canvasRect.height;

        dragPreview.style.cssText = `
            position: absolute;
            left: ${canvasRect.left - containerRect.left + targetX * cellSize / scaleX}px;
            top: ${canvasRect.top - containerRect.top + targetY * cellSize / scaleY}px;
            width: ${width * cellSize / scaleX}px;
            height: ${height * cellSize / scaleY}px;
            border: 2px ${this.isCopying ? 'dashed #10b981' : 'solid #3b82f6'};
            z-index: 5;
            pointer-events: none;
        `;
    }

    _removeDragPreview() {
        document.getElementById('dragPreview')?.remove();
    }

    _showSelectionInfo() {
        if (!this.selection) return;

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;

        let infoDiv = document.getElementById('selectionInfo');
        if (!infoDiv) {
            infoDiv = document.createElement('div');
            infoDiv.id = 'selectionInfo';
            infoDiv.className = 'selection-info';
            document.querySelector('.canvas-controls')?.appendChild(infoDiv);
        }

        infoDiv.innerHTML = `
            <div class="selection-info-content">
                <span><i class="fa-regular fa-object-group"></i> ${width}×${height}</span>
                <button id="deleteSelectionBtn" class="btn-small"><i class="fas fa-trash"></i></button>
                <button id="clearSelectionBtn" class="btn-small"><i class="fas fa-times"></i></button>
            </div>
        `;
        infoDiv.style.display = 'block';
    }

    _hideSelectionInfo() {
        document.getElementById('selectionInfo')?.remove();
    }

    // =========================================
    // UTILIDADES
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
    // FLOOD FILL (bote de pintura)
    // =========================================

    /**
     * BFS iterativo desde (startX, startY).
     * Rellena todas las celdas contiguas con el mismo estado que la celda origen
     * cambiándolas a `fillState`. Respeta los bordes del grid (no toroidal).
     *
     * @param {number} startX
     * @param {number} startY
     * @param {number} fillState - 0 (limpiar) o 1 (llenar)
     */
    _floodFill(startX, startY, fillState) {
        const size = this.automaton.gridSize;
        const langton = this.automaton.specialMode === SpecialEngineManager.MODES.LANGTON && this.automaton.langtonEngine?.isActive;
        const rd2d = this.automaton.specialMode === SpecialEngineManager.MODES.RD2D && this.automaton.rd2dEngine?.isActive;
        const generations = this.automaton.specialMode === SpecialEngineManager.MODES.GENERATIONS && this.automaton.generationsEngine?.isActive;

        // En RD2D la fuente de verdad visual es stateGrid. grid[][] está sincronizado
        // con stateGrid para detectar paredes, así que se usa igual que modo normal.
        // La diferencia es solo en la escritura: hay que actualizar también stateGrid.
        const rd2dStateGrid = rd2d ? this.automaton.rd2dEngine.stateGrid : null;
        const genStateGrid = generations ? this.automaton.generationsEngine.stateGrid : null;

        const getState = (gx, gy) => this.automaton.grid[gx]?.[gy] ?? 0;

        const targetState = getState(startX, startY);
        if (targetState === fillState) return;

        const visited = new Uint8Array(size * size);
        // BFS con puntero de cabeza — evita queue.shift() O(n) en cada iteración.
        const queue = [startX * size + startY];
        let head = 0;
        visited[queue[0]] = 1;

        while (head < queue.length) {
            const idx = queue[head++];
            const x = (idx / size) | 0;
            const y = idx % size;

            if (rd2d) {
                rd2dStateGrid[x][y] = fillState === 1 ? 15 : 0;
                this.automaton.grid[x][y] = fillState;
            } else if (generations) {
                genStateGrid[x][y] = fillState ? 1 : 0;
                this.automaton.grid[x][y] = fillState;
            } else {
                this.automaton.grid[x][y] = fillState;
            }
            this.automaton.renderer.markDirtyIndex(idx);

            // Langton: sincronizar con el engine usando su API, no sus campos internos.
            // (acceso directo a langtonEngine aceptable aquí por razones de rendimiento
            // en batch, igual que rd2dStateGrid; addAnt incluye la guarda de deduplicación)
            if (langton) {
                if (fillState === 1) {
                    this.automaton.langtonEngine.addAnt(x, y, 0);
                } else {
                    this.automaton.eraseEngineAt(x, y);
                }
            }

            // 4 vecinos (Von Neumann)
            const x1 = x - 1, x2 = x + 1;
            const y1 = y - 1, y2 = y + 1;
            if (x1 >= 0) {
                const ni = x1 * size + y;
                if (!visited[ni] && getState(x1, y) === targetState) {
                    visited[ni] = 1;
                    queue.push(ni);
                }
            }
            if (x2 < size) {
                const ni = x2 * size + y;
                if (!visited[ni] && getState(x2, y) === targetState) {
                    visited[ni] = 1;
                    queue.push(ni);
                }
            }
            if (y1 >= 0) {
                const ni = x * size + y1;
                if (!visited[ni] && getState(x, y1) === targetState) {
                    visited[ni] = 1;
                    queue.push(ni);
                }
            }
            if (y2 < size) {
                const ni = x * size + y2;
                if (!visited[ni] && getState(x, y2) === targetState) {
                    visited[ni] = 1;
                    queue.push(ni);
                }
            }
        }

        if (head > 0) {
            this.automaton.updateStats();
            this.automaton.syncEngineAfterEdit();
            this.automaton.render();
        }
    }

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

window.CanvasController = CanvasController;