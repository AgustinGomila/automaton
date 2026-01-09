// UI Controller - Versión simplificada y funcional
class UIController {

    constructor() {
        this.showInfluenceArea = false;
        this.patternsTwoRows = false;
        this.patternsCompactView = false;
        this.rulesLoaded = false;

        // Estados de edición
        this.isMouseDown = false;
        this.lastCell = null;
        this.isSelecting = false;
        this.selection = null;
        this.selectionContent = null;
        this.isDragging = false;
        this.isCopying = false;

        // Estado de teclas
        this.ctrlPressed = false;
        this.shiftPressed = false;

        // Inicializar sin patrón seleccionado
        window.selectedPatternKey = null;
        window.selectedPattern = null;
        window.selectedPatternRotation = 0;

        // Escuchar eventos de cambio de patrón
        this.bindPatternEvents();

        // Inicializar
        this.initUi().then(() => console.log('UI Controller inicializado.'));
    }

    async initUi() {
        await this.waitForRules();
        this.bindEvents();
        this.bindKeyboardEvents();
        this.updateSpeedDisplay();
        this.updateGridSizeDisplay();
        this.updateCellSizeDisplay();
        this.loadRules();
        this.bindNeighborhoodEvents();
        this.bindPatternsControls();
        this.updateNeighborhoodInfo();

        const selector = document.getElementById('ruleSelector');
        if (selector && selector.value && window.RULES) {
            const ruleKey = selector.value;
            const rule = window.RULES[ruleKey];
            if (rule) {
                this.updateRuleInfo(rule);
            }
        }
    }

    async waitForRules() {
        if (window.RULES && Object.keys(window.RULES).length > 0) {
            this.rulesLoaded = true;
            return;
        }

        console.log('Esperando carga de reglas...');

        if (window.rulesLoader) {
            await window.rulesLoader.load();
            this.rulesLoaded = true;
        } else {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (window.RULES) {
                this.rulesLoaded = true;
            } else {
                await window.rulesLoader.loadEmbeddedRules();
                this.rulesLoaded = true;
            }
        }
    }

    loadRules() {
        const selector = document.getElementById('ruleSelector');
        if (!selector) return;

        if (!window.RULES) {
            this.showRuleLoadError();
            return;
        }

        while (selector.options.length > 1) {
            selector.remove(1);
        }

        Object.keys(window.RULES).forEach(key => {
            const rule = window.RULES[key];
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${rule.name} (${rule.ruleString})`;
            selector.appendChild(option);
        });

        if (window.RULES.conway) {
            selector.value = 'conway';
            this.updateRuleInfo(window.RULES.conway);
        }
    }

    showRuleLoadError() {
        const selector = document.getElementById('ruleSelector');
        const errorOption = document.createElement('option');
        errorOption.value = 'error';
        errorOption.textContent = 'Error cargando reglas';
        errorOption.disabled = true;
        selector.appendChild(errorOption);
    }

    bindEvents() {
        // Botones de control
        document.getElementById('playBtn').addEventListener('click', this.togglePlay.bind(this));
        document.getElementById('stepBtn').addEventListener('click', this.step.bind(this));
        document.getElementById('randomBtn').addEventListener('click', this.randomize.bind(this));
        document.getElementById('clearBtn').addEventListener('click', this.clear.bind(this));
        document.getElementById('cancelPatternBtn').addEventListener('click', () => {
            this.deselectPattern();
            window.selectedPatternRotation = 0;
        });

        // Reglas
        document.getElementById('ruleSelector').addEventListener('change', this.changeRule.bind(this));
        document.getElementById('applyCustomRuleBtn').addEventListener('click', () => {
            this.applyCustomRule();
        });

        // Área de influencia
        document.getElementById('influenceToggle').addEventListener('change', this.toggleInfluenceArea.bind(this));
        document.getElementById('quickInfluenceToggle').addEventListener('click', this.quickToggleInfluenceArea.bind(this));

        // Controles
        document.getElementById('speedControl').addEventListener('input', this.updateSpeed.bind(this));
        document.getElementById('speedDown').addEventListener('click', this.decreaseSpeed.bind(this));
        document.getElementById('speedUp').addEventListener('click', this.increaseSpeed.bind(this));
        document.getElementById('gridSize').addEventListener('input', this.updateGridSize.bind(this));
        document.getElementById('cellSize').addEventListener('input', this.updateCellSize.bind(this));
        document.getElementById('gridToggle').addEventListener('click', this.toggleGrid.bind(this));

        // Exportación
        document.getElementById('exportBtn').addEventListener('click', this.exportPattern.bind(this));

        // Scroll de patrones
        document.getElementById('scrollLeft').addEventListener('click', () => this.scrollPatterns(-100));
        document.getElementById('scrollRight').addEventListener('click', () => this.scrollPatterns(100));

        // Controles de límite
        document.getElementById('limitType').addEventListener('change', this.updateLimitType.bind(this));
        document.getElementById('limitValue').addEventListener('input', this.updateLimitValue.bind(this));

        // Interacción con canvas
        this.bindCanvasEvents();
    }

    bindCanvasEvents() {
        const canvas = document.getElementById('canvas');

        // MOUSE DOWN
        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Solo botón izquierdo

            e.preventDefault();
            this.isMouseDown = true;

            const {x, y} = automaton.getCellFromMouse(e);
            this.lastCell = {x, y};

            // Determinar acción
            if (this.shiftPressed && !this.ctrlPressed && !this.selection) {
                // Nueva selección
                this.startSelection(x, y);
                return;
            }

            if (this.selection && this.isPointInSelection(x, y)) {
                // Arrastrar selección
                this.startDrag(x, y, this.ctrlPressed && this.shiftPressed);
                return;
            }

            // Si HAY patrón seleccionado, colocarlo
            if (window.selectedPattern) {
                automaton.importPattern(window.selectedPattern, x, y);
                return;
            }

            // Si NO hay patrón seleccionado, dibujar/borrar
            automaton.grid[x][y] = !this.ctrlPressed;
            automaton.updateStats();
            automaton.render();
        });

        // MOUSE MOVE
        canvas.addEventListener('mousemove', (e) => {
            const {x, y} = automaton.getCellFromMouse(e);
            this.updateMouseCoords(x, y);

            // Vista previa solo si HAY patrón seleccionado
            if (window.selectedPattern) {
                showPatternPreview(x, y);
                if (this.showInfluenceArea) showInfluenceArea(x, y);
            } else {
                // Si NO hay patrón seleccionado, ocultar preview
                hidePatternPreview();
                if (this.showInfluenceArea && !this.selection) showInfluenceArea(x, y);
            }

            // Si mouse está presionado
            if (this.isMouseDown) {
                if (this.isSelecting) {
                    this.updateSelection(x, y);
                } else if (this.isDragging) {
                    this.updateDrag(x, y);
                } else if (!window.selectedPattern) {
                    // Solo dibujo continuo si NO hay patrón seleccionado
                    this.handleContinuousDrawing(x, y);
                }
            }
        });

        // MOUSE UP
        canvas.addEventListener('mouseup', (e) => {
            if (e.button !== 0) return;

            this.isMouseDown = false;

            if (this.isSelecting) {
                this.endSelection();
            }

            if (this.isDragging) {
                this.endDrag();
            }

            this.lastCell = null;
        });

        // MOUSE LEAVE
        canvas.addEventListener('mouseleave', () => {
            this.isMouseDown = false;

            if (this.isSelecting) {
                this.endSelection();
            }

            if (this.isDragging) {
                this.endDrag();
            }

            hidePatternPreview();
            if (!this.showInfluenceArea) {
                hideInfluenceArea();
            }

            this.lastCell = null;
        });

        // CONTEXT MENU - Rotar patrón
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (window.selectedPattern && window.selectedPattern.pattern !== 'random') {
                window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;
                window.selectedPattern = getPatternWithRotation(
                    window.selectedPatternKey,
                    window.selectedPatternRotation
                );
                updatePatternInfo();

                const {x, y} = automaton.getCellFromMouse(e);
                showPatternPreview(x, y);
            }
            return false;
        });

        // Eventos táctiles
        this.setupTouchEvents();
    }

    // DIBUJO CONTINUO
    handleContinuousDrawing(x, y) {
        if (!this.lastCell) {
            this.lastCell = {x, y};
            return;
        }

        if (this.lastCell.x === x && this.lastCell.y === y) {
            return;
        }

        const drawMode = this.ctrlPressed ? 'erase' : 'draw';
        const state = drawMode !== 'erase';
        let needsRender = false;

        const cells = this.getLineCells(this.lastCell.x, this.lastCell.y, x, y);

        cells.forEach(cell => {
            if (cell.x === this.lastCell.x && cell.y === this.lastCell.y) {
                return;
            }

            // Usar función optimizada
            if (automaton.setCellAndRender(cell.x, cell.y, state)) {
                needsRender = true;
            }
        });

        this.lastCell = {x, y};

        // Solo renderizar si hubo cambios
        if (needsRender) {
            automaton.updateStats();
            automaton.render();
        }
    }

    getLineCells(x0, y0, x1, y1) {
        const cells = [];
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1;
        const sy = (y0 < y1) ? 1 : -1;
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

    // SELECCIÓN
    startSelection(x, y) {
        this.clearSelection();
        this.isSelecting = true;
        this.selection = {
            startX: x,
            startY: y,
            endX: x,
            endY: y
        };
        this.updateSelectionVisual();
    }

    updateSelection(x, y) {
        if (!this.isSelecting || !this.selection) return;
        this.selection.endX = x;
        this.selection.endY = y;
        this.updateSelectionVisual();
    }

    endSelection() {
        if (!this.isSelecting || !this.selection) return;

        this.isSelecting = false;

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);

        this.selectionContent = automaton.copyArea(minX, minY, maxX, maxY);
        this.showSelectionInfo();
    }

    clearSelection() {
        this.selection = null;
        this.selectionContent = null;
        this.hideSelectionVisual();
        this.hideSelectionInfo();
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

        automaton.clearArea(minX, minY, maxX, maxY);
        this.clearSelection();
    }

    // ARRASTRE Y COPIA
    startDrag(x, y, isCopy) {
        if (!this.selection || !this.selectionContent) return;

        this.isDragging = true;
        this.isCopying = isCopy;

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        this.dragOffset = {
            x: x - minX,
            y: y - minY
        };

        this.createDragPreview();
    }

    updateDrag(x, y) {
        if (!this.isDragging || !this.selectionContent) return;

        const targetX = x - this.dragOffset.x;
        const targetY = y - this.dragOffset.y;

        this.updateDragPreview(targetX, targetY);
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

        // Si no es copia, borrar área original
        if (!this.isCopying) {
            automaton.clearArea(minX, minY, maxX, maxY);
        }

        // Pegar en nueva posición
        automaton.pasteArea(this.selectionContent, targetX, targetY);

        // Actualizar selección
        if (this.isCopying) {
            // Mantener selección original
            this.selectionContent = automaton.copyArea(targetX, targetY, targetX + width - 1, targetY + height - 1);
        } else {
            // Mover selección
            this.selection.startX = targetX;
            this.selection.startY = targetY;
            this.selection.endX = targetX + width - 1;
            this.selection.endY = targetY + height - 1;
            this.selectionContent = automaton.copyArea(targetX, targetY, targetX + width - 1, targetY + height - 1);
        }

        this.removeDragPreview();
        this.updateSelectionVisual();
        this.showSelectionInfo();
    }

    // VISUALIZACIÓN
    updateSelectionVisual() {
        if (!this.selection) {
            this.hideSelectionVisual();
            return;
        }

        const minX = Math.min(this.selection.startX, this.selection.endX);
        const maxX = Math.max(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        const maxY = Math.max(this.selection.startY, this.selection.endY);

        const width = maxX - minX + 1;
        const height = maxY - minY + 1;

        let selectionDiv = document.getElementById('selectionOverlay');
        if (!selectionDiv) {
            selectionDiv = document.createElement('div');
            selectionDiv.id = 'selectionOverlay';
            selectionDiv.className = 'selection-overlay';
            document.getElementById('canvas-container').appendChild(selectionDiv);
        }

        const cellSize = automaton.cellSize;
        const canvas = document.getElementById('canvas');
        const container = document.getElementById('canvas-container');
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const offsetX = canvasRect.left - containerRect.left;
        const offsetY = canvasRect.top - containerRect.top;
        const scaleX = canvas.width / canvasRect.width;
        const scaleY = canvas.height / canvasRect.height;

        selectionDiv.style.display = 'block';
        selectionDiv.style.left = (offsetX + minX * cellSize / scaleX) + 'px';
        selectionDiv.style.top = (offsetY + minY * cellSize / scaleY) + 'px';
        selectionDiv.style.width = (width * cellSize / scaleX) + 'px';
        selectionDiv.style.height = (height * cellSize / scaleY) + 'px';
    }

    hideSelectionVisual() {
        const selectionDiv = document.getElementById('selectionOverlay');
        if (selectionDiv) {
            selectionDiv.style.display = 'none';
        }
    }

    createDragPreview() {
        this.removeDragPreview();

        if (!this.selectionContent) return;

        const dragPreview = document.createElement('div');
        dragPreview.id = 'dragPreview';
        dragPreview.className = 'drag-preview';

        // Crear canvas para mostrar contenido
        const canvas = document.createElement('canvas');
        const width = this.selectionContent.width;
        const height = this.selectionContent.height;

        canvas.width = width * automaton.cellSize;
        canvas.height = height * automaton.cellSize;

        const ctx = canvas.getContext('2d');

        // Dibujar contenido
        ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                if (this.selectionContent.grid[x][y]) {
                    ctx.fillStyle = '#3b82f6';
                    ctx.fillRect(
                        x * automaton.cellSize + 1,
                        y * automaton.cellSize + 1,
                        automaton.cellSize - 2,
                        automaton.cellSize - 2
                    );
                }
            }
        }

        dragPreview.appendChild(canvas);
        document.getElementById('canvas-container').appendChild(dragPreview);

        // Posicionar inicialmente
        const minX = Math.min(this.selection.startX, this.selection.endX);
        const minY = Math.min(this.selection.startY, this.selection.endY);
        this.updateDragPreview(minX, minY);
    }

    updateDragPreview(targetX, targetY) {
        const dragPreview = document.getElementById('dragPreview');
        if (!dragPreview) return;

        dragPreview.dataset.targetX = targetX;
        dragPreview.dataset.targetY = targetY;

        const width = this.selectionContent.width;
        const height = this.selectionContent.height;

        const cellSize = automaton.cellSize;
        const canvas = document.getElementById('canvas');
        const container = document.getElementById('canvas-container');
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const offsetX = canvasRect.left - containerRect.left;
        const offsetY = canvasRect.top - containerRect.top;
        const scaleX = canvas.width / canvasRect.width;
        const scaleY = canvas.height / canvasRect.height;

        dragPreview.style.position = 'absolute';
        dragPreview.style.left = (offsetX + targetX * cellSize / scaleX) + 'px';
        dragPreview.style.top = (offsetY + targetY * cellSize / scaleY) + 'px';
        dragPreview.style.width = (width * cellSize / scaleX) + 'px';
        dragPreview.style.height = (height * cellSize / scaleY) + 'px';
        dragPreview.style.border = this.isCopying ? '2px dashed #10b981' : '2px solid #3b82f6';
        dragPreview.style.zIndex = '5';
        dragPreview.style.pointerEvents = 'none';
    }

    removeDragPreview() {
        const dragPreview = document.getElementById('dragPreview');
        if (dragPreview) {
            dragPreview.remove();
        }
    }

    showSelectionInfo() {
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
            document.querySelector('.canvas-controls').appendChild(infoDiv);
        }

        infoDiv.innerHTML = `
            <div class="selection-info-content">
                <span><i class="fas fa-vector-square"></i> ${width}×${height}</span>
                <button id="deleteSelectionBtn" class="btn-small"><i class="fas fa-trash"></i></button>
                <button id="clearSelectionBtn" class="btn-small"><i class="fas fa-times"></i></button>
            </div>
        `;

        document.getElementById('deleteSelectionBtn').addEventListener('click', () => {
            this.deleteSelection();
        });

        document.getElementById('clearSelectionBtn').addEventListener('click', () => {
            this.clearSelection();
        });

        infoDiv.style.display = 'block';
    }

    hideSelectionInfo() {
        const infoDiv = document.getElementById('selectionInfo');
        if (infoDiv) {
            infoDiv.style.display = 'none';
        }
    }

    // TECLADO
    bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') this.ctrlPressed = true;
            if (e.key === 'Shift') this.shiftPressed = true;

            if (e.key === 'Escape') {
                this.deselectPattern();
                this.clearSelection();
                window.selectedPatternRotation = 0;
            }
            if (e.key === ' ') {
                e.preventDefault();
                this.togglePlay();
            }
            if (e.key === 's' || e.key === 'S') this.step();
            if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                if (window.selectedPattern && window.selectedPattern.pattern !== 'random') {
                    window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;
                    window.selectedPattern = getPatternWithRotation(
                        window.selectedPatternKey,
                        window.selectedPatternRotation
                    );
                    updatePatternInfo();
                }
            }
            if (e.key === 'a' || e.key === 'A') this.randomize();
            if (e.key === 'c' || e.key === 'C') this.clear();
            if (e.key === 'Delete' && this.selection) {
                e.preventDefault();
                this.deleteSelection();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') this.ctrlPressed = false;
            if (e.key === 'Shift') this.shiftPressed = false;
        });
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

        // Actualizar indicador de modo
        this.updateDrawModeIndicator();
    }

    updateMouseCoords(x, y) {
        const coords = document.getElementById('mouseCoords');
        if (coords) {
            coords.textContent = `X: ${x}, Y: ${y}`;
        }
    }

    togglePlay() {
        if (automaton.isLimitReached) {
            automaton.isLimitReached = false;
            automaton.generation = 0;
            automaton.updateStats();
        }

        const isRunning = automaton.toggleRunning();
        const playIcon = document.getElementById('playIcon');
        const playText = document.getElementById('playText');
        const stepBtn = document.getElementById('stepBtn');

        if (isRunning) {
            playIcon.className = 'fas fa-pause';
            playText.textContent = 'Pausar';
            stepBtn.disabled = true;
        } else {
            playIcon.className = 'fas fa-play';
            playText.textContent = 'Ejecutar';
            stepBtn.disabled = false;
        }
    }

    step() {
        automaton.nextGeneration();
        automaton.render();
    }

    randomize() {
        automaton.randomize();
    }

    clear() {
        automaton.clear();
    }

    updateSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        automaton.setSpeed(value);
        this.updateSpeedDisplay();
    }

    decreaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(slider.value.toString()) - 1;
        if (value < 1) value = 1;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    increaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(slider.value.toString()) + 1;
        if (value > 10) value = 10;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    updateSpeedDisplay() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);

        // Array de textos para cada grupo de 2 valores
        const speedTexts = ['Muy Lento', 'Lento', 'Normal', 'Rápido', 'Muy Rápido'];

        // Calcular índice
        const index = Math.floor((value - 1) / 2);
        const clampedIndex = Math.min(Math.max(index, 0), speedTexts.length - 1);

        // Mostrar texto y valor numérico
        document.getElementById('speedValue').textContent =
            `${speedTexts[clampedIndex]} (${value}/10)`;
    }

    updateGridSize() {
        const slider = document.getElementById('gridSize');
        const value = parseInt(slider.value);
        document.getElementById('gridSizeValue').textContent = `${value}×${value}`;

        if (!automaton.isRunning || confirm('Cambiar el tamaño detendrá la simulación. ¿Continuar?')) {
            if (automaton.isRunning) this.togglePlay();
            automaton.resizeGrid(value);
        }
    }

    updateGridSizeDisplay() {
        const slider = document.getElementById('gridSize');
        const value = parseInt(slider.value);
        document.getElementById('gridSizeValue').textContent = `${value}×${value}`;
    }

    updateCellSize() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        document.getElementById('cellSizeValue').textContent = `${value}px`;
        automaton.setCellSize(value);
    }

    updateCellSizeDisplay() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        document.getElementById('cellSizeValue').textContent = `${value}px`;
    }

    toggleGrid() {
        automaton.toggleGrid();
    }

    toggleInfluenceArea() {
        const toggle = document.getElementById('influenceToggle');
        this.showInfluenceArea = toggle.checked;

        const quickToggle = document.getElementById('quickInfluenceToggle');
        if (quickToggle) {
            if (this.showInfluenceArea) {
                quickToggle.classList.add('active');
                quickToggle.style.color = 'var(--secondary)';
            } else {
                quickToggle.classList.remove('active');
                quickToggle.style.color = '';
            }
        }

        if (!this.showInfluenceArea) {
            hideInfluenceArea();
        }
    }

    quickToggleInfluenceArea() {
        const toggle = document.getElementById('influenceToggle');
        this.showInfluenceArea = !this.showInfluenceArea;
        toggle.checked = this.showInfluenceArea;

        const quickToggle = document.getElementById('quickInfluenceToggle');
        if (this.showInfluenceArea) {
            quickToggle.classList.add('active');
            quickToggle.style.color = 'var(--secondary)';
        } else {
            quickToggle.classList.remove('active');
            quickToggle.style.color = '';
            hideInfluenceArea();
        }
    }

    scrollPatterns(direction) {
        const container = document.getElementById('patternsContainer');
        if (container) {
            container.scrollLeft += direction;
        }
    }

    exportPattern() {
        const pattern = automaton.exportPattern();
        if (pattern) {
            const patternStr = JSON.stringify(pattern, null, 2);
            const blob = new Blob([patternStr], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `my-pattern-${new Date().getTime()}.json`;
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
            automaton.setLimit('none', 0);
        } else {
            valueGroup.style.display = 'block';
            automaton.setLimit(select.value, parseInt(limitValue.value));
        }

        automaton.isLimitReached = false;
    }

    updateLimitValue() {
        const select = document.getElementById('limitType');
        const slider = document.getElementById('limitValue');
        const value = parseInt(slider.value);

        document.getElementById('limitValueDisplay').textContent = value.toLocaleString();

        if (select.value !== 'none') {
            automaton.setLimit(select.value, value);
        }
    }

    changeRule() {
        const selector = document.getElementById('ruleSelector');
        const ruleKey = selector.value;
        const customRuleGroup = document.getElementById('customRuleGroup');

        if (ruleKey === 'custom') {
            customRuleGroup.style.display = 'block';
            document.getElementById('birthInput').value = automaton.rule.birth.join(',');
            document.getElementById('survivalInput').value = automaton.rule.survival.join(',');
        } else {
            customRuleGroup.style.display = 'none';
            if (automaton && window.RULES && window.RULES[ruleKey]) {
                automaton.setRuleByKey(ruleKey);
                this.updateHeaderInfo();
                if (automaton.isRunning) {
                    this.togglePlay();
                }
            }
        }
    }

    applyCustomRule() {
        const birthInput = document.getElementById('birthInput').value;
        const survivalInput = document.getElementById('survivalInput').value;

        try {
            const customRule = parseCustomRule(birthInput, survivalInput);
            automaton.setRule(customRule.survival, customRule.birth);
            alert(`Regla personalizada aplicada: B${customRule.birth.join('')}/S${customRule.survival.join('')}`);
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    changeNeighborhoodType(type) {
        if (automaton) {
            automaton.setNeighborhoodType(type);
            this.updateNeighborhoodInfo();
            if (automaton.isRunning) {
                this.togglePlay();
            }
        }
    }

    changeNeighborhoodRadius(radius) {
        const radiusValue = document.getElementById('radiusValue');
        if (radiusValue) {
            radiusValue.textContent = radius;
        }

        if (automaton) {
            automaton.setNeighborhoodRadius(radius);
            this.updateNeighborhoodInfo();
            if (automaton.isRunning) {
                this.togglePlay();
            }
        }
    }

    updateHeaderInfo() {
        const selector = document.getElementById('ruleSelector');
        if (selector && selector.value && window.RULES) {
            const ruleKey = selector.value;
            const rule = window.RULES[ruleKey];
            if (rule) {
                this.updateRuleInfo(rule);
            }
        }
        this.updateNeighborhoodInfo();
    }

    updateRuleInfo(rule) {
        const rulesSpecific = document.getElementById('rulesSpecific');
        if (!rulesSpecific) return;

        rulesSpecific.innerHTML = `
        <p><span class="birth"><i class="fas fa-seedling"></i> Nacimiento:</span> ${rule.birth.join(', ')} vecinos</p>
        <p><span class="survival"><i class="fas fa-heart"></i> Supervivencia:</span> ${rule.survival.join(', ')} vecinos</p>
        <p class="notation">
            Notación: <span class="highlight">${rule.ruleString}</span>
        </p>
    `;

        document.title = `Autómata Celular - ${rule.name} ${rule.ruleString}`;
        const headerTitle = document.querySelector('h1');
        if (headerTitle) {
            headerTitle.innerHTML = `<i class="fas fa-cogs"></i> Autómata - ${rule.name}`;
        }
    }

    bindNeighborhoodEvents() {
        const typeSelect = document.getElementById('neighborhoodType');
        const radiusSlider = document.getElementById('neighborhoodRadius');

        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.changeNeighborhoodType(e.target.value);
            });
        }

        if (radiusSlider) {
            radiusSlider.addEventListener('input', (e) => {
                this.changeNeighborhoodRadius(parseInt(e.target.value));
            });
        }
    }

    updateNeighborhoodInfo() {
        const infoElement = document.getElementById('neighborhoodInfo');
        if (!infoElement || !automaton) return;

        const type = automaton.neighborhoodType === 'moore' ? 'Moore' : 'von Neumann';
        const radius = automaton.neighborhoodRadius;
        infoElement.innerHTML = `<i class="fas fa-crosshairs"></i> Vecindad: ${type} (radio ${radius})`;
    }

    bindPatternsControls() {
        const toggleRowsBtn = document.getElementById('patternsToggleRows');
        const toggleCompactBtn = document.getElementById('patternsToggleCompact');
        const container = document.getElementById('patternsContainer');

        if (toggleRowsBtn && container) {
            toggleRowsBtn.addEventListener('click', () => {
                this.patternsTwoRows = !this.patternsTwoRows;
                container.classList.toggle('two-rows', this.patternsTwoRows);
                const icon = toggleRowsBtn.querySelector('i');
                if (this.patternsTwoRows) {
                    icon.className = 'fas fa-grip-lines-vertical';
                    toggleRowsBtn.title = 'Cambiar a 1 fila';
                } else {
                    icon.className = 'fas fa-grip-lines';
                    toggleRowsBtn.title = 'Cambiar a 2 filas';
                }
            });
        }

        if (toggleCompactBtn && container) {
            toggleCompactBtn.addEventListener('click', () => {
                this.patternsCompactView = !this.patternsCompactView;
                container.classList.toggle('compact-view', this.patternsCompactView);
                document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
                    btn.classList.toggle('compact', this.patternsCompactView);
                });
                const icon = toggleCompactBtn.querySelector('i');
                if (this.patternsCompactView) {
                    icon.className = 'fas fa-expand-alt';
                    toggleCompactBtn.title = 'Vista normal';
                } else {
                    icon.className = 'fas fa-compress';
                    toggleCompactBtn.title = 'Vista compacta';
                }
            });
        }
    }

    setupTouchEvents() {
        const canvas = document.getElementById('canvas');
        let isTouchDrawing = false;
        let touchStartTime = 0;

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            const touch = e.touches[0];
            touchStartTime = Date.now();
            const {x, y} = automaton.getCellFromMouse(touch);

            if (window.selectedPattern) {
                automaton.importPattern(window.selectedPattern, x, y);
            } else {
                isTouchDrawing = true;
                automaton.grid[x][y] = !automaton.grid[x][y];
                automaton.updateStats();
                automaton.render();
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            if (!isTouchDrawing || !e.touches[0]) return;
            e.preventDefault();
            const touch = e.touches[0];
            const {x, y} = automaton.getCellFromMouse(touch);
            const touchTime = Date.now() - touchStartTime;
            if (touchTime > 50) {
                automaton.grid[x][y] = true;
                automaton.updateStats();
                automaton.render();
            }
        });

        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            isTouchDrawing = false;
        });
    }

    bindPatternEvents() {
        // Cuando se selecciona un patrón
        document.addEventListener('patternSelected', () => {
            this.onPatternSelected();
        });

        // Cuando se actualiza un patrón (rotación, etc.)
        document.addEventListener('patternUpdated', () => {
            this.updateDrawModeIndicator();
        });

        // Cuando se de-selecciona un patrón
        document.addEventListener('patternDeselected', () => {
            this.updateDrawModeIndicator();
        });

        // Cuando se cancela un patrón (disparado por el botón Cancelar)
        document.getElementById('cancelPatternBtn').addEventListener('click', () => {
            this.updateDrawModeIndicator();
        });
    }

    onPatternSelected() {
        // Actualizar indicador de modo
        this.updateDrawModeIndicator();

        // También actualizar las instrucciones si es necesario
        this.updateInstructions();
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

    updateInstructions() {
        // No necesitamos cambiar las instrucciones, ya están completas
        // Pero podemos resaltar el modo actual si queremos
        const instructions = document.querySelector('.instructions p');
        if (instructions && window.selectedPattern) {
            instructions.innerHTML = instructions.innerHTML.replace(
                'Modo: Dibujo libre',
                `<strong>Modo: Patrón - ${window.selectedPattern.name}</strong>`
            );
        }
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    const uiController = new UIController();

    // Hacer disponible globalmente si es necesario
    window.uiController = uiController;

    // Inicializar indicador de modo después de un breve delay
    setTimeout(() => {
        uiController.updateDrawModeIndicator();
    }, 100);
});