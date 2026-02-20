class UIController {
    constructor(automatonInstance) {
        if (!automatonInstance) {
            throw new Error('UIController requiere una instancia de CellularAutomaton');
        }

        this.automaton = automatonInstance;

        this.showInfluenceArea = false;
        this.patternsTwoRows = true;
        this.patternsCompactView = true;
        this.patternsSortByCount = false;

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

        this._displayController = new DisplayController(this.automaton);

        this._cleanups.push(
            i18n.onLocaleChange(() => this._onLocaleChanged())
        );
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
        console.debug('UIController: Esperando reglas...');

        let attempts = 0;
        while ((!window.RULES || Object.keys(window.RULES).length === 0) && attempts < 100) {
            await new Promise(resolve => setTimeout(resolve, 50));
            attempts++;
        }

        console.debug(`✅ UIController: ${Object.keys(window.RULES).length} reglas disponibles`);

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

        if (window.selectedPattern === this._patternState?.pattern) window.selectedPattern = null;
        if (window.selectedPatternKey === this._patternState?.key) window.selectedPatternKey = null;
        if (window.selectedPatternRotation === this._patternState?.rotation) window.selectedPatternRotation = 0;

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
            window.selectedPatternRotation = 0;
        });

        const randomBtn = document.getElementById('randomBtn');
        if (randomBtn) {
            this._addEventListener(randomBtn, 'click', () => {
                const percentageSlider = document.getElementById('randomPercentage');
                const percentage = percentageSlider ? parseInt(percentageSlider.value, 10) / 100 : 0.35;
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
                if (this.automaton.specialMode === 'triangle' && this.automaton.triangleEngine) {
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
                this._canvasController.clearSelection();
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

    randomize() {
        const wasRunning = this.automaton.isRunning;
        if (wasRunning) this.togglePlay(); // Pausar

        this.automaton.randomize();

        if (wasRunning) {
            // Reanudar después de renderizar
            requestAnimationFrame(() => this.togglePlay());
        }
    }

    clear() {
        const wasRunning = this.automaton.isRunning;

        if (wasRunning) {
            this.automaton.stop();
            this.automaton.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

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
            console.debug('↶ Undo ejecutado');
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
            console.debug('↷ Redo ejecutado');
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
            this.automaton.stop();
            this.automaton.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
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
        const newState = this.automaton.renderer.toggleGrid();

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

        if (!this._canvasController.showInfluenceArea) hideInfluenceArea();
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
            alert(t('notif.pattern.exported'));
        } else {
            alert(t('notif.pattern.empty'));
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
            }
        }
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

                console.debug(`✅ Regla personalizada aplicada: ${window.RULES.custom.ruleString}`);
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
        this.automaton.setNeighborhoodType(type);
        this._displayController.updateHeaderInfo();
    }

    changeNeighborhoodRadius(radius) {
        this.automaton.setNeighborhoodRadius(radius);
        this._displayController.updateHeaderInfo();
        const radiusValue = document.getElementById('radiusValue');
        if (radiusValue) radiusValue.textContent = radius;
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

    _bindPatternsControls() {
        const toggleRowsBtn = document.getElementById('patternsToggleRows');
        const toggleCompactBtn = document.getElementById('patternsToggleCompact');
        const toggleSortBtn = document.getElementById('patternsToggleSort');
        const container = document.getElementById('patternsContainer');

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
    }

    _bindPatternEvents() {
        // Escuchar eventos DEL EVENTBUS
        this._cleanups.push(
            eventBus.on('pattern:selected', () => {
                console.debug('UIController: Evento pattern:selected recibido');
                this._displayController.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:updated', () => {
                console.debug('UIController: Evento pattern:updated recibido');
                this._displayController.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:cleared', () => {
                console.debug('UIController: Evento pattern:cleared recibido');
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
        window.selectedPattern = null;
        window.selectedPatternKey = null;
        window.selectedPatternRotation = 0;

        document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
            btn.classList.remove('active');
        });

        const miniEl = document.getElementById('patternNameMini');
        if (miniEl) miniEl.textContent = t('patterns.select');

        hidePatternPreview();
        hideInfluenceArea();
        this._displayController.updateDrawModeIndicator();
    }
}