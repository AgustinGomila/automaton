class UIController {
    constructor(automatonInstance) {
        // Requerir automaton en el momento de crear la instancia
        if (!automatonInstance) {
            throw new Error('UIController requiere una instancia de CellularAutomaton');
        }

        this.automaton = automatonInstance;

        this.showInfluenceArea = false;
        this.patternsTwoRows = false;
        this.patternsCompactView = false;
        this.rulesLoaded = false;

        this._gridSizeDebounceTimer = null;
        this._gridSizePendingValue = null;

        this.isMouseDown = false;
        this.lastCell = null;
        this.isSelecting = false;
        this.selection = null;
        this.selectionContent = null;
        this.isDragging = false;
        this.isCopying = false;
        this.dragOffset = null;

        this.ctrlPressed = false;
        this.shiftPressed = false;

        this._throttledMouseMove = this._throttle(this._handleMouseMove.bind(this), 16);
        this._cleanups = [];
        this._mouseTimeout = null;

        window.selectedPatternKey = null;
        window.selectedPattern = null;
        window.selectedPatternRotation = 0;

        // Suscribirse AHORA, ANTES de que automata empiece a emitir
        this._subscribeToAutomatonEvents();

        this._waitForRulesAndInit().then();
    }

    async _waitForRulesAndInit() {
        console.log('UIController: Esperando reglas...');

        let attempts = 0;
        while ((!window.RULES || Object.keys(window.RULES).length === 0) && attempts < 100) {
            await new Promise(resolve => setTimeout(resolve, 50));
            attempts++;
        }

        console.log(`✅ UIController: ${Object.keys(window.RULES).length} reglas disponibles`);

        this._init().then()
    }

    async _init() {
        await this._waitForRules();
        this._bindEvents();
        this._bindKeyboardEvents();
        this._bindPatternEvents();
        this._bindNeighborhoodEvents();
        this._bindPatternsControls();

        this.updateSpeedDisplay();
        this.updateGridSizeDisplay();
        this.updateCellSizeDisplay();
        this.updateNeighborhoodInfo();
        this.loadRules();

        eventBus.emit('ui:ready');
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    destroy() {
        this._cleanups.forEach(cleanup => cleanup());
        this._cleanups = [];

        if (this._mouseTimeout) clearTimeout(this._mouseTimeout);

        if (this._gridSizeDebounceTimer) {
            clearTimeout(this._gridSizeDebounceTimer);
        }

        this._removeSelectionVisual();
        this._removeDragPreview();
        this._hideSelectionInfo();

        eventBus.emit('ui:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        const cleanup = () => target.removeEventListener(event, handler, options);
        this._cleanups.push(cleanup);
        return cleanup;
    }

    _subscribeToAutomatonEvents() {
        if (!this.automaton) {
            console.warn('UIController: No hay autómata para suscribirse');
            return;
        }

        console.log('🔔 UIController: Suscribiendo a eventos del automata...');

        const weakThis = new WeakRef(this);

        this._cleanups.push(
            // ESTADÍSTICAS
            eventBus.on('stats:updated', (stats) => {
                const ui = weakThis.deref();
                if (ui) {
                    ui._updateStatsDisplay(stats);
                }
            }),

            // REGLAS
            eventBus.on('automaton:ruleChanged', () => {
                weakThis.deref()?.updateHeaderInfo();
            }),

            // VECINDAD
            eventBus.on('automaton:neighborhoodChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui.updateHeaderInfo();
                    ui.updateNeighborhoodInfo();
                }
            }),

            // RADIO
            eventBus.on('automaton:radiusChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui.updateHeaderInfo();
                    ui.updateNeighborhoodInfo();
                }
            }),

            // === WRAP (MUROS/TOROIDAL) ===
            eventBus.on('automaton:wrapChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui.updateHeaderInfo();
                    ui.updateNeighborhoodInfo();
                }
            })
        );

        console.log('✅ UIController: Suscrito a TODOS los eventos');
    }

    async _waitForRules() {
        if (window.RULES && Object.keys(window.RULES).length > 0) {
            this.rulesLoaded = true;
            return;
        }

        await new Promise(resolve => {
            const check = () => {
                if (window.RULES && Object.keys(window.RULES).length > 0) {
                    this.rulesLoaded = true;
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    loadRules() {
        console.log('=== loadRules() EJECUTÁNDOSE ===');
        console.log('window.RULES:', window.RULES);
        console.log('Cantidad:', Object.keys(window.RULES || {}).length);

        const selector = document.getElementById('ruleSelector');
        if (!selector) {
            console.error('❌ SELECTOR NO ENCONTRADO EN DOM');
            return;
        }

        // Limpiar y llenar
        while (selector.options.length > 0) {
            selector.remove(0);
        }

        Object.keys(window.RULES).forEach((key, index) => {
            const rule = window.RULES[key];
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${rule.name} (${rule.ruleString})`;
            selector.appendChild(option);
            console.log(`✅ Regla ${index + 1}: ${rule.name}`);
        });

        console.log(`=== ${Object.keys(window.RULES).length} reglas cargadas ===`);

        if (window.RULES.conway) {
            selector.value = 'conway';
            this.updateRuleInfo(window.RULES.conway);
        }
    }

    // =========================================
    // THROTTLING
    // =========================================

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

    // =========================================
    // BINDING DE EVENTOS
    // =========================================

    _bindEvents() {
        // Controles principales
        this._addEventListener(document.getElementById('playBtn'), 'click', () => this.togglePlay());
        this._addEventListener(document.getElementById('stepBtn'), 'click', () => this.step());
        this._addEventListener(document.getElementById('randomBtn'), 'click', () => this.randomize());
        this._addEventListener(document.getElementById('clearBtn'), 'click', () => this.clear());
        this._addEventListener(document.getElementById('cancelPatternBtn'), 'click', () => {
            this.deselectPattern();
            window.selectedPatternRotation = 0;
        });

        // Reglas
        this._addEventListener(document.getElementById('ruleSelector'), 'change', () => this.changeRule());
        this._addEventListener(document.getElementById('applyCustomRuleBtn'), 'click', () => this.applyCustomRule());

        // Toggle área de influencia
        this._addEventListener(document.getElementById('influenceToggle'), 'change', () => this.toggleInfluenceArea());
        this._addEventListener(document.getElementById('quickInfluenceToggle'), 'click', () => this.quickToggleInfluenceArea());

        // Tablero toroidal o finito
        const wrapToggle = document.getElementById('wrapToggle');
        if (wrapToggle) {
            this._addEventListener(wrapToggle, 'change', () => {
                this.automaton.wrapEdges = wrapToggle.checked;
                this.automaton.generation = 0;
                this.automaton.updateStats();
                this.automaton._markAllDirty();
                this.automaton.render();
                this.updateNeighborhoodInfo(); // ACTUALIZAR INMEDIATAMENTE

                // Emitir evento para cualquier otro listener
                eventBus.emit('automaton:wrapChanged', {wrap: wrapToggle.checked});
            });
        }

        // Web workers
        const workerToggle = document.getElementById('workerToggle');
        if (workerToggle) {
            workerToggle.checked = this.automaton.worker !== null;
            this._addEventListener(workerToggle, 'change', (e) => {
                if (e.target.checked) {
                    this.automaton._initWorker();
                } else {
                    if (this.automaton.worker) {
                        this.automaton.worker.terminate();
                        this.automaton.worker = null;
                    }
                }
            });
        }

        // Controles
        this._addEventListener(document.getElementById('speedControl'), 'input', () => this.updateSpeed());
        this._addEventListener(document.getElementById('speedDown'), 'click', () => this.decreaseSpeed());
        this._addEventListener(document.getElementById('speedUp'), 'click', () => this.increaseSpeed());
        this._addEventListener(document.getElementById('gridSize'), 'input', () => this.updateGridSize());
        this._addEventListener(document.getElementById('cellSize'), 'input', () => this.updateCellSize());
        this._addEventListener(document.getElementById('gridToggle'), 'click', () => this.toggleGrid());

        // Exportación
        this._addEventListener(document.getElementById('exportBtn'), 'click', () => this.exportPattern());

        // Scroll de patrones
        this._addEventListener(document.getElementById('scrollLeft'), 'click', () => this.scrollPatterns(-100));
        this._addEventListener(document.getElementById('scrollRight'), 'click', () => this.scrollPatterns(100));

        // Límites
        this._addEventListener(document.getElementById('limitType'), 'change', () => this.updateLimitType());
        this._addEventListener(document.getElementById('limitValue'), 'input', () => this.updateLimitValue());

        // Canvas
        this._bindCanvasEvents();
    }

    _bindCanvasEvents() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        this._addEventListener(canvas, 'mousedown', (e) => this._handleMouseDown(e));
        this._addEventListener(canvas, 'mousemove', this._throttledMouseMove);
        this._addEventListener(canvas, 'mouseup', (e) => this._handleMouseUp(e));
        this._addEventListener(canvas, 'mouseleave', () => this._handleMouseLeave());
        this._addEventListener(canvas, 'contextmenu', (e) => this._handleRightClick(e));

        this._setupTouchEvents();
    }

    _handleMouseDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();

        this.isMouseDown = true;
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

        if (window.selectedPattern) {
            this.automaton.importPattern(window.selectedPattern, x, y);
            return;
        }

        const changed = this.automaton.setCell(x, y, !this.ctrlPressed);
        if (changed) {
            this.automaton.updateStats();
            this.automaton.render();
        }
    }

    _handleMouseMove(e) {
        const {x, y} = this.automaton.getCellFromMouse(e);
        this.updateMouseCoords(x, y);

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

        if (this.isSelecting) {
            this.endSelection();
        }

        if (this.isDragging) {
            this.endDrag();
        }

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

        if (window.selectedPattern && window.selectedPattern.pattern !== 'random') {
            window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;
            window.selectedPattern = getPatternWithRotation(
                window.selectedPatternKey,
                window.selectedPatternRotation
            );

            // Actualizar info del patrón
            updatePatternInfo();

            // Obtener coordenadas del mouse
            const {x, y} = this.automaton.getCellFromMouse(e);

            // Actualizar preview del patrón
            showPatternPreview(x, y);

            // === Actualizar área de influencia SIEMPRE si está activa ===
            if (this.showInfluenceArea) {
                showInfluenceArea(x, y);
            }
        }

        return false;
    }

    // =========================================
    // DIBUJO CONTINUO
    // =========================================

    handleContinuousDrawing(x, y) {
        if (!this.lastCell || (this.lastCell.x === x && this.lastCell.y === y)) {
            this.lastCell = {x, y};
            return;
        }

        const cells = this._getLineCells(this.lastCell.x, this.lastCell.y, x, y);
        let needsRender = false;

        for (const cell of cells) {
            if (cell.x === this.lastCell.x && cell.y === this.lastCell.y) continue;

            const state = !this.ctrlPressed;
            const changed = this.automaton.setCell(cell.x, cell.y, state);
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

        while (true) {
            cells.push({x: x0, y: y0});
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
        }

        return cells;
    }

    // =========================================
    // SELECCIÓN Y ARRASTRE
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

        const targetX = x - this.dragOffset.x;
        const targetY = y - this.dragOffset.y;
        this._updateDragPreview(targetX, targetY);
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
            this.selectionContent = this.automaton.copyArea(targetX, targetY, targetX + width - 1, targetY + height - 1);
        } else {
            this.selection.startX = targetX;
            this.selection.startY = targetY;
            this.selection.endX = targetX + width - 1;
            this.selection.endY = targetY + height - 1;
            this.selectionContent = this.automaton.copyArea(targetX, targetY, targetX + width - 1, targetY + height - 1);
        }

        this._removeDragPreview();
        this._updateSelectionVisual();
        this._showSelectionInfo();
    }

    // =========================================
    // VISUALIZACIÓN
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
                    ctx.fillRect(x * this.automaton.cellSize + 1, y * this.automaton.cellSize + 1,
                        this.automaton.cellSize - 2, this.automaton.cellSize - 2);
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

        document.getElementById('deleteSelectionBtn')?.addEventListener('click', () => this.deleteSelection());
        document.getElementById('clearSelectionBtn')?.addEventListener('click', () => this.clearSelection());
        infoDiv.style.display = 'block';
    }

    _hideSelectionInfo() {
        document.getElementById('selectionInfo')?.remove();
    }

    // =========================================
    // EVENTOS DE TECLADO
    // =========================================

    _bindKeyboardEvents() {
        this._addEventListener(document, 'keydown', (e) => this._handleKeyDown(e));
        this._addEventListener(document, 'keyup', (e) => this._handleKeyUp(e));
    }

    _handleKeyDown(e) {
        if (e.key === 'Control') this.ctrlPressed = true;
        if (e.key === 'Shift') this.shiftPressed = true;

        switch (e.key.toLowerCase()) {
            case 'escape':
                this.deselectPattern();
                this.clearSelection();
                window.selectedPatternRotation = 0;
                break;
            case ' ':
                e.preventDefault();
                this.togglePlay();
                break;
            case 's':
                this.step();
                break;
            case 'r':
                if (window.selectedPattern?.pattern !== 'random') {
                    window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;
                    window.selectedPattern = getPatternWithRotation(window.selectedPatternKey, window.selectedPatternRotation);
                    updatePatternInfo();
                }
                break;
            case 'a':
                this.randomize();
                break;
            case 'c':
                this.clear();
                break;
            case 'delete':
                if (this.selection) {
                    e.preventDefault();
                    this.deleteSelection();
                }
                break;
        }
    }

    _handleKeyUp(e) {
        if (e.key === 'Control') this.ctrlPressed = false;
        if (e.key === 'Shift') this.shiftPressed = false;
    }

    // =========================================
    // CONTROL PRINCIPAL
    // =========================================

    togglePlay() {
        if (this.automaton.isLimitReached) {
            this.automaton.isLimitReached = false;
            this.automaton.generation = 0;
            this.automaton.updateStats();
        }

        const isRunning = this.automaton.toggleRunning();
        const playIcon = document.getElementById('playIcon');
        const playText = document.getElementById('playText');
        const stepBtn = document.getElementById('stepBtn');

        if (playIcon) playIcon.className = isRunning ? 'fas fa-pause' : 'fas fa-play';
        if (playText) playText.textContent = isRunning ? 'Pausar' : 'Ejecutar';
        if (stepBtn) stepBtn.disabled = isRunning;
    }

    step() {
        this.automaton.nextGeneration();
        this.automaton.render();
    }

    randomize() {
        this.automaton.randomize();
    }

    clear() {
        this.automaton.clear();
    }

    updateSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        this.automaton.setSpeed(value);
        this.updateSpeedDisplay();
    }

    decreaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(slider.value) - 1;
        if (value < 1) value = 1;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    increaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(slider.value) + 1;
        if (value > 10) value = 10;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    updateSpeedDisplay() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        const speedTexts = ['Muy Lento', 'Lento', 'Normal', 'Rápido', 'Muy Rápido'];
        const index = Math.min(Math.max(Math.floor((value - 1) / 2), 0), speedTexts.length - 1);

        const display = document.getElementById('speedValue');
        if (display) display.textContent = `${speedTexts[index]} (${value}/10)`;
    }

    updateGridSize() {
        const slider = document.getElementById('gridSize');
        const value = parseInt(slider.value);
        const display = document.getElementById('gridSizeValue');
        if (display) display.textContent = `${value}×${value}`;

        // Cancelar timer anterior
        if (this._gridSizeDebounceTimer) {
            clearTimeout(this._gridSizeDebounceTimer);
        }

        // Guardar valor pendiente
        this._gridSizePendingValue = value;

        // Crear nuevo timer de 500ms
        this._gridSizeDebounceTimer = setTimeout(() => {
            this._applyGridSizeChange();
        }, 500);
    }

    _applyGridSizeChange() {
        if (this._gridSizePendingValue === null) return;

        const value = this._gridSizePendingValue;
        this._gridSizePendingValue = null;

        if (!this.automaton.isRunning || confirm('Cambiar el tamaño detendrá la simulación. ¿Continuar?')) {
            if (this.automaton.isRunning) this.togglePlay();
            this.automaton.resizeGrid(value);
        }

        this._gridSizeDebounceTimer = null;
    }

    updateGridSizeDisplay() {
        const slider = document.getElementById('gridSize');
        const value = parseInt(slider.value);
        const display = document.getElementById('gridSizeValue');
        if (display) display.textContent = `${value}×${value}`;
    }

    updateCellSize() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        const display = document.getElementById('cellSizeValue');
        if (display) display.textContent = `${value}px`;

        this.automaton.setCellSize(value);
    }

    updateCellSizeDisplay() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        const display = document.getElementById('cellSizeValue');
        if (display) display.textContent = `${value}px`;
    }

    toggleGrid() {
        this.automaton.toggleGrid();
    }

    toggleInfluenceArea() {
        const toggle = document.getElementById('influenceToggle');
        this.showInfluenceArea = toggle.checked;

        const quickToggle = document.getElementById('quickInfluenceToggle');
        if (quickToggle) {
            quickToggle.className = this.showInfluenceArea ? 'btn-toggle active' : 'btn-toggle';
            quickToggle.style.color = this.showInfluenceArea ? 'var(--secondary)' : '';
        }

        if (!this.showInfluenceArea) {
            hideInfluenceArea();
        }
    }

    quickToggleInfluenceArea() {
        this.showInfluenceArea = !this.showInfluenceArea;
        const toggle = document.getElementById('influenceToggle');
        if (toggle) toggle.checked = this.showInfluenceArea;
        this.toggleInfluenceArea();
    }

    scrollPatterns(direction) {
        const container = document.getElementById('patternsContainer');
        if (container) container.scrollLeft += direction;
    }

    exportPattern() {
        const pattern = this.automaton.exportPattern();
        if (pattern) {
            const blob = new Blob([JSON.stringify(pattern, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `my-pattern-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert('Patrón exportado correctamente');
        } else {
            alert('No hay patrón para exportar. Dibuja algo primero.');
        }
    }

    updateLimitType() {
        const select = document.getElementById('limitType');
        const valueGroup = document.getElementById('limitValueGroup');
        const limitValue = document.getElementById('limitValue');

        if (select.value === 'none') {
            valueGroup.style.display = 'none';
            this.automaton.setLimit('none', 0);
        } else {
            valueGroup.style.display = 'block';
            this.automaton.setLimit(select.value, parseInt(limitValue.value));
        }

        this.automaton.isLimitReached = false;
    }

    updateLimitValue() {
        const select = document.getElementById('limitType');
        const slider = document.getElementById('limitValue');
        const value = parseInt(slider.value);

        const display = document.getElementById('limitValueDisplay');
        if (display) display.textContent = value.toLocaleString();

        if (select.value !== 'none') {
            this.automaton.setLimit(select.value, value);
        }
    }

    changeRule() {
        const selector = document.getElementById('ruleSelector');
        const customRuleGroup = document.getElementById('customRuleGroup');

        if (selector.value === 'custom') {
            customRuleGroup.style.display = 'block';
            document.getElementById('birthInput').value = this.automaton.rule.birth.join(',');
            document.getElementById('survivalInput').value = this.automaton.rule.survival.join(',');
        } else {
            customRuleGroup.style.display = 'none';
            if (window.RULES?.[selector.value]) {
                this.automaton.setRule(window.RULES[selector.value].survival, window.RULES[selector.value].birth);
                this.updateHeaderInfo();
            }
        }
    }

    applyCustomRule() {
        const birthInput = document.getElementById('birthInput').value;
        const survivalInput = document.getElementById('survivalInput').value;

        try {
            const customRule = parseCustomRule(birthInput, survivalInput);
            this.automaton.setRule(customRule.survival, customRule.birth);
            alert(`Regla personalizada aplicada: B${customRule.birth.join('')}/S${customRule.survival.join('')}`);
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    toggleWrapMode() {
        this.automaton.wrapEdges = !this.automaton.wrapEdges;

        if (this.automaton.isRunning) {
            this.automaton.stop();
        }

        this.automaton.generation = 0;
        this.automaton.isLimitReached = false;

        this.automaton._markAllDirty();
        this.automaton.updateStats();
        this.automaton.render();

        // Actualizar UI
        const status = this.automaton.wrapEdges ? 'Toroidal' : 'Paredes Duras';
        console.log(`🔲 Modo de frontera: ${status}`);

        eventBus.emit('automaton:wrapChanged', {wrap: this.automaton.wrapEdges});
    }

    changeNeighborhoodType(type) {
        this.automaton.setNeighborhoodType(type);
        this.updateHeaderInfo();
    }

    changeNeighborhoodRadius(radius) {
        this.automaton.setNeighborhoodRadius(radius);
        this.updateHeaderInfo();
        const radiusValue = document.getElementById('radiusValue');
        if (radiusValue) radiusValue.textContent = radius;
    }

    updateHeaderInfo() {
        console.log('🔄 updateHeaderInfo() ejecutándose...');

        const selector = document.getElementById('ruleSelector');
        if (!selector) {
            console.warn('Selector de reglas no encontrado');
            return;
        }

        const ruleKey = selector.value;
        if (window.RULES?.[ruleKey]) {
            this.updateRuleInfo(window.RULES[ruleKey]);
            console.log('✅ Header de regla actualizado:', window.RULES[ruleKey].name);
        }

        this.updateNeighborhoodInfo();
        console.log('✅ Header de vecindad actualizado');
    }

    updateRuleInfo(rule) {
        const rulesSpecific = document.getElementById('rulesSpecific');
        if (!rulesSpecific) {
            console.warn('Elemento rulesSpecific no encontrado');
            return;
        }

        rulesSpecific.innerHTML = `
    <p><span class="birth"><i class="fas fa-seedling"></i> Nacimiento:</span> ${rule.birth.join(', ')} vecinos</p>
    <p><span class="survival"><i class="fas fa-heart"></i> Supervivencia:</span> ${rule.survival.join(', ')} vecinos</p>
    <p class="notation">Notación: <span class="highlight">${rule.ruleString}</span></p>
  `;

        document.title = `Autómata Celular - ${rule.name} ${rule.ruleString}`;
        const headerTitle = document.querySelector('h1');
        if (headerTitle) {
            headerTitle.innerHTML = `<i class="fas fa-cogs"></i> Autómata - ${rule.name}`;
        }
    }

    _bindNeighborhoodEvents() {
        const typeSelect = document.getElementById('neighborhoodType');
        const radiusSlider = document.getElementById('neighborhoodRadius');

        if (typeSelect) {
            this._addEventListener(typeSelect, 'change', (e) => this.changeNeighborhoodType(e.target.value));
        }

        if (radiusSlider) {
            this._addEventListener(radiusSlider, 'input', (e) => {
                this.changeNeighborhoodRadius(parseInt(e.target.value));
                const radiusValue = document.getElementById('radiusValue');
                if (radiusValue) radiusValue.textContent = e.target.value;
            });
        }
    }

    updateNeighborhoodInfo() {
        const infoElement = document.getElementById('neighborhoodInfo');
        if (!infoElement || !this.automaton) {
            console.warn('❌ Elemento neighborhoodInfo o automaton no encontrado');
            return;
        }

        const type = this.automaton.neighborhoodType === 'moore' ? 'Moore' : 'Neumann';
        const radius = this.automaton.neighborhoodRadius;
        const wrap = this.automaton.wrapEdges ? '∞' : '▏▕'; // Símbolos visuales

        infoElement.innerHTML = `<i class="fas fa-crosshairs"></i> Vecindad: ${type} (R${radius}) ${wrap}`;

        console.log(`🏘️ Neighborhood info actualizada: ${type} radio ${radius} ${wrap}`);
    }

    _bindPatternsControls() {
        const toggleRowsBtn = document.getElementById('patternsToggleRows');
        const toggleCompactBtn = document.getElementById('patternsToggleCompact');
        const container = document.getElementById('patternsContainer');

        if (toggleRowsBtn && container) {
            this._addEventListener(toggleRowsBtn, 'click', () => {
                this.patternsTwoRows = !this.patternsTwoRows;
                container.classList.toggle('two-rows', this.patternsTwoRows);
                const icon = toggleRowsBtn.querySelector('i');
                if (icon) icon.className = this.patternsTwoRows ? 'fas fa-grip-lines-vertical' : 'fas fa-grip-lines';
            });
        }

        if (toggleCompactBtn && container) {
            this._addEventListener(toggleCompactBtn, 'click', () => {
                this.patternsCompactView = !this.patternsCompactView;
                container.classList.toggle('compact-view', this.patternsCompactView);
                document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
                    btn.classList.toggle('compact', this.patternsCompactView);
                });
                const icon = toggleCompactBtn.querySelector('i');
                if (icon) icon.className = this.patternsCompactView ? 'fas fa-expand-alt' : 'fas fa-compress';
            });
        }
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
        });

        this._addEventListener(canvas, 'touchmove', (e) => {
            if (!isTouchDrawing || e.touches.length !== 1) return;
            e.preventDefault();
            const touch = e.touches[0];
            const {x, y} = this.automaton.getCellFromMouse(touch);
            this.automaton.setCell(x, y, true);
            this.automaton.updateStats();
            this.automaton.render();
        });

        this._addEventListener(canvas, 'touchend', (e) => {
            e.preventDefault();
            isTouchDrawing = false;
        });
    }

    _bindPatternEvents() {
        // Escuchar eventos DEL EVENTBUS (nueva arquitectura)
        this._cleanups.push(
            eventBus.on('pattern:selected', () => {
                console.log('UIController: Evento pattern:selected recibido');
                this.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:updated', () => {
                console.log('UIController: Evento pattern:updated recibido');
                this.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:cleared', () => {
                console.log('UIController: Evento pattern:cleared recibido');
                this.updateDrawModeIndicator();
            })
        );

        // Botón Cancelar (evento DOM directo)
        const cancelBtn = document.getElementById('cancelPatternBtn');
        if (cancelBtn) {
            this._addEventListener(cancelBtn, 'click', () => {
                this.deselectPattern();
            });
        }
    }

    deselectPattern() {
        window.selectedPattern = null;
        window.selectedPatternKey = null;
        window.selectedPatternRotation = 0;

        document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
            btn.classList.remove('active');
        });

        const miniEl = document.getElementById('patternNameMini');
        if (miniEl) miniEl.textContent = 'Selecciona un patrón';

        hidePatternPreview();
        hideInfluenceArea();
        this.updateDrawModeIndicator();
    }

    updateDrawModeIndicator() {
        const indicator = document.getElementById('drawModeIndicator');
        if (!indicator) return;

        if (window.selectedPattern) {
            indicator.className = 'pattern-mode-indicator pattern-selected';
            indicator.textContent = `Modo: Patrón - ${window.selectedPattern.name}`;
        } else {
            indicator.className = 'pattern-mode-indicator free-draw';
            indicator.textContent = 'Modo: Dibujo libre';
        }
    }

    updateMouseCoords(x, y) {
        const coords = document.getElementById('mouseCoords');
        if (coords) coords.textContent = `X: ${x}, Y: ${y}`;
    }

    _updateStatsDisplay(stats) {
        const genEl = document.getElementById('generation');
        const popEl = document.getElementById('population');
        const densEl = document.getElementById('density');

        if (!genEl || !popEl || !densEl) {
            console.warn('❌ Elementos de estadísticas no encontrados');
            return;
        }

        genEl.textContent = (stats.generation || 0).toLocaleString();
        popEl.textContent = (stats.population || 0).toLocaleString();
        densEl.textContent = `${stats.density || 0}%`;

        console.log(`📊 Stats actualizadas: G${stats.generation} P${stats.population}`);
    }
}