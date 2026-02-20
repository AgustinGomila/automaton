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
        this.ctrlPressed = false;
        this.shiftPressed = false;

        // Estado visual
        this.showInfluenceArea = false;

        // Internos
        this._cleanups = [];
        this._mouseTimeout = null;
        this._throttledMouseMove = this._throttle(this._handleMouseMove.bind(this), 16);

        this._bindEvents();
        this._setupSelectionDelegation();
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

            if (window.selectedPattern) {
                this.automaton.importPattern(window.selectedPattern, x, y);
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

        if (this.automaton.specialMode === 'triangle' && this.automaton.triangleEngine?.isActive) {
            const result = this.automaton.renderer.getCellFromMouse(e.clientX, e.clientY);
            if (result) {
                this.lastCell = {q: result.q, r: result.r, mode: 'triangle'};
                const state = !this.ctrlPressed ? 1 : 0;
                const changed = this.automaton.triangleEngine.gridManager.setCell(result.q, result.r, state);
                if (changed) {
                    this.automaton.renderer.markDirty(result.q, result.r);
                    this.automaton.renderer.render();
                    this.automaton.updateStats(this.automaton.triangleEngine.gridManager.countPopulation());
                }
            }
            return;
        }

        const {x, y} = this.automaton.getCellFromMouse(e);
        this.lastCell = {x, y};

        if (this.shiftPressed && !this.ctrlPressed && !this.selection) {
            this.startSelection(x, y);
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

        const changed = this.automaton.setCell(x, y, !this.ctrlPressed);
        if (changed) {
            this.automaton.updateStats();
            this.automaton.render();
        }
    }

    _handleMouseMove(e) {
        if (this.automaton.specialMode === 'triangle' && this.automaton.triangleEngine?.isActive) {
            const result = this.automaton.renderer.getCellFromMouse(e.clientX, e.clientY);
            if (result) {
                this._updateMouseCoords(result.q, result.r);

                if (this.isMouseDown && this.lastCell?.mode === 'triangle') {
                    const {q, r} = result;
                    if (this.lastCell.q === q && this.lastCell.r === r) return;

                    const state = !this.ctrlPressed ? 1 : 0;
                    const changed = this.automaton.triangleEngine.gridManager.setCell(q, r, state);
                    if (changed) {
                        this.automaton.renderer.markDirty(q, r);
                        this.automaton.renderer.render();
                        this.lastCell = {q, r, mode: 'triangle'};
                    }
                }
            }
            return;
        }

        const {x, y} = this.automaton.getCellFromMouse(e);
        this._updateMouseCoords(x, y);

        if (window.selectedPattern) {
            showPatternPreview(x, y);
            if (this.showInfluenceArea) showInfluenceArea(x, y);
        } else {
            hidePatternPreview();
            if (this.showInfluenceArea && !this.selection) showInfluenceArea(x, y);
        }

        if (this.isMouseDown) {
            if (this.isSelecting) {
                this.updateSelection(x, y);
            } else if (this.isDragging) {
                this.updateDrag(x, y);
            } else if (!window.selectedPattern) {
                this.handleContinuousDrawing(x, y);
            }
        }
    }

    _handleMouseUp(e) {
        if (e.button !== 0) return;

        this.isMouseDown = false;

        if (this.isSelecting) this.endSelection();
        if (this.isDragging) this.endDrag();

        this.lastCell = null;
    }

    _handleMouseLeave() {
        this.isMouseDown = false;
        if (this.isSelecting) this.endSelection();
        if (this.isDragging) this.endDrag();

        hidePatternPreview();
        if (!this.showInfluenceArea) hideInfluenceArea();

        this.lastCell = null;
    }

    _handleRightClick(e) {
        e.preventDefault();

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
            showPatternPreview(x, y);
            if (this.showInfluenceArea) showInfluenceArea(x, y);
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
            this.automaton.clearArea(minX, minY, maxX, maxY);
        }

        this.automaton.pasteArea(this.selectionContent, targetX, targetY);

        if (this.isCopying) {
            this.selectionContent = this.automaton.copyArea(
                targetX, targetY, targetX + width - 1, targetY + height - 1
            );
        } else {
            this.selection.startX = targetX;
            this.selection.startY = targetY;
            this.selection.endX = targetX + width - 1;
            this.selection.endY = targetY + height - 1;
            this.selectionContent = this.automaton.copyArea(
                targetX, targetY, targetX + width - 1, targetY + height - 1
            );
        }

        this._removeDragPreview();
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
        canvas.width = width * this.automaton.cellSize;
        canvas.height = height * this.automaton.cellSize;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                if (this.selectionContent.grid[x][y]) {
                    ctx.fillStyle = '#3b82f6';
                    ctx.fillRect(
                        x * this.automaton.cellSize + 1,
                        y * this.automaton.cellSize + 1,
                        this.automaton.cellSize - 2,
                        this.automaton.cellSize - 2
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
                <span><i class="fas fa-vector-square"></i> ${width}×${height}</span>
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