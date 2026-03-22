class UIController {
    constructor(automatonInstance) {
        if (!automatonInstance) {
            throw new Error('UIController requiere una instancia de CellularAutomaton');
        }

        this.automaton = automatonInstance;

        this.showInfluenceArea = true;
        this.patternsTwoRows = true;
        this.patternsCompactView = true;
        this.patternsSortByCount = false;
        this.patternsShowAll = false;

        this._gridSizeDebounceTimer = null;
        this._gridSizePendingValue = null;

        this._cleanups = [];

        this._patternState = {
            pattern: null,
            key: null,
            rotation: 0
        };

        this.showActivityEffect = true;

        // Canvas controller — gestiona toda interacción con el canvas
        this._canvasController = new CanvasController({
            automaton: this.automaton,
            patternState: this._patternState,
            onUpdateDrawMode: () => this._displayController.updateDrawModeIndicator()
        });

        this._specialModeController = new SpecialModeController({
            automaton: this.automaton,
            onUpdateHeader: () => this._displayController.updateHeaderInfo(),
            onSyncPlayButton: () => this._syncPlayButtonState(),
            onShowNotification: (msg, type, dur) => this._showNotification(msg, type, dur)
        });

        this._subscribeToAutomatonEvents();
        this._waitForRulesAndInit().then();

        this._displayController = new DisplayController(this.automaton, this._patternState);

        this._cleanups.push(
            i18n.onLocaleChange(() => this._onLocaleChanged())
        );
    }

    /**
     * Devuelve la referencia compartida del estado de patrón activo.
     * Usado por main.js para sincronizarlo con PatternManager sin acceder
     * a campos internos (_patternState).
     * @returns {{ pattern: Object|null, key: string|null, rotation: number }}
     */
    getPatternState() {
        return this._patternState;
    }

    _onLocaleChanged() {
        this._displayController.updateHeaderInfo();
        this.updateSpeedDisplay();
        this._displayController.updateNeighborhoodInfo();
        this._displayController.updateDrawModeIndicator();

        const isRunning = this.automaton.isRunning;
        const playText = document.querySelector('#playBtn [data-i18n]');
        if (playText) {
            playText.textContent = t(isRunning ? 'controls.pause' : 'controls.play');
        }
    }

    async _waitForRulesAndInit() {

        let attempts = 0;
        while ((!window.RULES || Object.keys(window.RULES).length === 0) && attempts < 100) {
            await new Promise(resolve => setTimeout(resolve, 50));
            attempts++;
        }


        this._init().then()
    }

    async _init() {
        await this._waitForRules();
        this._bindEvents();
        this._bindAccordionEvents();
        this._bindKeyboardEvents();
        this._bindPatternEvents();
        this._bindNeighborhoodEvents();
        this._bindPatternsControls();

        this.updateSpeedDisplay();
        this.updateGridSizeDisplay();
        this.updateCellSizeDisplay();
        this._displayController.updateNeighborhoodInfo();
        this.loadRules();

        eventBus.on('automaton:runningChanged', () => this._syncPlayButtonState());

        eventBus.emit('ui:ready');
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    destroy() {
        if (this._gridSizeDebounceTimer) clearTimeout(this._gridSizeDebounceTimer);

        this._canvasController?.destroy();
        this._canvasController = null;

        this._cleanups.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.warn('Error en cleanup:', e);
            }
        });
        this._cleanups = [];

        if (this._patternState?.pattern) this._patternState.pattern = null;
        if (this._patternState?.key) this._patternState.key = null;
        if (this._patternState?.rotation) this._patternState.rotation = 0;

        this.automaton = null;
        this._patternState = null;

        this._specialModeController?.destroy();
        this._specialModeController = null;

        this._displayController?.destroy();
        this._displayController = null;

        eventBus.emit('ui:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        const cleanup = () => target.removeEventListener(event, handler, options);
        this._cleanups.push(cleanup);
        return cleanup;
    }

    _subscribeToAutomatonEvents() {
        const weakThis = new WeakRef(this);

        this._cleanups.push(
            eventBus.on('stats:updated', (stats) => {
                weakThis.deref()?._displayController?.updateStats(stats);
            }),
            eventBus.on('automaton:ruleChanged', () => {
                weakThis.deref()?._displayController?.updateHeaderInfo();
            }),
            eventBus.on('automaton:neighborhoodChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui._displayController.updateHeaderInfo();
                    ui._displayController.updateNeighborhoodInfo();
                }
            }),
            eventBus.on('automaton:radiusChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui._displayController.updateHeaderInfo();
                    ui._displayController.updateNeighborhoodInfo();
                }
            }),
            eventBus.on('automaton:wrapChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui._displayController.updateHeaderInfo();
                    ui._displayController.updateNeighborhoodInfo();
                }
            })
        );
    }

    async _waitForRules() {
        if (window.RULES && Object.keys(window.RULES).length > 0) {
            return;
        }

        await new Promise(resolve => {
            const check = () => {
                if (window.RULES && Object.keys(window.RULES).length > 0) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    loadRules() {
        const selector = document.getElementById('ruleSelector');
        if (!selector) return;

        while (selector.options.length > 0) {
            selector.removeItem(0);
        }

        Object.keys(window.RULES).forEach((key, index) => {
            const rule = window.RULES[key];
            const option = document.createElement('option');
            option.value = key;

            // SI ES CUSTOM Y TIENE VALORES, MOSTRAR LA NOTACIÓN REAL
            if (key === 'custom' && rule.birth.length > 0 && rule.survival.length > 0) {
                option.textContent = `${t('config.rule.custom')} (${rule.ruleString})`;
            } else {
                option.textContent = `${rule.name} (${rule.ruleString})`;
            }

            selector.appendChild(option);
        });

        if (window.RULES.conway) {
            selector.value = 'conway';
            this._displayController.updateRuleInfo(window.RULES.conway);
        }
    }

    // =========================================
    // BINDING DE EVENTOS
    // =========================================

    _bindEvents() {
        this._addEventListener(document.getElementById('languageSelect'), 'change', (e) => {
            i18n.setLocale(e.target.value);
        });

        this._addEventListener(document.getElementById('playBtn'), 'click', () => this.togglePlay());
        this._addEventListener(document.getElementById('stepBtn'), 'click', () => this.step());
        this._addEventListener(document.getElementById('stepBackBtn'), 'click', () => this.undo());
        this._addEventListener(document.getElementById('clearBtn'), 'click', () => this.clear());
        this._addEventListener(document.getElementById('cancelPatternBtn'), 'click', () => {
            this.deselectPattern();
        });

        const randomBtn = document.getElementById('randomBtn');
        if (randomBtn) {
            this._addEventListener(randomBtn, 'click', () => {
                const percentage = this._getPercentage();
                this.automaton.randomize(percentage);
                this._showNotification(t('notif.randomized', {density: Math.round(percentage * 100)}), 'info', 1500);
                this._displayController.updateHeaderInfo();
            });
        }

        this._addEventListener(document.getElementById('instructionsBtn'), 'click', () => {
            document.getElementById('instructionsModal').classList.add('show');
        });
        this._addEventListener(document.getElementById('closeModalBtn'), 'click', () => {
            document.getElementById('instructionsModal').classList.remove('show');
        });
        this._addEventListener(document.getElementById('instructionsModal'), 'click', (e) => {
            if (e.target.id === 'instructionsModal') {
                document.getElementById('instructionsModal').classList.remove('show');
            }
        });

        this._addEventListener(document.getElementById('ruleSelector'), 'change', () => this.changeRule());
        this._addEventListener(document.getElementById('applyCustomRuleBtn'), 'click', () => this.applyCustomRule());

        this._addEventListener(document.getElementById('influenceToggle'), 'change', () => this.toggleInfluenceArea());
        this._addEventListener(document.getElementById('quickInfluenceToggle'), 'click', () => this.quickToggleInfluenceArea());
        this._addEventListener(document.getElementById('activityEffectToggle'), 'change', () => this.toggleActivityEffect());

        const wrapToggle = document.getElementById('wrapToggle');
        if (wrapToggle) {
            this._addEventListener(wrapToggle, 'change', () => {
                const wrap = wrapToggle.checked;
                this.automaton.wrapEdges = wrap;
                this.automaton._markAllDirty();
                this.automaton.render();
                this._displayController.updateNeighborhoodInfo();
                if (this.automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.automaton.triangleEngine) {
                    this.automaton.triangleEngine.wrapEdges = wrap;
                }
                eventBus.emit('automaton:wrapChanged', {wrap});
            });
        }

        this._bindRandomPercentageControl();

        const workerToggle = document.getElementById('workerToggle');
        if (workerToggle) {
            workerToggle.checked = this.automaton.worker !== null;
            this._addEventListener(workerToggle, 'change', (e) => {
                if (e.target.checked) {
                    this.automaton._initWorker();
                } else {
                    this.automaton._cleanupWorker();
                }
            });
        }

        this._addEventListener(document.getElementById('speedControl'), 'input', () => this.updateSpeed());
        this._addEventListener(document.getElementById('speedDown'), 'click', () => this.decreaseSpeed());
        this._addEventListener(document.getElementById('speedUp'), 'click', () => this.increaseSpeed());
        this._addEventListener(document.getElementById('gridSize'), 'input', () => this.updateGridSize());
        this._addEventListener(document.getElementById('cellSize'), 'input', () => this.updateCellSize());
        this._addEventListener(document.getElementById('gridToggle'), 'click', () => this.toggleGrid());
        this._addEventListener(document.getElementById('exportBtn'), 'click', () => this.exportPattern());
        this._addEventListener(document.getElementById('importBtn'), 'click', () => this.importPatternFromFile());
        this._addEventListener(document.getElementById('limitType'), 'change', () => this.updateLimitType());
        this._addEventListener(document.getElementById('limitValue'), 'input', () => this.updateLimitValue());

        this._specialModeController.bindEvents();
    }

    // =========================================
    // ACORDEONES
    // =========================================

    _bindAccordionEvents() {
        document.querySelectorAll('.accordion-header').forEach(header => {
            this._addEventListener(header, 'click', (e) => {
                e.preventDefault();

                const isActive = header.classList.contains('active');

                // Toggle clase active en el header
                if (isActive) {
                    header.classList.remove('active');
                } else {
                    header.classList.add('active');
                }
            });
        });
    }

    // =========================================
    // ALEATORIEDAD
    // =========================================

    _bindRandomPercentageControl() {
        const slider = document.getElementById('randomPercentage');
        const display = document.getElementById('randomPercentageDisplay');

        if (!slider || !display) return;

        // Actualizar display al mover slider
        this._addEventListener(slider, 'input', () => {
            const value = parseInt(slider.value, 10);
            display.textContent = `${value}%`;
        });
    }

    // =========================================
    // EVENTOS DE TECLADO
    // =========================================

    _bindKeyboardEvents() {
        this._addEventListener(document, 'keydown', (e) => this._handleKeyDown(e));
        this._addEventListener(document, 'keyup', (e) => this._handleKeyUp(e));
    }

    _handleKeyDown(e) {
        this._canvasController.ctrlPressed = e.key === 'Control' ? true : this._canvasController.ctrlPressed;
        this._canvasController.shiftPressed = e.key === 'Shift' ? true : this._canvasController.shiftPressed;
        if (e.key === 'Alt') {
            e.preventDefault();
            this._canvasController.altPressed = true;
        }

        if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
        }

        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.redo();
            return;
        }

        switch (e.key.toLowerCase()) {
            case 'escape':
                this.deselectPattern();
                this._canvasController.cancelDrag();
                this._canvasController.clearSelection();
                // Desactivar bote de pintura si estaba activo
                if (this._canvasController.bucketToolActive) {
                    this._canvasController.bucketToolActive = false;
                    document.getElementById('bucketToolBtn')?.classList.remove('active');
                    this._canvasController._updateCursor();
                }
                break;
            case ' ':
                e.preventDefault();
                this.togglePlay();
                break;
            case 's':
                this.step();
                break;
            case 'r':
                if (this._patternState.pattern?.pattern !== 'random') {
                    this._patternState.rotation = (this._patternState.rotation + 90) % 360;
                    this._patternState.pattern = getPatternWithRotation(
                        this._patternState.key,
                        this._patternState.rotation
                    );
                    eventBus.emit('pattern:rotationChanged', {
                        pattern: this._patternState.pattern,
                        rotation: this._patternState.rotation
                    });
                }
                break;
            case 'b': {
                const cc = this._canvasController;
                cc.bucketToolActive = !cc.bucketToolActive;
                document.getElementById('bucketToolBtn')?.classList.toggle('active', cc.bucketToolActive);
                if (cc.bucketToolActive) this.deselectPattern();
                cc._updateCursor();
                break;
            }
            case 'a':
                this.randomize();
                break;
            case 'c':
                this.clear();
                break;
            case 'delete':
                if (this._canvasController.selection) {
                    e.preventDefault();
                    this._canvasController.deleteSelection();
                }
                break;
            case 'h':
                this.toggleGrid();
                break;
            case '?':
                e.preventDefault();
                document.getElementById('instructionsModal').classList.add('show');
                break;
        }
    }

    _handleKeyUp(e) {
        if (e.key === 'Control') this._canvasController.ctrlPressed = false;
        if (e.key === 'Shift') this._canvasController.shiftPressed = false;
        if (e.key === 'Alt') this._canvasController.altPressed = false;
    }

    // =========================================
    // CONTROL PRINCIPAL
    // =========================================

    _syncPlayButtonState() {
        const isRunning = this.automaton.isRunning;
        const playIcon = document.getElementById('playIcon');
        const playBtn = document.getElementById('playBtn');
        const playText = document.getElementById('playText');
        const stepBtn = document.getElementById('stepBtn');

        if (playIcon) playIcon.className = isRunning ? 'fas fa-pause' : 'fas fa-play';

        const playTextEl = playText || playBtn?.querySelector('span');
        if (playTextEl) playTextEl.textContent = t(isRunning ? 'controls.pause' : 'controls.play');

        if (stepBtn) stepBtn.disabled = isRunning;
    }

    togglePlay() {
        if (this.automaton.isLimitReached) {
            this.automaton.isLimitReached = false;
            this.automaton.generation = 0;
            this.automaton.updateStats();
        }

        const isRunning = this.automaton.toggleRunning();

        // Controlar seguimiento durante simulación
        if (isRunning) {
            this.automaton.stateManager?.stopTracking();
        } else {
            this.automaton.stateManager?.startTracking();
        }

        this._syncPlayButtonState();
    }

    step() {
        // Guardar estado para permitir retroceder este paso específico
        this.automaton.stateManager?.saveState(this.automaton.generation);

        this.automaton.nextGeneration();
        this.automaton.render();
    }

    _getPercentage() {
        const percentageSlider = document.getElementById('randomPercentage');
        return percentageSlider ? parseInt(percentageSlider.value, 10) / 100 : 0.35;
    }

    randomize() {
        const wasRunning = this.automaton.isRunning;
        if (wasRunning) this.togglePlay(); // Pausar

        this.automaton.randomize(this._getPercentage());

        if (wasRunning) {
            // Reanudar después de renderizar
            requestAnimationFrame(() => this.togglePlay());
        }
    }

    /**
     * Detiene la simulación y emite el evento de cambio de estado.
     * Patrón común siempre que la UI necesita forzar la parada.
     */
    _stopAutomaton() {
        this.automaton.stop();
        this.automaton.isRunning = false;
        eventBus.emit('automaton:runningChanged', {isRunning: false});
    }

    clear() {
        if (this.automaton.isRunning) this._stopAutomaton();

        this.automaton.clear();
        this._syncPlayButtonState();
    }

    /**
     * Ejecuta undo y muestra feedback
     */
    undo() {
        if (this.automaton.undoCount === 0) {
            this._showNotification(t('notif.noUndo'), 'warning', 1500);
            return;
        }

        if (this.automaton.undo()) {
            this._showNotification(t('notif.undo'), 'info', 1000);
        }
    }

    /**
     * Ejecuta redo y muestra feedback
     */
    redo() {
        if (this.automaton.redoCount === 0) {
            this._showNotification(t('notif.noRedo'), 'warning', 1500);
            return;
        }

        if (this.automaton.redo()) {
            this._showNotification(t('notif.redo'), 'info', 1000);
        }
    }

    updateSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        this.automaton.setSpeed(value);
        this.updateSpeedDisplay();
    }

    decreaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(String(slider.value), 10) + 1;
        if (value < 1) value = 1;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    increaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(String(slider.value), 10) + 1;
        if (value > 10) value = 10;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    updateSpeedDisplay() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        const speedTexts = [t('speed.very_slow'), t('speed.slow'), t('speed.normal'), t('speed.fast'), t('speed.very_fast')];
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

        // Detener si está corriendo (sin confirmar, forzar)
        if (this.automaton.isRunning) {
            this._stopAutomaton();
            this._syncPlayButtonState();
        }

        this.automaton.resizeGrid(value);
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
        // Funciona para ambos modos (estándar y triangular)
        const newState = this.automaton.toggleGrid();

        // Actualizar visual del botón
        const gridToggle = document.getElementById('gridToggle');
        if (gridToggle) {
            gridToggle.classList.toggle('active', newState);
        }

        // Forzar renderizado
        this.automaton.render();

        return newState;
    }

    toggleInfluenceArea() {
        const toggle = document.getElementById('influenceToggle');
        this._canvasController.showInfluenceArea = toggle.checked;

        const quickToggle = document.getElementById('quickInfluenceToggle');
        if (quickToggle) {
            quickToggle.className = this._canvasController.showInfluenceArea ? 'btn-toggle active' : 'btn-toggle';
            quickToggle.style.color = this._canvasController.showInfluenceArea ? 'var(--secondary)' : '';
        }

        if (!this._canvasController.showInfluenceArea) window.patternManager?.hideInfluenceArea();
    }

    quickToggleInfluenceArea() {
        this._canvasController.showInfluenceArea = !this._canvasController.showInfluenceArea;
        const toggle = document.getElementById('influenceToggle');
        if (toggle) toggle.checked = this._canvasController.showInfluenceArea;
        this.toggleInfluenceArea();
    }

    toggleActivityEffect() {
        const toggle = document.getElementById('activityEffectToggle');
        this.showActivityEffect = toggle.checked;

        // Forzar re-renderizado inmediato
        this.automaton.setShowActivityEffect(this.showActivityEffect);
        this.automaton._markAllDirty();
        this.automaton.render();
    }

    exportPattern() {
        // WireWorld: exportar en formato MCL (preserva los 4 estados)
        if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.automaton.wireworldEngine?.isActive) {
            this._exportMCL();
            return;
        }

        const sel = this._canvasController?.selection;
        const bounds = sel ? {
            minX: Math.min(sel.startX, sel.endX),
            minY: Math.min(sel.startY, sel.endY),
            maxX: Math.max(sel.startX, sel.endX),
            maxY: Math.max(sel.startY, sel.endY)
        } : null;

        const patternData = this.automaton.exportPattern(bounds);
        if (!patternData) {
            this._showNotification(t('notif.pattern.empty'), 'warning', 2000);
            return;
        }

        const codec = new RLECodec();
        const ruleString = this.automaton.rule
            ? `B${this.automaton.rule.birth.join('')}/S${this.automaton.rule.survival.join('')}`
            : 'B3/S23';

        const rleText = codec.encode({
            pattern: patternData.pattern,
            name: patternData.name,
            description: patternData.description,
            rule: ruleString
        });

        const blob = new Blob([rleText], {type: 'text/plain'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pattern-${Date.now()}.rle`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this._showNotification(t('notif.pattern.exported'), 'info', 2000);
    }

    _exportMCL() {
        const state = this.automaton.exportWireworldState();
        if (!state) {
            this._showNotification(t('notif.pattern.empty'), 'warning', 2000);
            return;
        }

        const codec = new MCLCodec();
        const mclText = codec.encode(state);
        if (!mclText) {
            this._showNotification(t('notif.pattern.empty'), 'warning', 2000);
            return;
        }

        const blob = new Blob([mclText], {type: 'text/plain'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wireworld-${Date.now()}.mcl`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this._showNotification(t('notif.pattern.exported'), 'info', 2000);
    }

    importPatternFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.rle,.json,.mcl';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const text = ev.target.result;
                    // Detectar formato MCL primero (tiene su propia firma)
                    if (MCLCodec.isFormat(text)) {
                        this._importMCL(text, file.name);
                        return;
                    }

                    const format = RLECodec.detectFormat(text);
                    let patternData;

                    if (format === 'rle') {
                        const codec = new RLECodec();
                        const decoded = codec.decode(text);
                        patternData = {
                            pattern: decoded.pattern,
                            name: decoded.name || file.name.replace(/\.rle$/i, ''),
                            description: decoded.description || '',
                        };
                    } else if (format === 'json') {
                        patternData = JSON.parse(text);
                    } else {
                        this._showNotification(t('notif.pattern.invalidFormat'), 'warning', 2500);
                        return;
                    }

                    const center = Math.floor(this.automaton.gridSize / 2);
                    this.automaton.importPattern(patternData, center, center);
                    this.automaton.updateStats();
                    this.automaton.render();
                    this._showNotification(t('notif.pattern.imported'), 'info', 2000);
                } catch (err) {
                    console.error('Error importando patrón:', err);
                    this._showNotification(t('notif.pattern.importError'), 'warning', 3000);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    _importMCL(text, filename) {
        try {
            const codec = new MCLCodec();
            const decoded = codec.decode(text);

            // Auto-resize: si el patrón no cabe en el grid actual, ampliar con margen
            const needed = Math.max(decoded.width, decoded.height);
            const current = this.automaton.gridSize;
            if (needed > current) {
                // Margen del 20% redondeado a múltiplo de 5, mínimo 20px de margen
                const margin = Math.max(20, Math.round(needed * 0.2 / 5) * 5);
                const newSize = Math.min(Math.round((needed + margin) / 5) * 5, 1000);
                this.automaton.resizeGrid(newSize);

                // Sincronizar slider y display
                const slider = document.getElementById('gridSize');
                const display = document.getElementById('gridSizeValue');
                if (slider) slider.value = newSize;
                if (display) display.textContent = `${newSize}×${newSize}`;
            }

            // Limpiar el grid antes de importar para no superponer circuitos
            this.automaton.clear();

            // Si WireWorld ya está activo, cargar directamente con estados completos
            if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.automaton.wireworldEngine?.isActive) {
                this.automaton.importWireworldState(decoded.stateGrid, decoded.width, decoded.height);
                this._showNotification(t('notif.pattern.imported'), 'info', 2000);
                return;
            }

            // Si WireWorld no está activo: importar como patrón binario estándar
            // (conductor=1, resto=0) y avisar al usuario
            const pattern = [];
            for (let y = 0; y < decoded.height; y++) {
                const row = [];
                for (let x = 0; x < decoded.width; x++) {
                    row.push((decoded.stateGrid[x]?.[y] ?? 0) > 0 ? 1 : 0);
                }
                pattern.push(row);
            }
            const patternData = {
                pattern,
                name: decoded.name || filename.replace(/\.mcl$/i, ''),
                description: decoded.description || ''
            };
            const center = Math.floor(this.automaton.gridSize / 2);
            this.automaton.importPattern(patternData, center, center);
            this.automaton.updateStats();
            this.automaton.render();
            this._showNotification(t('notif.pattern.importedMCLPartial'), 'warning', 3000);
        } catch (err) {
            console.error('Error importando MCL:', err);
            this._showNotification(t('notif.pattern.importError'), 'warning', 3000);
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
                this._displayController.updateHeaderInfo();
                eventBus.emit('automaton:filterChanged', {
                    mode: SpecialEngineManager.MODES.STANDARD,
                    rule: window.RULES[selector.value].ruleString
                });
            }
        }

        // Quitar el foco del selector para que las teclas de letra (S, R, A, C, etc.)
        // sigan disparando los atajos de teclado del simulador en lugar de navegar
        // entre opciones del <select>.
        selector.blur();
    }

    applyCustomRule() {
        const birthInput = document.getElementById('birthInput').value;
        const survivalInput = document.getElementById('survivalInput').value;

        try {
            const customRule = parseCustomRule(birthInput, survivalInput);
            this.automaton.setRule(customRule.survival, customRule.birth);

            // ACTUALIZAR EL OBJETO RULES.CUSTOM
            if (window.RULES?.custom) {
                window.RULES.custom.survival = customRule.survival;
                window.RULES.custom.birth = customRule.birth;
                window.RULES.custom.ruleString = `B${customRule.birth.join('')}/S${customRule.survival.join('')}`;

                // ACTUALIZAR EL SELECTOR VISUALMENTE
                const selector = document.getElementById('ruleSelector');
                const selectedOption = selector.options[selector.selectedIndex];
                selectedOption.textContent = `${t('config.rule.custom')} (${window.RULES.custom.ruleString})`;

                // ACTUALIZAR EL HEADER INMEDIATAMENTE
                this._displayController.updateRuleInfo(window.RULES.custom);
                eventBus.emit('automaton:filterChanged', {
                    mode: SpecialEngineManager.MODES.STANDARD,
                    rule: window.RULES.custom.ruleString
                });

            }

        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    /**
     * Muestra una notificación flotante
     * @private
     */
    _showNotification(message, type = 'info', duration = 2000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;

        // Estilos inline para evitar crear CSS nuevo
        notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'warning' ? '#f59e0b' : '#10b981'};
        color: white;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 0.3s, transform 0.3s;
        pointer-events: none;
    `;

        document.body.appendChild(notification);

        // Animar entrada
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateY(0)';
        });

        // Auto-remover
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
    }

    changeNeighborhoodType(type) {
        if (type === 'custom') {
            // Aplicar la selección visual actual sin cambiar offsets
            this._applyCustomNeighborhood();
        } else {
            this.automaton.setNeighborhoodType(type);
        }
        // Sincronizar la grilla visual con el nuevo tipo
        this._renderNeighborhoodGrid(this.automaton.neighborhoodRadius);
        this._displayController.updateHeaderInfo();
    }

    changeNeighborhoodRadius(radius) {
        this.automaton.setNeighborhoodRadius(radius);
        this._displayController.updateHeaderInfo();
        const radiusValue = document.getElementById('radiusValue');
        if (radiusValue) radiusValue.textContent = radius;
        // Reconstruir la grilla con el nuevo radio
        this._renderNeighborhoodGrid(radius);
    }

    /**
     * Construye (o reconstruye) la grilla visual de (2R+1)×(2R+1) celdas.
     *
     * Estado inicial de las celdas:
     *   - moore   → todas activas
     *   - neumann → solo las del diamante (|dx|+|dy| ≤ R)
     *   - custom  → la selección existente, filtrada al nuevo radio
     * @param {number} radius
     */
    _renderNeighborhoodGrid(radius) {
        const container = document.getElementById('neighborhoodGrid');
        if (!container) return;

        const side = 2 * radius + 1;
        container.style.gridTemplateColumns = `repeat(${side}, 26px)`;
        container.innerHTML = '';

        const currentType = this.automaton.neighborhoodType;
        let activeSet;

        if (currentType === 'moore') {
            activeSet = new Set();
            for (let dx = -radius; dx <= radius; dx++)
                for (let dy = -radius; dy <= radius; dy++)
                    if (dx !== 0 || dy !== 0) activeSet.add(`${dx},${dy}`);
        } else if (currentType === 'neumann') {
            activeSet = new Set();
            for (let dx = -radius; dx <= radius; dx++)
                for (let dy = -radius; dy <= radius; dy++)
                    if ((dx !== 0 || dy !== 0) && Math.abs(dx) + Math.abs(dy) <= radius)
                        activeSet.add(`${dx},${dy}`);
        } else {
            // custom: conservar selección existente recortada al nuevo radio
            activeSet = new Set(
                this.automaton.core.neighborhood.offsets
                    .filter(o => Math.abs(o.dx) <= radius && Math.abs(o.dy) <= radius)
                    .map(o => `${o.dx},${o.dy}`)
            );
        }

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const isCenter = dx === 0 && dy === 0;
                const cell = document.createElement('div');
                cell.className = 'neighborhood-cell' + (isCenter ? ' center' : '');
                cell.dataset.dx = dx;
                cell.dataset.dy = dy;

                if (isCenter) {
                    cell.textContent = '●';
                } else if (activeSet.has(`${dx},${dy}`)) {
                    cell.classList.add('active');
                }

                if (!isCenter) {
                    this._addEventListener(cell, 'click', () => {
                        cell.classList.toggle('active');
                        this._onNeighborhoodCellToggled();
                    });
                }

                container.appendChild(cell);
            }
        }

        this._updateCustomNeighborCount();
    }

    /**
     * Llamado cada vez que el usuario activa/desactiva una celda manualmente.
     * Detecta si la selección resultante coincide con Moore o Neumann para
     * actualizar el selector de tipo; si no, marca 'custom'.
     */
    _onNeighborhoodCellToggled() {
        const radius = this.automaton.neighborhoodRadius;
        const detected = this._detectPresetType(radius);

        if (detected === 'moore' || detected === 'neumann') {
            this.automaton.setNeighborhoodType(detected);
        } else {
            this._applyCustomNeighborhood();
        }

        const typeSelect = document.getElementById('neighborhoodType');
        if (typeSelect) typeSelect.value = detected;

        this._updateCustomNeighborCount();
        this._displayController.updateHeaderInfo();
    }

    /**
     * Compara la selección visual actual con los patrones Moore y Neumann.
     * @param {number} radius
     * @returns {'moore' | 'neumann' | 'custom'}
     */
    _detectPresetType(radius) {
        const container = document.getElementById('neighborhoodGrid');
        if (!container) return 'custom';

        const active = new Set();
        container.querySelectorAll('.neighborhood-cell:not(.center)').forEach(cell => {
            if (cell.classList.contains('active')) active.add(`${cell.dataset.dx},${cell.dataset.dy}`);
        });

        const mooreSet = new Set();
        const neumannSet = new Set();
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                if (dx === 0 && dy === 0) continue;
                const key = `${dx},${dy}`;
                mooreSet.add(key);
                if (Math.abs(dx) + Math.abs(dy) <= radius) neumannSet.add(key);
            }
        }

        const eq = (a, b) => a.size === b.size && [...a].every(k => b.has(k));
        if (eq(active, mooreSet)) return 'moore';
        if (eq(active, neumannSet)) return 'neumann';
        return 'custom';
    }

    /**
     * Lee el estado visual y lo aplica al autómata como vecindad custom.
     */
    _applyCustomNeighborhood() {
        const container = document.getElementById('neighborhoodGrid');
        if (!container) return;

        const offsets = [];
        container.querySelectorAll('.neighborhood-cell:not(.center)').forEach(cell => {
            if (cell.classList.contains('active')) {
                offsets.push({dx: parseInt(cell.dataset.dx), dy: parseInt(cell.dataset.dy)});
            }
        });

        this.automaton.core.setNeighborhood({offsets});
        this._updateCustomNeighborCount();
        this._displayController.updateNeighborhoodInfo();
    }

    /**
     * Actualiza el contador de vecinos activos en la etiqueta.
     */
    _updateCustomNeighborCount() {
        const countEl = document.getElementById('customNeighborCount');
        if (!countEl) return;
        const active = document.querySelectorAll('#neighborhoodGrid .neighborhood-cell.active').length;
        countEl.textContent = active;
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

        // Render inicial: la grilla siempre visible al cargar
        this._renderNeighborhoodGrid(this.automaton.neighborhoodRadius);
    }

    _bindPatternsControls() {
        const toggleRowsBtn = document.getElementById('patternsToggleRows');
        const toggleCompactBtn = document.getElementById('patternsToggleCompact');
        const toggleSortBtn = document.getElementById('patternsToggleSort');
        const bucketBtn = document.getElementById('bucketToolBtn');
        const container = document.getElementById('patternsContainer');

        if (bucketBtn) {
            this._addEventListener(bucketBtn, 'click', () => {
                const cc = this._canvasController;
                if (!cc) return;
                cc.bucketToolActive = !cc.bucketToolActive;
                bucketBtn.classList.toggle('active', cc.bucketToolActive);
                // Deseleccionar patrón activo al activar el bote
                if (cc.bucketToolActive) this.deselectPattern();
                cc._updateCursor();
            });
        }

        // Deseleccionar bote cuando se elige un patrón
        this._cleanups.push(
            eventBus.on('pattern:selected', () => {
                if (this._canvasController?.bucketToolActive) {
                    this._canvasController.bucketToolActive = false;
                    document.getElementById('bucketToolBtn')?.classList.remove('active');
                    this._canvasController._updateCursor();
                }
                this._displayController.updateDrawModeIndicator();
            })
        );

        if (toggleRowsBtn && container) {
            this._addEventListener(toggleRowsBtn, 'click', () => {
                this.patternsTwoRows = !this.patternsTwoRows;
                container.classList.toggle('two-rows', this.patternsTwoRows);
                const icon = toggleRowsBtn.querySelector('i');
                if (icon) icon.className = this.patternsTwoRows ? 'fas fa-grip-lines-vertical' : 'fas fa-grip-lines';
            });
            container.classList.add('two-rows');
            toggleRowsBtn.querySelector('i')?.classList.add('fa-grip-lines-vertical');
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
            container.classList.add('compact-view');
            toggleCompactBtn.querySelector('i')?.classList.add('fa-expand-alt');
        }

        if (toggleSortBtn && window.patternManager) {
            this._addEventListener(toggleSortBtn, 'click', () => {
                this.patternsSortByCount = !this.patternsSortByCount;
                const icon = toggleSortBtn.querySelector('i');
                if (icon) icon.className = this.patternsSortByCount ? 'fas fa-sort-numeric-down' : 'fas fa-sort-alpha-down';
                window.patternManager.renderPatterns(this.patternsSortByCount);
            });
            window.patternManager.renderPatterns(false);
            toggleSortBtn.querySelector('i')?.classList.add('fa-sort-alpha-down');
        }

        const showAllBtn = document.getElementById('patternsShowAll');
        if (showAllBtn && window.patternManager) {
            this._addEventListener(showAllBtn, 'click', () => {
                this.patternsShowAll = !this.patternsShowAll;
                showAllBtn.classList.toggle('active', this.patternsShowAll);
                window.patternManager.setShowAll(this.patternsShowAll);
            });

            // Al cambiar de modo el filtro se resetea — apagar el botón si estaba activo
            this._cleanups.push(
                eventBus.on('automaton:filterChanged', () => {
                    if (this.patternsShowAll) {
                        this.patternsShowAll = false;
                        showAllBtn.classList.remove('active');
                        window.patternManager.setShowAll(false);
                    }
                })
            );
        }
    }

    _bindPatternEvents() {
        // Escuchar eventos DEL EVENTBUS
        this._cleanups.push(
            eventBus.on('pattern:selected', () => {
                this._displayController.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:updated', () => {
                this._displayController.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:cleared', () => {
                this._displayController.updateDrawModeIndicator();
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
        this._patternState.pattern = null;
        this._patternState.key = null;
        this._patternState.rotation = 0;

        document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
            btn.classList.remove('active');
        });

        const miniEl = document.getElementById('patternNameMini');
        if (miniEl) miniEl.textContent = t('patterns.select');

        window.patternManager?.hidePatternPreview();
        window.patternManager?.hideInfluenceArea();
        this._displayController.updateDrawModeIndicator();
    }
}