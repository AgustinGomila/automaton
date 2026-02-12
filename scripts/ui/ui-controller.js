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

        this._selectionContainerHandler = null;

        this._patternState = {
            pattern: null,
            key: null,
            rotation: 0
        };

        this.showActivityEffect = true;

        // Suscribirse AHORA, ANTES de que automata empiece a emitir
        this._subscribeToAutomatonEvents();

        this._waitForRulesAndInit().then();

        this._setupSelectionDelegation();

        // Suscribirse a cambios de idioma
        this._cleanups.push(
            i18n.onLocaleChange(() => this._onLocaleChanged())
        );
    }

    _onLocaleChanged() {
        // Actualizar todos los elementos dinámicos
        this.updateHeaderInfo();
        this.updateSpeedDisplay();
        this.updateNeighborhoodInfo();
        this.updateDrawModeIndicator();

        // Actualizar botón de play/pause según estado
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
        this.updateNeighborhoodInfo();
        this.loadRules();

        eventBus.on('automaton:runningChanged', ({isRunning}) => {
            const playIcon = document.getElementById('playIcon');
            const playText = document.getElementById('playText');

            if (playIcon && playText) {
                playIcon.className = isRunning ? 'fas fa-pause' : 'fas fa-play';
                playText.textContent = t(isRunning ? 'controls.pause' : 'controls.play');
            }
        });

        eventBus.emit('ui:ready');
    }

    _setupSelectionDelegation() {
        const container = document.querySelector('.canvas-controls');
        if (!container) return;

        // Handler delegado para clics en botones de selección
        this._selectionContainerHandler = (e) => {
            const deleteBtn = e.target.closest('#deleteSelectionBtn');
            const clearBtn = e.target.closest('#clearSelectionBtn');

            if (deleteBtn) {
                e.preventDefault();
                this.deleteSelection();
            } else if (clearBtn) {
                e.preventDefault();
                this.clearSelection();
            }
        };

        container.addEventListener('click', this._selectionContainerHandler);

        // Registrar cleanup
        this._cleanups.push(() => {
            container.removeEventListener('click', this._selectionContainerHandler);
        });
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    destroy() {
        // 1. Detener timers
        if (this._gridSizeDebounceTimer) {
            clearTimeout(this._gridSizeDebounceTimer);
        }
        if (this._mouseTimeout) {
            clearTimeout(this._mouseTimeout);
        }

        // 2. Limpiar selección visual
        this._removeSelectionVisual();
        this._removeDragPreview();
        this._hideSelectionInfo();

        // 3. Limpiar overlays del canvas
        document.getElementById('patternPreview')?.remove();
        document.getElementById('influenceArea')?.remove();
        document.getElementById('selectionOverlay')?.remove();
        document.getElementById('selectionInfo')?.remove();
        document.getElementById('dragPreview')?.remove();

        // 4. Limpiar event listeners registrados
        this._cleanups.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.warn('Error en cleanup:', e);
            }
        });
        this._cleanups = [];

        // 5. Limpiar estado global si existe
        if (window.selectedPattern === this._patternState?.pattern) {
            window.selectedPattern = null;
        }
        if (window.selectedPatternKey === this._patternState?.key) {
            window.selectedPatternKey = null;
        }
        if (window.selectedPatternRotation === this._patternState?.rotation) {
            window.selectedPatternRotation = 0;
        }

        // 6. Liberar referencias
        this.automaton = null;
        this._patternState = null;
        this.lastCell = null;
        this.selection = null;
        this.selectionContent = null;
        this.dragOffset = null;

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

        console.debug('🔔 UIController: Suscribiendo a eventos del automata...');

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

        console.debug('✅ UIController: Suscrito a TODOS los eventos');
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
        // Selector de idioma
        this._addEventListener(document.getElementById('languageSelect'), 'change', (e) => {
            i18n.setLocale(e.target.value);
        });

        // Controles principales
        this._addEventListener(document.getElementById('playBtn'), 'click', () => this.togglePlay());
        this._addEventListener(document.getElementById('stepBtn'), 'click', () => this.step());
        this._addEventListener(document.getElementById('stepBackBtn'), 'click', () => this.undo());
        this._addEventListener(document.getElementById('clearBtn'), 'click', () => this.clear());
        this._addEventListener(document.getElementById('cancelPatternBtn'), 'click', () => {
            this.deselectPattern();
            window.selectedPatternRotation = 0;
        });

        // Handler del botón aleatorio
        const randomBtn = document.getElementById('randomBtn');
        if (randomBtn) {
            this._addEventListener(randomBtn, 'click', () => {
                // Obtener valor del slider
                const percentageSlider = document.getElementById('randomPercentage');
                const percentage = percentageSlider ?
                    parseInt(percentageSlider.value, 10) / 100 : 0.35;

                this.automaton.randomize(percentage);
                this._showNotification(t('notif.randomized', {density: Math.round(percentage * 100)}), 'info', 1500);
                this.updateHeaderInfo();
            });
        }

        // Instrucciones
        this._addEventListener(document.getElementById('instructionsBtn'), 'click', () => {
            document.getElementById('instructionsModal').classList.add('show');
        });
        // Cerrar modal
        this._addEventListener(document.getElementById('closeModalBtn'), 'click', () => {
            document.getElementById('instructionsModal').classList.remove('show');
        });
        // Cerrar modal al hacer clic fuera
        this._addEventListener(document.getElementById('instructionsModal'), 'click', (e) => {
            if (e.target.id === 'instructionsModal') {
                document.getElementById('instructionsModal').classList.remove('show');
            }
        });

        // Reglas
        this._addEventListener(document.getElementById('ruleSelector'), 'change', () => this.changeRule());
        this._addEventListener(document.getElementById('applyCustomRuleBtn'), 'click', () => this.applyCustomRule());

        // Toggle área de influencia
        this._addEventListener(document.getElementById('influenceToggle'), 'change', () => this.toggleInfluenceArea());
        this._addEventListener(document.getElementById('quickInfluenceToggle'), 'click', () => this.quickToggleInfluenceArea());

        // Toggle para efectos de actividad
        this._addEventListener(document.getElementById('activityEffectToggle'), 'change', () => this.toggleActivityEffect());

        // Tablero toroidal o finito
        const wrapToggle = document.getElementById('wrapToggle');
        if (wrapToggle) {
            this._addEventListener(wrapToggle, 'change', () => {
                this.automaton.wrapEdges = wrapToggle.checked;
                this.automaton.generation = 0;
                this.automaton.updateStats();
                this.automaton._markAllDirty();
                this.automaton.render();
                this.updateNeighborhoodInfo();

                // Emitir evento para cualquier otro listener
                eventBus.emit('automaton:wrapChanged', {wrap: wrapToggle.checked});
            });
        }

        // Random Percent
        this._bindRandomPercentageControl();

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

        // Límites
        this._addEventListener(document.getElementById('limitType'), 'change', () => this.updateLimitType());
        this._addEventListener(document.getElementById('limitValue'), 'input', () => this.updateLimitValue());

        // Motores especiales: Wolfram, RD2D, etc
        this._bindSpecialEnginesEvents();

        // Canvas
        this._bindCanvasEvents();

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

    _bindSpecialEnginesEvents() {
        const debugBtn = document.getElementById('debugRD2D');
        if (debugBtn) {
            this._addEventListener(debugBtn, 'click', () => {
                if (this.automaton.rd2dEngine) {
                    this.automaton.rd2dEngine._debugStateDistribution();
                    this.automaton.rd2dEngine._debugSyncCheck();
                }
            });
        }

        // Toggle RD-2D
        const rd2dToggle = document.getElementById('rd2dToggle');
        if (rd2dToggle) {
            this._addEventListener(rd2dToggle, 'change', () => {
                if (rd2dToggle.checked) {
                    this.activateRD2DMode();
                } else {
                    this.deactivateRD2DMode();
                }
            });
        }

        // Toggle Wolfram (actualizado)
        const wolframToggle = document.getElementById('wolframToggle');
        const wolframControls = document.getElementById('wolframControls');

        if (wolframToggle) {
            this._addEventListener(wolframToggle, 'change', () => {
                if (wolframToggle.checked) {
                    // Desactivar RD-2D si está activo
                    const rd2dToggle = document.getElementById('rd2dToggle');
                    if (rd2dToggle) {
                        rd2dToggle.checked = false;
                        this._toggleRD2DControls(false);
                    }

                    this._toggleWolframControls(true);

                    const rule = parseInt(document.getElementById('wolframRule')?.value) || 30;
                    const direction = document.getElementById('wolframDirection')?.value || 'vertical';
                    this.activateWolframMode(rule, direction);
                } else {
                    this._toggleWolframControls(false);
                    this.deactivateWolframMode();
                }
            });
        }

        const resetSeedBtn = document.getElementById('resetWolframSeed');
        if (resetSeedBtn) {
            this._addEventListener(resetSeedBtn, 'click', () => {
                if (this.automaton.wolframEngine?.isActive) {
                    this.automaton.wolframEngine.forceInitializeSeed();
                    this.automaton.render();
                    this._showNotification(t('wolfram.resetSeed'), 'info', 1500);
                }
            });
        }

        const ruleInput = document.getElementById('wolframRule');
        if (ruleInput) {
            this._addEventListener(ruleInput, 'input', () => {
                const rule = parseInt(String(ruleInput.value), 10) || 30;
                const display = document.getElementById('wolframRuleDisplay');
                if (display) display.textContent = String(rule);

                if (this.automaton.wolframEngine?.isActive) {
                    const direction = this.automaton.wolframEngine.direction;

                    // === DETENER SI ESTÁ CORRIENDO ===
                    if (this.automaton.isRunning) {
                        this.automaton.stop();
                        this.automaton.isRunning = false;
                        eventBus.emit('automaton:runningChanged', {isRunning: false});
                    }

                    this.automaton.wolframEngine.activate(rule, direction);
                    this.updateHeaderInfo();

                    // === SINCRONIZAR BOTÓN ===
                    this._syncPlayButtonState();
                }
            });
        }

        const directionSelect = document.getElementById('wolframDirection');
        if (directionSelect) {
            this._addEventListener(directionSelect, 'change', () => {
                if (this.automaton.wolframEngine?.isActive) {
                    const rule = this.automaton.wolframEngine.ruleNumber;
                    this.automaton.wolframEngine.activate(rule, directionSelect.value);
                    this.automaton.clear();
                    if (this.automaton.wolframEngine._initializeSeed) {
                        this.automaton.wolframEngine._initializeSeed();
                    }
                    this.automaton.render();
                }
            });
        }

        // Presets de reglas
        document.querySelectorAll('.btn-preset[data-rule]').forEach(btn => {
            this._addEventListener(btn, 'click', () => {
                const rule = parseInt(btn.dataset.rule);
                const ruleInput = document.getElementById('wolframRule');
                const display = document.getElementById('wolframRuleDisplay');

                if (ruleInput) ruleInput.value = rule;
                if (display) display.textContent = rule.toString();

                if (this.automaton.wolframEngine?.isActive) {
                    // === DETENER SI ESTÁ CORRIENDO ===
                    if (this.automaton.isRunning) {
                        this.automaton.stop();
                        this.automaton.isRunning = false;
                        eventBus.emit('automaton:runningChanged', {isRunning: false});
                    }

                    const direction = this.automaton.wolframEngine.direction;
                    this.automaton.wolframEngine.activate(rule, direction);
                    this.updateHeaderInfo();
                    this.automaton.clear();
                    this.automaton.wolframEngine._initializeSeed();
                    this.automaton.render();
                    this._showNotification(t('notif.rule.enabled', {rule: rule}), 'info', 1500);

                    // === SINCRONIZAR BOTÓN ===
                    this._syncPlayButtonState();
                }
            });
        });
    }

    async activateWolframMode(rule = 30, direction = 'vertical') {
        // Esperar a que el autómata esté listo
        if (!this.automaton || !this.automaton.grid) {
            console.error('❌ Autómata no inicializado');
            this._showNotification(t('notif.automata.error'), 'warning', 3000);
            return;
        }

        try {
            // === DETENER SIEMPRE ANTES DE CAMBIAR MODO ===
            if (this.automaton.isRunning) {
                this.automaton.stop();
                this.automaton.isRunning = false;
                eventBus.emit('automaton:runningChanged', {isRunning: false});
            }

            await this.automaton._initSpecialEngine('wolfram');

            // Desactivar RD-2D si está activo
            const rd2dToggle = document.getElementById('rd2dToggle');
            if (rd2dToggle) {
                rd2dToggle.checked = false;
                this._toggleRD2DControls(false);
            }

            // Activar controles Wolfram
            this._toggleWolframControls(true);

            // Desactivar controles 2D estándar
            document.getElementById('ruleSelector').disabled = true;
            document.getElementById('neighborhoodType').disabled = true;

            this.automaton.wolframEngine.activate(rule, direction);
            this.automaton.render();

            this.updateHeaderInfo();
            this._updateModeIndicator('wolfram');
            this._showNotification(t('notif.wolfram.enabled', {rule: rule}), 'info', 2000);

            // === SINCRONIZAR BOTÓN SIEMPRE ===
            this._syncPlayButtonState();

        } catch (error) {
            console.error('❌ Error cargando WolframEngine:', error);
            this._showNotification(t('notif.wolfram.error'), 'warning', 3000);
        }
    }

    deactivateWolframMode() {
        // === DETENER SIEMPRE ===
        if (this.automaton.isRunning) {
            this.automaton.stop();
            this.automaton.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        document.getElementById('ruleSelector').disabled = false;
        document.getElementById('neighborhoodType').disabled = false;

        this._toggleWolframControls(false);

        this.automaton.wolframEngine?.deactivate();
        this.automaton.specialMode = null;
        this.automaton.clear();
        this.automaton.render();

        this._updateModeIndicator('standard');
        this.updateHeaderInfo();
        this._showNotification(t('notif.standard.enabled'), 'info', 2000);

        // === SINCRONIZAR BOTÓN ===
        this._syncPlayButtonState();
    }

    async activateRD2DMode() {
        try {
            if (this.automaton.isRunning) {
                this.automaton.stop();
                this.automaton.isRunning = false;
                eventBus.emit('automaton:runningChanged', {isRunning: false});
            }

            await this.automaton._initSpecialEngine('rd2d');

            // Desactivar Wolfram si está activo
            const wolframToggle = document.getElementById('wolframToggle');
            if (wolframToggle) {
                wolframToggle.checked = false;
                this._toggleWolframControls(false);
            }

            // Activar controles RD-2D
            this._toggleRD2DControls(true);

            // Desactivar controles 2D estándar
            document.getElementById('ruleSelector').disabled = true;
            const neighborhoodSelect = document.getElementById('neighborhoodType');
            if (neighborhoodSelect) {
                neighborhoodSelect.value = 'neumann';
                neighborhoodSelect.disabled = true;
            }

            this.automaton.rd2dEngine.activate();
            this.automaton.render();

            this.updateHeaderInfo();
            this._updateModeIndicator('rd2d');
            this._showNotification(t('notif.rd2d.enabled'), 'info', 2000);

            this._syncPlayButtonState();
        } catch (error) {
            console.error('Error cargando RD2DEngine:', error);
            this._showNotification(t('notif.rd2d.error'), 'warning', 3000);
        }
    }

    deactivateRD2DMode() {
        if (this.automaton.isRunning) {
            this.automaton.stop();
            this.automaton.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        document.getElementById('ruleSelector').disabled = false;
        const neighborhoodSelect = document.getElementById('neighborhoodType');
        if (neighborhoodSelect) {
            neighborhoodSelect.disabled = false;
            neighborhoodSelect.value = 'moore';  // Restaurar default
        }

        this._toggleRD2DControls(false);

        this.automaton.rd2dEngine?.deactivate();
        this.automaton.specialMode = null;
        this.automaton.clear();
        this.automaton.render();

        this._updateModeIndicator('standard');
        this.updateHeaderInfo();
        this._showNotification(t('notif.standard.enabled'), 'info', 2000);

        this._syncPlayButtonState();
    }

    /**
     * Activa o desactiva visualmente los controles de Wolfram
     * @param {boolean} show - true para mostrar, false para ocultar
     * @private
     */
    _toggleWolframControls(show) {
        const wolframControls = document.getElementById('wolframControls');
        if (!wolframControls) return;

        if (show) {
            wolframControls.classList.add('active');
            wolframControls.style.opacity = '1';
            wolframControls.style.pointerEvents = 'all';
        } else {
            wolframControls.classList.remove('active');
            wolframControls.style.opacity = '0.5';
            wolframControls.style.pointerEvents = 'none';
        }
    }

    /**
     * Activa o desactiva visualmente los controles de RD-2D
     * @param {boolean} show - true para mostrar, false para ocultar
     * @private
     */
    _toggleRD2DControls(show) {
        const rd2dInfo = document.querySelector('.rd2d-info');
        if (!rd2dInfo) return;

        if (show) {
            rd2dInfo.style.opacity = '1';
            rd2dInfo.style.pointerEvents = 'all';
        } else {
            rd2dInfo.style.opacity = '0.5';
            rd2dInfo.style.pointerEvents = 'none';
        }
    }

    _updateModeIndicator(mode) {
        const indicator = document.getElementById('modeIndicator');
        if (!indicator) return;

        if (mode === 'wolfram') {
            const info = this.automaton.wolframEngine.getInfo();
            indicator.className = 'mode-indicator wolfram-mode';
            indicator.innerHTML = `
            <i class="fas fa-arrows-alt-v"></i>
            Wolfram R${info.rule} ${info.direction === 'vertical' ? '↓' : '→'}
        `;
        } else {
            indicator.className = 'mode-indicator standard-mode';
            indicator.innerHTML = `<i class="fas fa-th"></i> 2D Cellular`;
        }
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

        if (this._patternState.pattern) {
            const wasRunning = this.automaton.isRunning;
            if (wasRunning) this.togglePlay(); // Pausar

            this.automaton.importPattern(this._patternState.pattern, x, y);

            if (wasRunning) {
                // Reanudar después de renderizar
                requestAnimationFrame(() => this.togglePlay());
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

        // Verificar si hay patrón seleccionado y no es aleatorio
        if (this._patternState.pattern && this._patternState.pattern.pattern !== 'random') {
            // Actualizar rotación en el estado local
            this._patternState.rotation = (this._patternState.rotation + 90) % 360;

            // Recalcular patrón rotado
            this._patternState.pattern = getPatternWithRotation(
                this._patternState.key,
                this._patternState.rotation
            );

            // Emitir evento en lugar de llamada global directa
            eventBus.emit('pattern:rotationChanged', {
                pattern: this._patternState.pattern,
                rotation: this._patternState.rotation
            });

            // Actualizar preview con nuevas coordenadas
            const {x, y} = this.automaton.getCellFromMouse(e);
            showPatternPreview(x, y);

            // Actualizar área de influencia si está activa
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
        // Clipping preventivo
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

        // Límites seguros
        const maxX = this.automaton.gridSize - 1;
        const maxY = this.automaton.gridSize - 1;

        while (true) {
            // Clipping: solo añadir si está dentro de bounds
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

            // Prevenir loops infinitos por overflow
            if (cells.length > this.automaton.gridSize * 2) {
                console.warn('⚠️ Clipping interrumpió línea demasiado larga');
                break;
            }
        }

        return cells;
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
        const maxY = Math.max(this.selection.endY, this.selection.endY);
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
    // EVENTOS DE TECLADO
    // =========================================

    _bindKeyboardEvents() {
        this._addEventListener(document, 'keydown', (e) => this._handleKeyDown(e));
        this._addEventListener(document, 'keyup', (e) => this._handleKeyUp(e));
    }

    _handleKeyDown(e) {
        if (e.key === 'Control') this.ctrlPressed = true;
        if (e.key === 'Shift') this.shiftPressed = true;

        // Ctrl+Z (Undo)
        if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
        }

        // Ctrl+Shift+Z (Redo)
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.redo();
            return;
        }

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
                if (this.selection) {
                    e.preventDefault();
                    this.deleteSelection();
                }
                break;
            case 'h':
            case '?':
                e.preventDefault();
                document.getElementById('instructionsModal').classList.add('show');
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

    _syncPlayButtonState() {
        const isRunning = this.automaton.isRunning;
        const playIcon = document.getElementById('playIcon');
        const playBtn = document.getElementById('playBtn');
        const stepBtn = document.getElementById('stepBtn');

        if (playIcon) playIcon.className = isRunning ? 'fas fa-pause' : 'fas fa-play';

        const playText = playBtn?.querySelector('span');
        if (playText) playText.textContent = t(isRunning ? 'controls.pause' : 'controls.play');

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

        // Detener si está corriendo
        if (this.automaton.isRunning) {
            this.automaton.stop();
            this.automaton.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
            this._syncPlayButtonState();
        }

        if (selector.value === 'custom') {
            customRuleGroup.style.display = 'block';
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
                this.updateRuleInfo(window.RULES.custom);

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
        this.updateHeaderInfo();
    }

    changeNeighborhoodRadius(radius) {
        this.automaton.setNeighborhoodRadius(radius);
        this.updateHeaderInfo();
        const radiusValue = document.getElementById('radiusValue');
        if (radiusValue) radiusValue.textContent = radius;
    }

    updateHeaderInfo() {
        console.debug('🔄 updateHeaderInfo() ejecutándose...');

        // === MODO RD-2D ===
        if (this.automaton.specialMode === 'rd2d' && this.automaton.rd2dEngine?.isActive) {
            const info = this.automaton.rd2dEngine.getInfo();

            const headerTitle = document.querySelector('h1');
            if (headerTitle) {
                headerTitle.innerHTML = `<i class="fas fa-border-style"></i> ${t('header.title', {ruleName: 'RD-2D'})}`;
            }
            document.title = t('app.title.rd2d');

            const rulesSpecific = document.getElementById('rulesSpecific');
            if (rulesSpecific) {
                rulesSpecific.innerHTML = `
                <p><span class="rd2d-states"><i class="fas fa-cube"></i> ${t('rd2d.states.label')}:</span> 16 [N,S,E,W]</p>
                <p><span class="rd2d-rule"><i class="fas fa-project-diagram"></i> ${t('rd2d.rule.label')}:</span> XOR(${t('rd2d.neighbors')})</p>
                <p><span class="rd2d-gen"><i class="fas fa-clock"></i> ${t('stats.generation')}:</span> ${info.generation}</p>
                <p><span class="rd2d-alive"><i class="fas fa-fire"></i> ${t('rd2d.alive')}:</span> ${info.aliveCells}</p>
            `;
            }

            const neighborhoodText = document.getElementById('neighborhoodText');
            if (neighborhoodText) {
                neighborhoodText.textContent = t('rd2d.neighborhood');
            }
            this.updateNeighborhoodInfo();
            return;
        }

        // === MODO WOLFRAM ===
        if (this.automaton.specialMode === 'wolfram' && this.automaton.wolframEngine?.isActive) {
            const info = this.automaton.wolframEngine.getInfo();
            const directionSymbol = info.direction === 'vertical' ? '↓' : '→';
            const directionText = info.direction === 'vertical' ? t('wolfram.vertical.short') : t('wolfram.horizontal.short');

            // Actualizar título principal
            const headerTitle = document.querySelector('h1');
            if (headerTitle) {
                headerTitle.innerHTML = `<i class="fas fa-dice"></i> ${t('header.title', {ruleName: `Wolfram R${info.rule}`})}`;
            }

            document.title = t('app.title.wolfram', {rule: info.rule});

            // Actualizar reglas específicas
            const rulesSpecific = document.getElementById('rulesSpecific');
            if (rulesSpecific) {
                const binary = (info.rule).toString(2).padStart(8, '0');
                rulesSpecific.innerHTML = `
                <p><span class="wolfram-rule"><i class="fas fa-hashtag"></i> ${t('config.rule')}</span> ${info.rule}</p>
                <p><span class="wolfram-binary"><i class="fas fa-binary"></i> ${t('wolfram.binary')}</span> ${binary}</p>
                <p><span class="wolfram-direction"><i class="fas fa-arrows-alt-${info.direction === 'vertical' ? 'v' : 'h'}"></i> ${t('wolfram.direction')}:</span> ${directionText} ${directionSymbol}</p>
                <p><span class="wolfram-gen"><i class="fas fa-clock"></i> ${t('stats.generation')}:</span> ${info.generation}</p>
                <p class="notation">${t('wolfram.progress')} <span class="highlight">${info.progress}/${info.max}</span></p>
            `;
            }

            // Actualizar info de vecindad
            const neighborhoodText = document.getElementById('neighborhoodText');
            if (neighborhoodText) {
                neighborhoodText.textContent = t('wolfram.neighborhood');
            }
            this.updateNeighborhoodInfo();
            return;
        }

        // === MODO 2D ESTÁNDAR ===
        const selector = document.getElementById('ruleSelector');
        if (!selector) {
            console.warn('Selector de reglas no encontrado');
            return;
        }

        const ruleKey = selector.value;
        if (window.RULES?.[ruleKey]) {
            this.updateRuleInfo(window.RULES[ruleKey]);
            console.debug('✅ Header de regla actualizado:', window.RULES[ruleKey].name);
        }

        this.updateNeighborhoodInfo();
        console.debug('✅ Header de vecindad actualizado');
    }

    updateRuleInfo(rule) {
        const rulesSpecific = document.getElementById('rulesSpecific');
        if (!rulesSpecific) return;

        rulesSpecific.innerHTML = `
        <p><span class="birth"><i class="fas fa-seedling"></i> ${t('header.rules.birth')}</span> ${rule.birth.join(', ')} ${t('header.rules.neighbors')}</p>
        <p><span class="survival"><i class="fas fa-heart"></i> ${t('header.rules.survival')}</span> ${rule.survival.join(', ')} ${t('header.rules.neighbors')}</p>
        <p class="notation">${t('header.rules.notation')} <span class="highlight">${rule.ruleString}</span></p>
    `;

        document.title = `${t('app.title')} - ${rule.name} ${rule.ruleString}`;

        const headerTitle = document.querySelector('h1');
        if (headerTitle) {
            headerTitle.innerHTML = `<i class="fas fa-cogs"></i> ${t('header.title', {ruleName: rule.name})}`;
        }

        const neighborhoodText = document.getElementById('neighborhoodText');
        if (neighborhoodText) {
            const type = this.automaton.neighborhoodType === 'moore' ? 'Moore' : 'Neumann';
            const radius = this.automaton.neighborhoodRadius;
            const wrap = this.automaton.wrapEdges ? '∞' : '▏▕';
            neighborhoodText.textContent = t('header.neighborhood', {type, radius, wrap});
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

        if (this.automaton.specialMode === 'wolfram' && this.automaton.wolframEngine?.isActive) {
            infoElement.innerHTML = `<i class="fas fa-dice"></i> ${t('wolfram.neighborhood')}`;
        } else if (this.automaton.specialMode === 'rd2d' && this.automaton.rd2dEngine?.isActive) {
            infoElement.innerHTML = `<i class="fas fa-border-style"></i> ${t('rd2d.neighborhood')}`;
        } else {
            const type = this.automaton.neighborhoodType === 'moore' ? 'Moore' : 'Neumann';
            const radius = this.automaton.neighborhoodRadius;
            const wrap = this.automaton.wrapEdges ? '∞' : '▏▕'; // Símbolos visuales

            infoElement.innerHTML = `<i class="fas fa-crosshairs"></i> ${t('header.neighborhood', {
                type,
                radius,
                wrap
            })}`;
        }
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
        // Escuchar eventos DEL EVENTBUS
        this._cleanups.push(
            eventBus.on('pattern:selected', () => {
                console.debug('UIController: Evento pattern:selected recibido');
                this.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:updated', () => {
                console.debug('UIController: Evento pattern:updated recibido');
                this.updateDrawModeIndicator();
            }),
            eventBus.on('pattern:cleared', () => {
                console.debug('UIController: Evento pattern:cleared recibido');
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
        if (miniEl) miniEl.textContent = t('patterns.select');

        hidePatternPreview();
        hideInfluenceArea();
        this.updateDrawModeIndicator();
    }

    updateDrawModeIndicator() {
        const indicator = document.getElementById('drawModeIndicator');
        if (!indicator) return;

        if (window.selectedPattern) {
            indicator.className = 'pattern-mode-indicator pattern-selected';
            indicator.textContent = t('mode.pattern', {name: window.selectedPattern.name});
        } else {
            indicator.className = 'pattern-mode-indicator free-draw';
            indicator.textContent = t('mode.freeDraw');
        }
    }

    updateMouseCoords(x, y) {
        const coords = document.getElementById('mouseCoords');
        if (coords) coords.textContent = t('header.coords', {x, y});
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

        console.debug(`📊 Stats actualizadas: G${stats.generation} P${stats.population}`);
    }
}