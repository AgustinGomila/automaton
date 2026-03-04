/**
 * SpecialModeController - Gestiona la UI de los motores especiales.
 *
 * Responsabilidad: activación/desactivación de modos Wolfram, RD-2D y
 * Triangular, sus controles propios y el indicador de modo.
 *
 * No conoce el canvas, la selección ni el bucle de animación.
 */
class SpecialModeController {
    /**
     * @param {Object}   options
     * @param {CellularAutomaton} options.automaton
     * @param {Function} options.onUpdateHeader     - () => void
     * @param {Function} options.onSyncPlayButton   - () => void
     * @param {Function} options.onShowNotification - (msg, type, duration) => void
     */
    constructor({automaton, onUpdateHeader, onSyncPlayButton, onShowNotification}) {
        this.automaton = automaton;
        this._onUpdateHeader = onUpdateHeader;
        this._onSyncPlayButton = onSyncPlayButton;
        this._onShowNotification = onShowNotification;

        this._cleanups = [];
    }

    bindEvents() {
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

        // Toggle Wolfram
        const wolframToggle = document.getElementById('wolframToggle');
        if (wolframToggle) {
            this._addEventListener(wolframToggle, 'change', () => {
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
                if (triangleToggle.checked) {
                    const rule = parseInt(document.getElementById('triangleRule')?.value) || 50;
                    const mode = document.getElementById('triangleMode')?.value || 'edge';
                    this.activateTriangleMode(rule, mode);
                } else {
                    this.deactivateTriangleMode();
                }
            });
        }

        // Toggle Langton
        const langtonToggle = document.getElementById('langtonToggle');
        if (langtonToggle) {
            this._addEventListener(langtonToggle, 'change', () => {
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
                if (wireworldToggle.checked) {
                    this.activateWireworldMode();
                } else {
                    this.deactivateWireworldMode();
                }
            });
        }

        // Regla Langton (input text)
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
                    this._updateTwinRuleInfo();
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

        // Modo de vecindad triangular
        const triangleModeSelect = document.getElementById('triangleMode');
        if (triangleModeSelect) {
            this._addEventListener(triangleModeSelect, 'change', () => {
                if (this.automaton.triangleEngine?.isActive) {
                    this._stopIfRunning();
                    const rule = this.automaton.triangleEngine.ruleNumber;
                    const mode = triangleModeSelect.value;
                    this.automaton.triangleEngine.activate({rule, mode});
                    this.automaton.triangleEngine.reset();
                    this.automaton.render();
                    this._onUpdateHeader();
                    this._onSyncPlayButton();
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

            this._toggleWolframControls(true);
            this._setModeSelectors(true);

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

            this._toggleRD2DControls(true);
            this._setModeSelectors(true, 'neumann');

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

            for (let x = 0; x < this.automaton.gridSize; x++) {
                for (let y = 0; y < this.automaton.gridSize; y++) {
                    this.automaton.grid[x][y] = 0;
                }
            }

            this._toggleTriangleControls(true);
            this._setModeSelectors(true);

            const wrapToggle = document.getElementById('wrapToggle');
            const wrap = wrapToggle ? wrapToggle.checked : true;

            this.automaton.triangleEngine.activate({rule, wrap});

            if (this.automaton.triangleEngine.gridManager) {
                this.automaton.renderer.setGridManager(this.automaton.triangleEngine.gridManager);
            }

            this.automaton.triangleEngine._initializeFromAutomaton();
            this.automaton.triangleEngine.initialized = true;

            const destroboscopeToggle = document.getElementById('destroboscopeToggle');
            if (destroboscopeToggle) {
                this.automaton.triangleEngine.destroboscope = destroboscopeToggle.checked;
            }
            this._updateTwinRuleInfo();

            this.automaton.renderer.markAllDirty();
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

        for (let x = 0; x < this.automaton.gridSize; x++) {
            for (let y = 0; y < this.automaton.gridSize; y++) {
                this.automaton.grid[x][y] = 0;
            }
        }

        this.automaton.renderer.markAllDirty();
        this._returnToStandard();
    }

    // =========================================
    // CONTROLES VISUALES DE MODO
    // =========================================

    async activateLangtonMode(rule = 'RL', antCount = 0) {
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.LANGTON);

            this._toggleLangtonControls(true);
            this._setModeSelectors(true);

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

            this._toggleWireworldControls(true);
            this._setModeSelectors(true, 'moore');

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

    async activateUWMode() {
        try {
            await this._prepareEngine(SpecialEngineManager.MODES.ULAM_WARBURTON);

            this._setModeSelectors(true, 'neumann');

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

    _updateModeIndicator(mode) {
        // Emitir SIEMPRE, antes del guard del DOM.
        // Modo estándar: rule=null → PatternManager resolverá la regla activa del selector.
        // Modos especiales: rule=null (no aplica filtro B/S).
        eventBus.emit('automaton:filterChanged', {mode, rule: null});

        // Colapsar el acordeón de reglas estándar al entrar en modo especial, expandir al salir.
        const rulesHeader = document.querySelector('.accordion-header[data-accordion="rules"]');
        if (rulesHeader) {
            const isSpecial = mode !== SpecialEngineManager.MODES.STANDARD;
            rulesHeader.classList.toggle('active', !isSpecial);
        }

        const indicator = document.getElementById('modeIndicator');
        if (!indicator) return;

        if (mode === SpecialEngineManager.MODES.TRIANGLE) {
            const info = this.automaton.triangleEngine.getInfo();
            indicator.className = 'mode-indicator triangle-mode';
            indicator.innerHTML = `<i class="fa-solid fa-play"></i> ETA R${info.rule} ${info.mode === 'edge' ? '▲' : '▽'}`;
        } else if (mode === SpecialEngineManager.MODES.WOLFRAM) {
            const info = this.automaton.wolframEngine.getInfo();
            indicator.className = 'mode-indicator wolfram-mode';
            indicator.innerHTML = `<i class="fas fa-arrows-alt-v"></i> Wolfram R${info.rule} ${info.direction === 'vertical' ? '↓' : '→'}`;
        } else if (mode === SpecialEngineManager.MODES.LANGTON) {
            const info = this.automaton.langtonEngine?.getInfo() || {rule: 'RL', antCount: 0};
            const antLabel = info.antCount > 0 ? `×${info.antCount}` : 'custom';
            indicator.className = 'mode-indicator langton-mode';
            indicator.innerHTML = `<i class="fas fa-bug"></i> Langton "${info.rule}" ${antLabel}`;
        } else if (mode === SpecialEngineManager.MODES.WIREWORLD) {
            indicator.className = 'mode-indicator wireworld-mode';
            indicator.innerHTML = `<i class="fas fa-bolt"></i> WireWorld`;
        } else if (mode === SpecialEngineManager.MODES.ULAM_WARBURTON) {
            indicator.className = 'mode-indicator uw-mode';
            indicator.innerHTML = `<i class="fas fa-snowflake"></i> Ulam-Warburton`;
        } else {
            indicator.className = 'mode-indicator standard-mode';
            indicator.innerHTML = `<i class="fas fa-th"></i> 2D Cellular`;
        }
    }

    /**
     * Muestra u oculta un panel de controles de modo especial.
     * @param {string}  selector   — id del elemento (o selector CSS si cssQuery=true)
     * @param {boolean} show       — true para activar, false para desactivar
     * @param {boolean} cssQuery   — true para usar querySelector en lugar de getElementById
     * @param {boolean} toggleClass — true para aplicar la clase 'active' (default true)
     */
    _toggleControls(selector, show, {cssQuery = false, toggleClass = true} = {}) {
        const el = cssQuery
            ? document.querySelector(selector)
            : document.getElementById(selector);
        if (!el) return;
        if (toggleClass) el.classList.toggle('active', show);
        el.style.opacity = show ? '1' : '0.5';
        el.style.pointerEvents = show ? 'all' : 'none';
    }

    _toggleLangtonControls(show) {
        this._toggleControls('langtonControls', show);
    }

    _toggleWireworldControls(show) {
        this._toggleControls('wireworldControls', show);
    }

    _toggleWolframControls(show) {
        this._toggleControls('wolframControls', show);
    }

    _toggleTriangleControls(show) {
        this._toggleControls('triangleControls', show);
    }

    _toggleRD2DControls(show) {
        this._toggleControls('.rd2d-info', show, {cssQuery: true, toggleClass: false});
    }

    _updateTwinRuleInfo() {
        const info = document.getElementById('twinRuleInfo');
        if (!info || !this.automaton.triangleEngine?.isActive) return;
        const engine = this.automaton.triangleEngine;
        if (engine.destroboscope) {
            info.textContent = `↔ Twin: regla ${engine._twinRuleNumber}`;
        } else {
            info.textContent = '';
        }
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
            this.automaton.renderer.resizeCanvas();
            this.automaton.renderer.reGrid();
        }
        this.automaton.render();
        this._onUpdateHeader();
        this._updateModeIndicator(mode);
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

        this.automaton.renderer.reGrid();
        this.automaton.render();
        this._updateModeIndicator(SpecialEngineManager.MODES.STANDARD);
        this._onUpdateHeader();
        this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        this._onSyncPlayButton();
    }

    /**
     * Configura ruleSelector y neighborhoodType para la entrada/salida de un modo especial.
     *
     * @param {boolean}      disabled      — true al activar un modo, false al volver al estándar
     * @param {string|null}  neighborhood  — valor a asignar a neighborhoodType ('moore' | 'neumann')
     *   null → no cambiar el valor, solo aplicar disabled
     */
    _setModeSelectors(disabled, neighborhood = null) {
        document.getElementById('ruleSelector').disabled = disabled;
        const neighborhoodSelect = document.getElementById('neighborhoodType');
        if (neighborhoodSelect) {
            if (neighborhood !== null) neighborhoodSelect.value = neighborhood;
            neighborhoodSelect.disabled = disabled;
        }
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
                hideControls: () => this._toggleWolframControls(false),
                deactivate: () => this.automaton.wolframEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.RD2D,
                toggleId: 'rd2dToggle',
                hideControls: () => this._toggleRD2DControls(false),
                deactivate: () => this.automaton.rd2dEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.TRIANGLE,
                toggleId: 'triangleToggle',
                hideControls: () => this._toggleTriangleControls(false),
                deactivate: () => this._deactivateTriangleEngine()
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
                hideControls: () => this._toggleLangtonControls(false),
                deactivate: () => this.automaton.langtonEngine?.deactivate()
            },
            {
                name: SpecialEngineManager.MODES.WIREWORLD,
                toggleId: 'wireworldToggle',
                hideControls: () => this._toggleWireworldControls(false),
                deactivate: () => this.automaton.wireworldEngine?.deactivate()
            }
        ];

        for (const mode of modes) {
            if (mode.name === exceptMode) continue;
            const toggle = document.getElementById(mode.toggleId);
            if (toggle) toggle.checked = false;
            mode.hideControls();
            mode.deactivate();
        }

        // Restaurar selectores compartidos al estado neutro.
        // El modo entrante los reconfigurará según sus necesidades.
        this._setModeSelectors(false, 'moore');
    }

    /**
     * Limpia el engine triangular y restaura el renderer/core estándar.
     * Extraído para evitar duplicación entre _deactivateAllModes y deactivateTriangleMode.
     */
    _deactivateTriangleEngine() {
        if (this.automaton.triangleEngine) {
            this.automaton.triangleEngine.clear?.();
            this.automaton.triangleEngine.deactivate();
            this.automaton.triangleEngine = null;
        }
        if (this.automaton._originalRenderer) {
            const oldRenderer = this.automaton.renderer;
            this.automaton.renderer = this.automaton._originalRenderer;
            this.automaton._originalRenderer = null;
            oldRenderer?.destroy?.();
            this.automaton.renderer.resize(this.automaton.gridSize, this.automaton.cellSize);
        }
        if (this.automaton._originalCore) {
            this.automaton.core = this.automaton._originalCore;
            this.automaton._originalCore = null;
        }
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
        this._updateModeIndicator(SpecialEngineManager.MODES.LANGTON);
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
        const mode = engine.neighborhoodMode;
        engine.activate({rule, mode, wrap: engine.wrapEdges});
        if (reset) {
            engine.reset();
            this.automaton.render();
        }
        this._updateTwinRuleInfo();
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