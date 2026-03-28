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

        this._cleanups = [];

        this._patternState = {
            pattern: null,
            key: null,
            rotation: 0
        };

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

        // Import/Export controller — importación y exportación de patrones
        // Grid controller — dimensiones de grid y zoom
        this._gridController = new GridController({
            automaton: this.automaton,
            onStopAutomaton: () => this._stopAutomaton(),
            onSyncPlayButton: () => this._syncPlayButtonState(),
            onShowNotification: (msg, type, dur) => this._showNotification(msg, type, dur),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
        });

        this._importExportController = new ImportExportController({
            automaton: this.automaton,
            getSelection: () => this._canvasController?.selection,
            onShowNotification: (msg, type, dur) => this._showNotification(msg, type, dur),
            onGridResized: (newSize) => {
                const slider = document.getElementById('gridSize');
                const display = document.getElementById('gridSizeValue');
                if (slider) slider.value = newSize;
                if (display) display.textContent = `${newSize}×${newSize}`;
            },
            addEventListener: (target, event, handler, opts) => this._addEventListener(target, event, handler, opts)
        });

        // Rule controller — selector de reglas B/S y regla custom
        this._ruleController = new RuleController({
            automaton: this.automaton,
            onActivateGenerations: (b, s, c) => this._specialModeController.activateGenerationsMode(b, s, c),
            onDeactivateGenerations: () => this._specialModeController.deactivateGenerationsMode(),
            onUpdateHeader: () => this._displayController.updateHeaderInfo(),
            onUpdateRuleInfo: (rule) => this._displayController.updateRuleInfo(rule),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
        });

        // Neighborhood controller — grilla visual de vecindad
        this._neighborhoodController = new NeighborhoodController({
            automaton: this.automaton,
            onUpdateHeader: () => this._displayController.updateHeaderInfo(),
            onUpdateNeighborhood: () => this._displayController.updateNeighborhoodInfo(),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
        });

        // Effects controller — actividad visual y área de influencia
        this._effectsController = new EffectsController({
            automaton: this.automaton,
            getShowInfluenceArea: () => this._canvasController.showInfluenceArea,
            setShowInfluenceArea: (v) => {
                this._canvasController.showInfluenceArea = v;
            },
            onHideInfluenceArea: () => window.patternManager?.hideInfluenceArea(),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
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
        this._neighborhoodController.bindEvents();
        this._bindPatternsControls();

        this.updateSpeedDisplay();
        this._gridController.initDisplays();
        this._displayController.updateNeighborhoodInfo();
        this._ruleController.loadRules();

        eventBus.on('automaton:runningChanged', () => this._syncPlayButtonState());

        eventBus.on('app:ready', () => setTimeout(() => this._gridController.initGridRectUI(), 60));

        eventBus.emit('ui:ready');
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    destroy() {
        this._gridController?.destroy();
        this._gridController = null;

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
        this._ruleController.loadRules();
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

        this._ruleController.bindEvents();

        this._effectsController.bindEvents();

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
        this._gridController.bindEvents();
        this._importExportController.bindEvents();
        this._addEventListener(document.getElementById('limitType'), 'change', () => this.updateLimitType());
        this._addEventListener(document.getElementById('limitValue'), 'input', () => this.updateLimitValue());

        // Toggle de rendimiento
        const perfToggle = document.getElementById('perfToggle');
        if (perfToggle) {
            this._addEventListener(perfToggle, 'click', () => this._togglePerf());
        }
        this._cleanups.push(
            eventBus.on('perf:update', (perf) => this._updatePerfOverlay(perf))
        );

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

                if (isActive) {
                    header.classList.remove('active');
                } else {
                    header.classList.add('active');
                    // Al abrir el acordeón de Vecindad, re-renderizar la grilla
                    // con el ancho real disponible (que era 0 mientras estaba cerrado).
                    if (header.dataset.accordion === 'neighborhood') {
                        requestAnimationFrame(() => {
                            this._renderNeighborhoodGrid(this.automaton.neighborhoodRadius);
                        });
                    }
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
            case '+':
                this.increaseSpeed();
                break;
            case '-':
                this.decreaseSpeed();
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
            case 'g':
                this.toggleGrid();
                break;
            case 'h':
                this.toggleHighlightsGrid();
                break;
            case 'i':
                this._togglePerf();
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
        const value = parseInt(String(slider.value), 10);
        if (value <= 1) return;
        slider.value = value - 1;
        slider.dispatchEvent(new Event('input'));
    }

    increaseSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(String(slider.value), 10);
        if (value >= 10) return;
        slider.value = value + 1;
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

    updateGridSizeDisplay() {
        this._gridController.updateGridSizeDisplay();
    }

    updateCellSize() {
        this._gridController.updateCellSize();
    }

    updateCellSizeDisplay() {
        this._gridController.updateCellSizeDisplay();
    }

    autoSizeGrid() {
        this._gridController.autoSizeGrid();
    }

    toggleGrid() {
        return this._gridController.toggleGrid();
    }

    toggleHighlightsGrid() {
        return this._gridController.toggleHighlightsGrid();
    }

    _togglePerf() {
        const btn = document.getElementById('perfToggle');
        const overlay = document.getElementById('perfOverlay');
        if (!btn || !overlay) return;

        const active = btn.classList.toggle('active');
        overlay.style.display = active ? 'block' : 'none';
        this.automaton.setPerfVisible(active);

        // Forzar actualización inmediata con datos actuales o placeholder
        if (active) {
            this._updatePerfOverlay({
                genPerSec: 0,
                stepMs: 0,
                renderMs: 0,
                mode: this.automaton.specialMode || 'Standard'
            });
        }
    }

    _updatePerfOverlay(perf) {
        const overlay = document.getElementById('perfOverlay');
        if (!overlay || overlay.style.display === 'none') return;

        const stepMs = perf.stepMs.toFixed(1);
        const renderMs = perf.renderMs.toFixed(1);
        const totalMs = (perf.stepMs + perf.renderMs).toFixed(1);
        const gps = perf.genPerSec;

        // Colorear según rendimiento: <16ms verde, <33ms amarillo, >33ms rojo
        const cls = (ms) => ms < 16 ? '' : ms < 33 ? 'warn' : 'slow';

        overlay.innerHTML = `
            <div class="perf-row">
                <span class="perf-label">gen/s</span>
                <span class="perf-value">${gps}</span>
            </div>
            <div class="perf-row">
                <span class="perf-label">step</span>
                <span class="perf-value ${cls(perf.stepMs)}">${stepMs}ms</span>
            </div>
            <div class="perf-row">
                <span class="perf-label">render</span>
                <span class="perf-value ${cls(perf.renderMs)}">${renderMs}ms</span>
            </div>
            <div class="perf-row">
                <span class="perf-label">total</span>
                <span class="perf-value ${cls(perf.stepMs + perf.renderMs)}">${totalMs}ms</span>
            </div>
            <div class="perf-row">
                <span class="perf-label">modo</span>
                <span class="perf-value" style="color:var(--gray-text)">${perf.mode}</span>
            </div>`;
    }

    toggleInfluenceArea() {
        this._effectsController.toggleInfluenceArea();
    }

    quickToggleInfluenceArea() {
        this._effectsController.quickToggleInfluenceArea();
    }

    toggleActivityEffect() {
        this._effectsController.toggleActivityEffect();
    }

    _toggleActivityEffect(checked) {
        this._effectsController._toggleActivityEffect(checked);
    }

    toggleActivityEffectCheckbox() {
        this._effectsController._syncActivityEffectCheckbox();
    }

    /**
     * Conmuta el bloque activityColors entre sus dos modos:
     *  - Binario (default): 4 swatches fijos dead/born/alive/dying
     *  - Generations: N swatches dinámicos (uno por estado del engine)
     *
     * Llamado por SpecialModeController al activar/desactivar Generations.
     * @param {boolean} active
     */
    _syncActivityColorsBlock(active) {
        this._effectsController.syncActivityColorsBlock(active);
    }

    // =========================================
    // IMPORT / EXPORT — delegados a ImportExportController
    // =========================================

    exportPattern() {
        this._importExportController.exportPattern();
    }

    importPatternFromFile() {
        this._importExportController.importPatternFromFile();
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
        this._ruleController.changeRule();
    }

    applyCustomRule() {
        this._ruleController.applyCustomRule();
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
        this._neighborhoodController.changeNeighborhoodType(type);
    }

    changeNeighborhoodRadius(radius) {
        this._neighborhoodController.changeNeighborhoodRadius(radius);
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
        this._neighborhoodController.renderGrid(radius);
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

        const nameEl = document.getElementById('patternNameMini');
        const detailsEl = document.getElementById('patternDetailsMini');
        const descEl = document.getElementById('patternDescriptionMini');

        if (nameEl) nameEl.textContent = t('patterns.select');
        if (detailsEl) detailsEl.textContent = t('patterns.details');
        if (descEl) descEl.textContent = '';

        window.patternManager?.hidePatternPreview();
        window.patternManager?.hideInfluenceArea();
        this._displayController.updateDrawModeIndicator();
    }
}