/**
 * SelectionManager — Gestión de selección rectangular y arrastre de contenido.
 *
 * Responsabilidades:
 *   - Selección rectangular con Shift+drag
 *   - Arrastre (move) y copia (Ctrl+Shift+drag) de la selección
 *   - Eliminación del contenido seleccionado (tecla Delete)
 *   - Overlays visuales: borde de selección, preview de arrastre, badge de dimensiones
 *
 * Estado propio: isSelecting, selection, selectionContent, isDragging, isCopying, dragOffset.
 * No accede a CanvasController — recibe automaton y getters de estado de teclado.
 */
class SelectionManager {

    /**
     * @param {Object}   options
     * @param {Object}   options.automaton        — instancia de CellularAutomaton
     * @param {Function} options.getIsCopying     — () => boolean (Ctrl+Shift durante drag)
     */
    constructor({automaton, getIsCopying}) {
        this.automaton = automaton;
        this._getIsCopying = getIsCopying;

        // Estado de selección
        this.isSelecting = false;
        this.selection = null;   // {startX, startY, endX, endY}
        this.selectionContent = null;   // resultado de automaton.copyArea()

        // Estado de arrastre
        this.isDragging = false;
        this.isCopying = false;
        this.dragOffset = null;        // {x, y}

        // Listeners de document (mousemove/mouseup fuera del canvas durante selección)
        this._docSelectionMove = null;
        this._docSelectionUp = null;
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

        const {minX, maxX, minY, maxY} = this._getBounds();
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
        const {minX, maxX, minY, maxY} = this._getBounds();
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }

    deleteSelection() {
        if (!this.selection) return;
        const {minX, maxX, minY, maxY} = this._getBounds();
        this.automaton.clearArea(minX, minY, maxX, maxY);
        // clearArea → edit-coordinator._commitCells → render() ya actualiza el canvas.
        // NO llamar syncEngineAfterEdit aquí: en Langton, syncFromGrid() reconstruye
        // this.ants desde grid[][] usando la condición stateGrid[x][y] === 0, lo que
        // excluye todas las hormigas activas (stateGrid > 0) y las mata globalmente.
        this.clearSelection();
    }

    // =========================================
    // ARRASTRE
    // =========================================

    startDrag(x, y, isCopy) {
        if (!this.selection || !this.selectionContent) return;
        this.isDragging = true;
        this.isCopying = isCopy;
        const {minX, minY} = this._getBounds();
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

        const {minX, maxX, minY, maxY} = this._getBounds();
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;

        if (!this.isCopying) {
            // Move: borrar solo las celdas vivas originales — no el rectángulo completo
            this.automaton.clearPatternCells(this.selectionContent, minX, minY);
        }

        this.automaton.pasteArea(this.selectionContent, targetX, targetY);

        if (this.isCopying) {
            // En copia: la nueva selección es el contenido recién pegado
            this.selectionContent = this.automaton.copyArea(
                targetX, targetY, targetX + width - 1, targetY + height - 1
            );
        }
        // En move: selectionContent se preserva — es el patrón original sin mezcla.

        this.selection.startX = targetX;
        this.selection.startY = targetY;
        this.selection.endX = targetX + width - 1;
        this.selection.endY = targetY + height - 1;

        this._removeDragPreview();

        // Relocalizar agentes posicionales del engine activo (hormigas Langton).
        // Debe hacerse ANTES de syncEngineAfterMove porque ese método omite
        // langtonEngine.syncFromGrid() — que mataría todas las hormigas activas
        // (syncFromGrid descarta las que tienen stateGrid > 0, es decir, todas).
        if (!this.isCopying) {
            this.automaton.moveEngineAgents(minX, minY, width, height, targetX, targetY);
        }

        // syncEngineAfterMove: como syncEngineAfterEdit pero omite Langton.
        // Para copy usamos syncEngineAfterEdit (no hay agentes que reubicar).
        if (this.isCopying) {
            this.automaton.syncEngineAfterEdit();
        } else {
            this.automaton.syncEngineAfterMove();
        }

        this.automaton.render();
        this._updateSelectionVisual();
        this._showSelectionInfo();
    }

    cancelDrag() {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.isCopying = false;
        this.dragOffset = null;
        this._removeDragPreview();
        // El grid no se modifica — el patrón queda en su posición original
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        this._removeSelectionVisual();
        this._removeDragPreview();
        this._hideSelectionInfo();
        this._detachDocumentSelectionListeners();
        this.selection = null;
        this.selectionContent = null;
        this.dragOffset = null;
        this.automaton = null;
    }

    // =========================================
    // LISTENERS DE DOCUMENT (selección fuera del canvas)
    // =========================================

    /**
     * Adjunta mousemove/mouseup al document para continuar la selección
     * cuando el cursor sale del canvas. getCellFromMouse ya hace clamp a
     * los bounds del grid, por lo que las coordenadas se detienen en el borde.
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

        const {minX, maxX, minY, maxY} = this._getBounds();

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

        // Fondo semitransparente para delimitar el área
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Celdas vivas en su color con transparencia para ver el destino debajo
        ctx.fillStyle = 'rgba(5, 150, 105, 0.65)';
        const drawSize = cellSize > 2 ? cellSize - 2 : cellSize;
        const drawOffset = cellSize > 2 ? 1 : 0;

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                if (this.selectionContent.grid[x][y]) {
                    ctx.fillRect(
                        x * cellSize + drawOffset,
                        y * cellSize + drawOffset,
                        drawSize, drawSize
                    );
                }
            }
        }

        dragPreview.appendChild(canvas);
        document.getElementById('canvas-container')?.appendChild(dragPreview);

        const {minX, minY} = this._getBounds();
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
        const {minX, maxX, minY, maxY} = this._getBounds();
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
                <button id="clearSelectionBtn"  class="btn-small"><i class="fas fa-times"></i></button>
            </div>
        `;
        infoDiv.style.display = 'block';
    }

    _hideSelectionInfo() {
        document.getElementById('selectionInfo')?.remove();
    }

    // =========================================
    // HELPER INTERNO
    // =========================================

    /** Devuelve los bounds normalizados (min/max) de la selección actual. */
    _getBounds() {
        const {startX, startY, endX, endY} = this.selection;
        return {
            minX: Math.min(startX, endX),
            maxX: Math.max(startX, endX),
            minY: Math.min(startY, endY),
            maxY: Math.max(startY, endY),
        };
    }
}

export {SelectionManager};