/**
 * SpecialModeController — Coordinador de los modos especiales del autómata.
 *
 * Responsabilidad: coordinar la activación/desactivación de modos (Wolfram,
 * RD-2D, Triangular, Langton, WireWorld, UW, Generations), leyendo la
 * configuración del DOM y orquestando engines y capa de presentación.
 *
 * La presentación pura (indicadores, paneles, selectores) vive en SpecialModeUI.
 * El acoplamiento a UIController se elimina mediante callbacks inyectados.
 */
class SpecialModeController {
    /**
     * @param {Object}   options
     * @param {CellularAutomaton} options.automaton
     * @param {Function} options.onUpdateHeader          — () => void
     * @param {Function} options.onSyncPlayButton        — () => void
     * @param {Function} options.onShowNotification      — (msg, type, duration) => void
     * @param {Function} [options.onSyncActivityColors]  — (generationsActive: boolean) => void
     * @param {Function} [options.onToggleActivityEffect]— (enabled: boolean) => void
     */
    constructor({
                    automaton,
                    onUpdateHeader,
                    onSyncPlayButton,
                    onShowNotification,
                    onSyncActivityColors = () => {
                    },
                    onToggleActivityEffect = () => {
                    }
                }) {
        this.automaton = automaton;
        this._onUpdateHeader = onUpdateHeader;
        this._onSyncPlayButton = onSyncPlayButton;
        this._onShowNotification = onShowNotification;
        this._onSyncActivityColors = onSyncActivityColors;
        this._onToggleActivityEffect = onToggleActivityEffect;

        // Capa de presentación pura — operaciones DOM sin conocimiento de engines
        this._ui = new SpecialModeUI(automaton);

        this._cleanups = [];
    }

    bindEvents() {
        // Toggle Modo Estándar — desactiva todos los modos especiales
        const standardToggle = document.getElementById('standardToggle');
        if (standardToggle) {
            this._addEventListener(standardToggle, 'change', () => {
                if (standardToggle.checked) {
                    this._returnToStandard();
                } else {
                    // Desmarcar sin acción: el usuario debe activar un modo especial
                    standardToggle.checked = true;
                }
            });
        }

        // Toggle RD-2D
        const rd2dToggle = document.getElementById('rd2dToggle');
        if (rd2dToggle) {
            this._addEventListener(rd2dToggle, 'change', () => {
                if (this._suppressToggleEvents) return;
                if (rd2dToggle.checked) {
                    this.activateRD2DMode();
                } else {
                    this.deactivateRD2DMode();
                }
            });
        }

        // Toggle Wolfram
        const wolframToggle = document.getElementById('wolframToggle');
        if (wolframToggle) {
            this._addEventListener(wolframToggle, 'change', () => {
                if (this._suppressToggleEvents) return;
                if (wolframToggle.checked) {
                    const rule = parseInt(document.getElementById('wolframRule')?.value) || 30;
                    const direction = document.getElementById('wolframDirection')?.value || 'vertical';
                    this.activateWolframMode(rule, direction);
                } else {
                    this.deactivateWolframMode();
                }
            });
        }

        // Toggle Triangular
        const triangleToggle = document.getElementById('triangleToggle');
        if (triangleToggle) {
            this._addEventListener(triangleToggle, 'change', () => {
                if (this._suppressToggleEvents) return;
                if (triangleToggle.checked) {
                    const rule = parseInt(document.getElementById('triangleRule')?.value) || 50;
                    this.activateTriangleMode(rule);
                } else {
                    this.deactivateTriangleMode();
                }
            });
        }

        // Toggle Hexagonal
        const hexToggle = document.getElementById('hexToggle');
        if (hexToggle) {
            this._addEventListener(hexToggle, 'change', () => {
                if (this._suppressToggleEvents) return;
                if (hexToggle.checked) {
                    this.activateHexMode();
                } else {
                    this.deactivateHexMode();
                }
            });
        }

        // Presets Hexagonal
        document.querySelectorAll('.btn-preset[data-hex-birth][data-hex-survival]').forEach(btn => {
            this._addEventListener(btn, 'click', () => {
                const birth = btn.dataset.hexBirth.split('').map(Number);
                const survival = btn.dataset.hexSurvival.split('').map(Number);

                // Sincronizar los campos manuales del sidebar con el preset seleccionado
                const birthInput = document.getElementById('hexBirth');
                const survivalInput = document.getElementById('hexSurvival');
                if (birthInput) birthInput.value = btn.dataset.hexBirth;
                if (survivalInput) survivalInput.value = btn.dataset.hexSurvival;

                if (this.automaton.hexEngine?.isActive) {
                    this.automaton.hexEngine.setRule(birth, survival);
                    this._ui.updateModeIndicator(SpecialEngineManager.MODES.HEXAGONAL);
                    this._onUpdateHeader();
                }
            });
        });

        // Toggle Langton
        const langtonToggle = document.getElementById('langtonToggle');
        if (langtonToggle) {
            this._addEventListener(langtonToggle, 'change', () => {
                if (this._suppressToggleEvents) return;
                if (langtonToggle.checked) {
                    const rule = document.getElementById('langtonRule')?.value || 'RL';
                    const antCount = parseInt(document.getElementById('langtonAntCount')?.value) || 0;
                    this.activateLangtonMode(rule, antCount);
                } else {
                    this.deactivateLangtonMode();
                }
            });
        }

        // Toggle WireWorld
        const wireworldToggle = document.getElementById('wireworldToggle');
        if (wireworldToggle) {
            this._addEventListener(wireworldToggle, 'change', () => {
                if (this._suppressToggleEvents) return;
                if (wireworldToggle.checked) {
                    this.activateWireworldMode();
                } else {
                    this.deactivateWireworldMode();
                }
            });
        }

        // Slider de estados: C=2 → modo estándar, C>2 → Generations automático
        const generationsStates = document.getElementById('generationsStates');
        if (generationsStates) {
            this._addEventListener(generationsStates, 'input', () => {
                const v = parseInt(generationsStates.value);
                const display = document.getElementById('generationsStatesDisplay');
                if (display) display.textContent = v;
                if (v > 2) {
                    // Marcar "Personalizada" en el selector sin disparar changeRule
                    const sel = document.getElementById('ruleSelector');
                    if (sel && sel.value !== 'custom') sel.value = 'custom';
                    this._activateGenerationsFromUI();
                } else if (this.automaton.specialMode === SpecialEngineManager.MODES.GENERATIONS) {
                    this.deactivateGenerationsMode();
                }
            });
        }
        const langtonRuleInput = document.getElementById('langtonRule');
        if (langtonRuleInput) {
            this._addEventListener(langtonRuleInput, 'change', () => {
                if (this.automaton.langtonEngine?.isActive) {
                    const rule = langtonRuleInput.value.toUpperCase().replace(/[^LRNU]/g, '') || 'RL';
                    langtonRuleInput.value = rule;
                    this._reactivateLangton(rule);
                }
            });
        }

        // Presets Langton
        document.querySelectorAll('.btn-langton-preset[data-rule]').forEach(btn => {
            this._addEventListener(btn, 'click', () => {
                const rule = btn.dataset.rule;
                const input = document.getElementById('langtonRule');
                if (input) input.value = rule;

                if (this.automaton.langtonEngine?.isActive) {
                    this._reactivateLangton(rule);
                }
            });
        });

        // Número de hormigas
        const langtonAntCount = document.getElementById('langtonAntCount');
        if (langtonAntCount) {
            this._addEventListener(langtonAntCount, 'change', () => {
                if (this.automaton.langtonEngine?.isActive) {
                    const rule = document.getElementById('langtonRule')?.value || 'RL';
                    const antCount = parseInt(langtonAntCount.value) || 0;
                    this._reactivateLangton(rule, antCount);
                }
            });
        }

        // Toggle Ulam-Warburton
        const uwToggle = document.getElementById('uwToggle');
        if (uwToggle) {
            this._addEventListener(uwToggle, 'change', () => {
                if (this._suppressToggleEvents) return;
                if (uwToggle.checked) {
                    this.activateUWMode();
                } else {
                    this.deactivateUWMode();
                }
            });
        }

        const destroboscopeToggle = document.getElementById('destroboscopeToggle');
        if (destroboscopeToggle) {
            this._addEventListener(destroboscopeToggle, 'change', () => {
                if (this.automaton.triangleEngine?.isActive) {
                    this.automaton.triangleEngine.destroboscope = destroboscopeToggle.checked;
                    this._ui.updateTwinRuleInfo();
                }
            });
        }

        // Reset semilla Wolfram
        const resetSeedBtn = document.getElementById('resetWolframSeed');
        if (resetSeedBtn) {
            this._addEventListener(resetSeedBtn, 'click', () => {
                if (this.automaton.wolframEngine?.isActive) {
                    this.automaton.wolframEngine.forceInitializeSeed();
                    this.automaton.render();
                    this._onShowNotification(t('wolfram.resetSeed'), 'info', 1500);
                }
            });
        }

        // Regla Wolfram (slider)
        const wolframRuleInput = document.getElementById('wolframRule');
        if (wolframRuleInput) {
            this._addEventListener(wolframRuleInput, 'input', () => {
                const rule = parseInt(String(wolframRuleInput.value), 10) || 30;
                const display = document.getElementById('wolframRuleDisplay');
                if (display) display.textContent = String(rule);

                if (this.automaton.wolframEngine?.isActive) {
                    this._reactivateWolfram(rule);
                }
            });
        }

        // Dirección Wolfram
        const directionSelect = document.getElementById('wolframDirection');
        if (directionSelect) {
            this._addEventListener(directionSelect, 'change', () => {
                if (this.automaton.wolframEngine?.isActive) {
                    const rule = this.automaton.wolframEngine.ruleNumber;
                    this.automaton.wolframEngine.activate(rule, directionSelect.value);
                    this.automaton.clear();
                    this.automaton.wolframEngine._initializeSeed?.();
                    this.automaton.render();
                }
            });
        }

        // Presets Wolfram
        document.querySelectorAll('.btn-preset[data-rule]').forEach(btn => {
            this._addEventListener(btn, 'click', () => {
                const rule = parseInt(btn.dataset.rule);
                const input = document.getElementById('wolframRule');
                const display = document.getElementById('wolframRuleDisplay');
                if (input) input.value = rule;
                if (display) display.textContent = rule.toString();

                if (this.automaton.wolframEngine?.isActive) {
                    this._reactivateWolfram(rule, {resetSeed: true});
                    this._onShowNotification(t('notif.rule.enabled', {rule}), 'info', 1500);
                }
            });
        });

        // Regla triangular (slider)
        const triangleRuleInput = document.getElementById('triangleRule');
        if (triangleRuleInput) {
            this._addEventListener(triangleRuleInput, 'input', () => {
                const rule = parseInt(String(triangleRuleInput.value), 10) || 50;
                const display = document.getElementById('triangleRuleDisplay');
                if (display) display.textContent = String(rule);

                if (this.automaton.triangleEngine?.isActive) {
                    this._reactivateTriangle(rule);
                }
            });
        }

        // Presets triangulares
        document.querySelectorAll('.btn-preset[data-triangle-rule]').forEach(btn => {
            this._addEventListener(btn, 'click', () => {
                const rule = parseInt(btn.dataset.triangleRule);
                const input = document.getElementById('triangleRule');
                const display = document.getElementById('triangleRuleDisplay');
                if (input) input.value = rule;
                if (display) display.textContent = rule.toString();

                if (this.automaton.triangleEngine?.isActive) {
                    this._reactivateTriangle(rule, {reset: true});
                    this._onShowNotification(t('notif.rule.enabled', {rule}), 'info', 1500);
                }
            });
        });
    }

    // =========================================
    // ACTIVACIÓN / DESACTIVACIÓN
    // =========================================

    async activateWolframMode(rule = 30, direction = 'vertical') {
        if (!this.automaton?.grid) {
            this._onShowNotification(t('notif.automata.error'), 'warning', 3000);
            return;
        }
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.WOLFRAM);

            this._ui.toggleWolframControls(true);
            this._ui.setModeSelectors(true);

            this.automaton.wolframEngine.activate(rule, direction);
            this._finalizeActivation(SpecialEngineManager.MODES.WOLFRAM, t('notif.wolfram.enabled', {rule}));
        } catch (error) {
            console.error('Error cargando WolframEngine:', error);
            this._onShowNotification(t('notif.wolfram.error'), 'warning', 3000);
        }
    }

    deactivateWolframMode() {
        this._returnToStandard();
    }

    async activateRD2DMode() {
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.RD2D);

            this._ui.toggleRD2DControls(true);
            this._ui.setModeSelectors(true, 'neumann');

            this.automaton.rd2dEngine.activate();
            this._finalizeActivation(SpecialEngineManager.MODES.RD2D, t('notif.rd2d.enabled'));
        } catch (error) {
            console.error('Error cargando RD2DEngine:', error);
            this._onShowNotification(t('notif.rd2d.error'), 'warning', 3000);
        }
    }

    deactivateRD2DMode() {
        this._returnToStandard();
    }

    async activateTriangleMode(rule = 50) {
        if (!this.automaton?.grid) {
            this._onShowNotification(t('notif.automata.error'), 'warning', 3000);
            return;
        }
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.TRIANGLE);

            // Limpiar el grid completo con las dimensiones reales (rectangular).
            // gridSize = max(w,h) dejaría filas/columnas sin limpiar en grids no cuadrados.
            const gw = this.automaton.gridWidth;
            const gh = this.automaton.gridHeight;
            for (let x = 0; x < gw; x++) {
                for (let y = 0; y < gh; y++) {
                    this.automaton.grid[x][y] = 0;
                }
            }

            this._ui.toggleTriangleControls(true);
            this._ui.setModeSelectors(true);

            const wrapToggle = document.getElementById('wrapToggle');
            const wrap = wrapToggle ? wrapToggle.checked : true;

            this.automaton.triangleEngine.activate({rule, wrap});

            if (this.automaton.triangleEngine.gridManager) {
                this.automaton._setRendererGridManager(this.automaton.triangleEngine.gridManager);
            }

            this.automaton.triangleEngine._initializeFromAutomaton();
            this.automaton.triangleEngine.initialized = true;

            const destroboscopeToggle = document.getElementById('destroboscopeToggle');
            if (destroboscopeToggle) {
                this.automaton.triangleEngine.destroboscope = destroboscopeToggle.checked;
            }
            this._ui.updateTwinRuleInfo();

            this.automaton._markAllDirty();
            this._finalizeActivation(SpecialEngineManager.MODES.TRIANGLE, t('notif.triangle.enabled', {rule}), true);
        } catch (error) {
            console.error('Error cargando TriangleEngine:', error);
            this._onShowNotification(t('notif.triangle.error'), 'warning', 3000);
            this.deactivateTriangleMode();
        }
    }

    deactivateTriangleMode() {
        this.automaton.specialMode = null;
        this.automaton.generation = 0;

        // Limpiar el grid completo con las dimensiones reales (rectangular).
        const gw = this.automaton.gridWidth;
        const gh = this.automaton.gridHeight;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                this.automaton.grid[x][y] = 0;
            }
        }

        this.automaton._markAllDirty();
        this._returnToStandard();
    }

    // =========================================
    // CONTROLES VISUALES DE MODO
    // =========================================

    async activateLangtonMode(rule = 'RL', antCount = 0) {
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.LANGTON);

            this._ui.toggleLangtonControls(true);
            this._ui.setModeSelectors(true);

            this.automaton.langtonEngine.activate({rule, antCount});
            this._finalizeActivation(SpecialEngineManager.MODES.LANGTON, t('notif.langton.enabled'));
            eventBus.emit('automaton:modeChanged', {mode: SpecialEngineManager.MODES.LANGTON});
        } catch (error) {
            console.error('Error cargando LangtonEngine:', error);
            this._onShowNotification(t('notif.langton.error'), 'warning', 3000);
        }
    }

    deactivateLangtonMode() {
        this._returnToStandard();
        eventBus.emit('automaton:modeChanged', {mode: SpecialEngineManager.MODES.STANDARD});
    }

    async activateWireworldMode() {
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.WIREWORLD);

            this._ui.toggleWireworldControls(true);
            this._ui.setModeSelectors(true, 'moore');

            this.automaton.wireworldEngine.activate();
            this._finalizeActivation(SpecialEngineManager.MODES.WIREWORLD, t('notif.wireworld.enabled'));
            eventBus.emit('automaton:modeChanged', {mode: SpecialEngineManager.MODES.WIREWORLD});
        } catch (error) {
            console.error('Error cargando WireWorldEngine:', error);
            this._onShowNotification(t('notif.wireworld.error'), 'warning', 3000);
        }
    }

    deactivateWireworldMode() {
        this._returnToStandard();
        eventBus.emit('automaton:modeChanged', {mode: SpecialEngineManager.MODES.STANDARD});
    }

    /**
     * Lee B, S y C del DOM y activa el motor de Generaciones.
     * Llamado tanto desde el slider (C>2) como desde applyCustomRule.
     * @private
     */
    _activateGenerationsFromUI() {
        const birthVal = document.getElementById('birthInput')?.value || '3';
        const survivalVal = document.getElementById('survivalInput')?.value || '23';
        const numStates = parseInt(document.getElementById('generationsStates')?.value) || 3;
        try {
            const parsed = parseCustomRule(birthVal, survivalVal);
            this.activateGenerationsMode(parsed.birth, parsed.survival, numStates);
        } catch (e) {
            this._onShowNotification(`Error en regla: ${e.message}`, 'warning', 3000);
        }
        this._onToggleActivityEffect(false);
    }

    async activateGenerationsMode(birth, survival, numStates) {
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.GENERATIONS);

            // En Generations el ruleSelector permanece habilitado: permite cambiar
            // la regla B/S base seleccionando una predefinida del dropdown.
            this._ui.setModeSelectors(true);
            document.getElementById('ruleSelector').disabled = false;

            this.automaton.generationsEngine.activate({birth, survival, numStates});
            this._finalizeActivation(
                SpecialEngineManager.MODES.GENERATIONS,
                t('notif.generations.enabled', {rule: `B${birth.join('')}/S${survival.join('')}/C${numStates}`})
            );
            // Mostrar siempre el bloque de colores (independiente del toggle de actividad)
            // y conmutar sus swatches al modo Generations
            const colorsBlock = document.getElementById('activityColors');
            if (colorsBlock) colorsBlock.style.display = '';
            this._onSyncActivityColors(true);
        } catch (error) {
            console.error('Error cargando GenerationsEngine:', error);
            this._onShowNotification(t('notif.generations.error'), 'warning', 3000);
        }
    }

    deactivateGenerationsMode() {
        this._returnToStandard();
        // Restaurar swatches binarios y respetar estado del toggle de actividad
        this._onSyncActivityColors(false);
        this._onToggleActivityEffect(true)
    }

    async activateUWMode() {
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.ULAM_WARBURTON);

            this._ui.setModeSelectors(true, 'neumann');

            this.automaton.uwEngine.activate();
            this._finalizeActivation(SpecialEngineManager.MODES.ULAM_WARBURTON, t('notif.uw.enabled'));
        } catch (error) {
            console.error('Error cargando UlamWarburtonEngine:', error);
            this._onShowNotification(t('notif.uw.error'), 'warning', 3000);
        }
    }

    deactivateUWMode() {
        this._returnToStandard();
    }

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Prepara el motor: detiene la simulación, desactiva el resto de modos
     * e inicializa el engine indicado. Patrón común al inicio de todo activateXMode().
     * @param {string} mode — SpecialEngineManager.MODES.X
     */
    async _prepareEngine(mode) {
        this._stopIfRunning();
        this._deactivateAllModes(mode);
        await this.automaton._initSpecialEngine(mode);
    }

    /**
     * Finaliza la activación de un modo: render, header, indicador, notificación y play.
     * Patrón común al final de todo activateXMode().
     * @param {string} mode       — SpecialEngineManager.MODES.X
     * @param {string} successMsg — texto de notificación de éxito
     * @param {boolean} skipResize — true para modos con renderer propio (Triangle)
     *   que no usan resizeCanvas/reGrid sino markAllDirty
     */
    _finalizeActivation(mode, successMsg, skipResize = false) {
        if (!skipResize) {
            this.automaton._resetRendererCanvas();
            this.automaton._reGrid();
        }
        this.automaton.render();
        this._onUpdateHeader();
        this._ui.updateModeIndicator(mode);
        this._onShowNotification(successMsg, 'info', 2000);
        this._onSyncPlayButton();
    }

    /**
     * Desactiva todos los modos especiales y regresa al modo estándar.
     * Centraliza el patrón común de los métodos deactivateXMode().
     */
    _returnToStandard() {
        this._stopIfRunning();
        this._deactivateAllModes(SpecialEngineManager.MODES.STANDARD);

        // Limpiar el modo especial DESPUÉS de desactivar todos los engines
        this.automaton.specialMode = null;

        this.automaton._reGrid();
        this.automaton.render();

        // Determinar si debemos mostrar Standard o Generations basado en el slider de estados
        const numStates = parseInt(document.getElementById('generationsStates')?.value) || 2;
        const isEffectivelyGenerations = numStates > 2;

        if (isEffectivelyGenerations) {
            // Reactivar Generations con los valores actuales del DOM
            const birthVal = document.getElementById('birthInput')?.value || '3';
            const survivalVal = document.getElementById('survivalInput')?.value || '23';
            try {
                const parsed = parseCustomRule(birthVal, survivalVal);
                this._prepareEngine(SpecialEngineManager.MODES.GENERATIONS);
                this.automaton.generationsEngine.activate({
                    birth: parsed.birth,
                    survival: parsed.survival,
                    numStates
                });
                this._ui.updateModeIndicator(SpecialEngineManager.MODES.GENERATIONS);

                // Notificación de Generations (no Standard)
                const ruleString = `B${parsed.birth.join('')}/S${parsed.survival.join('')}/C${numStates}`;
                this._onShowNotification(
                    t('notif.generations.enabled', {rule: ruleString}),
                    'info',
                    2000
                );
            } catch (e) {
                // Si falla el parseo, caer a Standard normal
                this._ui.updateModeIndicator(SpecialEngineManager.MODES.STANDARD);
                this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
            }
        } else {
            // Standard puro
            this._ui.updateModeIndicator(SpecialEngineManager.MODES.STANDARD);
            this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        }

        this._onUpdateHeader();
        this._onSyncPlayButton();
    }

    /**
     * Desactiva todos los modos especiales excepto el indicado.
     * Llamada al inicio de cada activateXMode() y deactivateXMode().
     * Cuando exceptMode === 'standard' desactiva absolutamente todos.
     *
     * Responsabilidades:
     *  - Desmarcar toggle de cada modo
     *  - Ocultar su panel de controles
     *  - Deactivate del engine
     *  - Restaurar ruleSelector y neighborhoodType al estado neutro
     */
    _deactivateAllModes(exceptMode) {
        const modes = [
            {
                name: SpecialEngineManager.MODES.WOLFRAM,
                toggleId: 'wolframToggle',
                hideControls: () => this._ui.toggleWolframControls(false),
                deactivate: () => this.automaton.wolframEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.RD2D,
                toggleId: 'rd2dToggle',
                hideControls: () => this._ui.toggleRD2DControls(false),
                deactivate: () => this.automaton.rd2dEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.TRIANGLE,
                toggleId: 'triangleToggle',
                hideControls: () => this._ui.toggleTriangleControls(false),
                deactivate: () => this._deactivateTriangleEngine()
            },
            {
                name: SpecialEngineManager.MODES.HEXAGONAL,
                toggleId: 'hexToggle',
                hideControls: () => this._ui.toggleHexControls(false),
                deactivate: () => this._deactivateHexEngine()
            },
            {
                name: SpecialEngineManager.MODES.ULAM_WARBURTON,
                toggleId: 'uwToggle',
                hideControls: () => {
                },  // sin panel propio
                deactivate: () => this.automaton.uwEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.LANGTON,
                toggleId: 'langtonToggle',
                hideControls: () => this._ui.toggleLangtonControls(false),
                deactivate: () => this.automaton.langtonEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.WIREWORLD,
                toggleId: 'wireworldToggle',
                hideControls: () => this._ui.toggleWireworldControls(false),
                deactivate: () => this.automaton.wireworldEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.GENERATIONS,
                toggleId: null,   // sin toggle en el DOM
                hideControls: () => {
                },
                deactivate: () => this.automaton.generationsEngine?.deactivate()
            }
        ];

        // Suprimir eventos change durante el desmarcado programático para evitar
        // que los listeners de toggle disparen deactivateXMode() en cascada.
        this._suppressToggleEvents = true;
        for (const mode of modes) {
            if (mode.name === exceptMode) continue;

            // NO desactivar el toggle de Standard si vamos a Generations
            // (ambos son "Standard-like" y comparten el mismo toggle visual)
            const isStandardLike = exceptMode === SpecialEngineManager.MODES.GENERATIONS ||
                exceptMode === SpecialEngineManager.MODES.STANDARD;
            const isCurrentStandardLike = mode.name === SpecialEngineManager.MODES.GENERATIONS ||
                mode.name === SpecialEngineManager.MODES.STANDARD;

            if (isStandardLike && isCurrentStandardLike) continue;

            const toggle = document.getElementById(mode.toggleId);
            if (toggle) toggle.checked = false;
            mode.hideControls();
            mode.deactivate();
        }
        this._suppressToggleEvents = false;

        // Restaurar selectores compartidos al estado neutro.
        // El modo entrante los reconfigurará según sus necesidades.
        this._ui.setModeSelectors(false, 'moore');
    }

    /**
     * Limpia el engine triangular y restaura el renderer/core estándar.
     * Extraído para evitar duplicación entre _deactivateAllModes y deactivateTriangleMode.
     */
    /**
     * Limpia el engine triangular y restaura el renderer/core estándar.
     * Delegado a SpecialEngineManager.deactivateTriangle() para centralizar
     * la lógica de desactivación lejos del controlador UI.
     */
    _deactivateTriangleEngine() {
        this.automaton._engineManager.deactivateTriangle();
    }

    _deactivateHexEngine() {
        this.automaton._engineManager.deactivateHex();
    }

    // ─── Modo Hexagonal ───────────────────────────────────────────────────

    /**
     * Activa el modo hexagonal con la regla B/S leída del DOM.
     */
    async activateHexMode() {
        if (!this.automaton?.grid) {
            this._onShowNotification(t('notif.automata.error'), 'warning', 3000);
            return;
        }
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.HEXAGONAL);

            this._ui.toggleHexControls(true);
            this._ui.setModeSelectors(true);

            const birth = this._readHexBirth();
            const survival = this._readHexSurvival();
            const wrap = document.getElementById('wrapToggle')?.checked ?? true;
            const cs = this.automaton.cellSize;   // ya fue ajustado por special-engine-manager
            const SQRT3 = Math.sqrt(3);

            // Medir área disponible para calcular dimensiones del grid hex
            const wrapper = document.querySelector('.canvas-wrapper');
            const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : null;
            const availW = wrapperRect ? Math.floor(wrapperRect.width - 20) : 400;
            const availH = wrapperRect ? Math.floor(wrapperRect.height - 20) : 400;
            const hexCols = Math.max(10, Math.min(2000,
                Math.floor((availW - cs * SQRT3 / 2) / (cs * SQRT3))
            ));
            const hexRows = Math.max(10, Math.min(2000,
                Math.floor((availH - cs * 0.5) / (cs * 1.5))
            ));

            // 1. Activar el engine: crea un HexGridManager del tamaño del grid rectangular actual
            this.automaton.hexEngine.activate({birth, survival, wrap});

            // 2. Redimensionar el gridManager propio del engine al tamaño hex calculado.
            //    Evita llamar automaton.resizeGrid() que: a) dispara renderer.resize(gw,gh,cs)
            //    con la firma incorrecta, b) emite eventos de resize que interfieren, y
            //    c) no tiene sentido porque el grid rectangular y el hex son estructuras separadas.
            this.automaton.hexEngine.gridManager.resize(hexCols, hexRows);
            this.automaton.hexEngine._newGrid = Array.from(
                {length: hexCols}, () => new Uint8Array(hexRows)
            );

            // 3. Inicializar desde el estado actual del grid rectangular (copia lo que cabe)
            this.automaton.hexEngine._initializeFromAutomaton();
            this.automaton.hexEngine.initialized = true;

            // 4. Conectar HexRenderer con el HexGridManager del engine.
            //    setGridManager() llama _resizeCanvas() → dimensiona el canvas exacto,
            //    después rellena el fondo y fuerza _isFirstRender = true.
            const hexRenderer = this.automaton._engineManager._getRenderer();
            hexRenderer.setGridManager(this.automaton.hexEngine.gridManager);

            // Resetear contadores de generación tanto del engine como del autómata
            this.automaton.hexEngine.generation = 0;
            this.automaton.generation = 0;

            const ruleStr = `B${birth.join('')}/S${survival.join('')}`;
            this._finalizeActivation(
                SpecialEngineManager.MODES.HEXAGONAL,
                t('notif.hex.enabled', {rule: ruleStr}),
                true   // skipResize — renderer propio
            );
        } catch (error) {
            console.error('Error cargando HexEngine:', error);
            this._onShowNotification(t('notif.hex.error'), 'warning', 3000);
            this.deactivateHexMode();
        }
    }

    deactivateHexMode() {
        this.automaton.specialMode = null;
        this.automaton.generation = 0;
        const gw = this.automaton.gridWidth;
        const gh = this.automaton.gridHeight;
        for (let x = 0; x < gw; x++)
            for (let y = 0; y < gh; y++)
                this.automaton.grid[x][y] = 0;
        this.automaton._markAllDirty();
        this._returnToStandard();
    }

    /** Lee los valores de birth del DOM hexagonal */
    _readHexBirth() {
        const val = document.getElementById('hexBirth')?.value ?? '2';
        return [...new Set(val.split('').map(Number).filter(n => n >= 0 && n <= 6))].sort((a, b) => a - b);
    }

    /** Lee los valores de survival del DOM hexagonal */
    _readHexSurvival() {
        const val = document.getElementById('hexSurvival')?.value ?? '34';
        return [...new Set(val.split('').map(Number).filter(n => n >= 0 && n <= 6))].sort((a, b) => a - b);
    }

    /**
     * Reactiva el engine de Langton con la regla/hormigas actuales.
     * Patrón común al input de regla, presets y contador de hormigas.
     * @param {string} rule
     * @param {number} [antCount] — si se omite lee el valor del DOM
     */
    _reactivateLangton(rule, antCount = null) {
        this._stopIfRunning();
        const count = antCount ?? (parseInt(document.getElementById('langtonAntCount')?.value) || 0);
        this.automaton.langtonEngine.activate({rule, antCount: count});
        this._ui.updateModeIndicator(SpecialEngineManager.MODES.LANGTON);
        this._onUpdateHeader();
        this._onSyncPlayButton();
    }

    /**
     * Reactiva el engine Wolfram con la regla indicada.
     * @param {number}  rule
     * @param {Object}  [opts]
     * @param {boolean} [opts.resetSeed=false] — si true limpia el grid y reinicia la semilla
     */
    _reactivateWolfram(rule, {resetSeed = false} = {}) {
        this._stopIfRunning();
        const direction = this.automaton.wolframEngine.direction;
        this.automaton.wolframEngine.activate(rule, direction);
        if (resetSeed) {
            this.automaton.clear();
            this.automaton.wolframEngine._initializeSeed();
            this.automaton.render();
        }
        this._onUpdateHeader();
        this._onSyncPlayButton();
    }

    /**
     * Reactiva el engine Triangle con la regla indicada.
     * @param {number}  rule
     * @param {Object}  [opts]
     * @param {boolean} [opts.reset=false] — si true llama reset() y render() tras activate
     */
    _reactivateTriangle(rule, {reset = false} = {}) {
        this._stopIfRunning();
        const engine = this.automaton.triangleEngine;
        engine.activate({rule, wrap: engine.wrapEdges});
        if (reset) {
            engine.reset();
            this.automaton.render();
        }
        this._ui.updateTwinRuleInfo();
        this._onUpdateHeader();
        this._onSyncPlayButton();
    }

    _stopIfRunning() {
        if (this.automaton.isRunning) {
            this.automaton.stop();
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }
    }

    _addEventListener(target, event, handler) {
        target.addEventListener(event, handler);
        this._cleanups.push(() => target.removeEventListener(event, handler));
    }

    destroy() {
        this._cleanups.forEach(fn => {
            try {
                fn();
            } catch (e) {
            }
        });
        this._cleanups = [];
        this.automaton = null;
    }
}

window.SpecialModeController = SpecialModeController;