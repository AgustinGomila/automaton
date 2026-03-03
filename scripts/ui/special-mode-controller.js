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
                    this._deactivateOtherModes('rd2d');
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
                    this._deactivateOtherModes('wolfram');
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
                    this._deactivateOtherModes('triangle');
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
                    this._deactivateOtherModes('langton');
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
                    this._deactivateOtherModes('wireworld');
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
                    this._stopIfRunning();
                    const rule = langtonRuleInput.value.toUpperCase().replace(/[^LRNU]/g, '') || 'RL';
                    langtonRuleInput.value = rule;
                    const antCount = parseInt(document.getElementById('langtonAntCount')?.value) || 0;
                    this.automaton.langtonEngine.activate({rule, antCount});
                    this._updateModeIndicator('langton');
                    this._onUpdateHeader();
                    this._onSyncPlayButton();
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
                    this._stopIfRunning();
                    const antCount = parseInt(document.getElementById('langtonAntCount')?.value) || 0;
                    this.automaton.langtonEngine.activate({rule, antCount});
                    this._updateModeIndicator('langton');
                    this._onUpdateHeader();
                    this._onSyncPlayButton();
                }
            });
        });

        // Número de hormigas
        const langtonAntCount = document.getElementById('langtonAntCount');
        if (langtonAntCount) {
            this._addEventListener(langtonAntCount, 'change', () => {
                if (this.automaton.langtonEngine?.isActive) {
                    this._stopIfRunning();
                    const rule = document.getElementById('langtonRule')?.value || 'RL';
                    const antCount = parseInt(langtonAntCount.value) || 0;
                    this.automaton.langtonEngine.activate({rule, antCount});
                    this._updateModeIndicator('langton');
                    this._onUpdateHeader();
                    this._onSyncPlayButton();
                }
            });
        }

        // Toggle Ulam-Warburton
        const uwToggle = document.getElementById('uwToggle');
        if (uwToggle) {
            this._addEventListener(uwToggle, 'change', () => {
                if (uwToggle.checked) {
                    this._deactivateOtherModes('ulam-warburton');
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
                    this._stopIfRunning();
                    const direction = this.automaton.wolframEngine.direction;
                    this.automaton.wolframEngine.activate(rule, direction);
                    this._onUpdateHeader();
                    this._onSyncPlayButton();
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
                    this._stopIfRunning();
                    const direction = this.automaton.wolframEngine.direction;
                    this.automaton.wolframEngine.activate(rule, direction);
                    this._onUpdateHeader();
                    this.automaton.clear();
                    this.automaton.wolframEngine._initializeSeed();
                    this.automaton.render();
                    this._onShowNotification(t('notif.rule.enabled', {rule}), 'info', 1500);
                    this._onSyncPlayButton();
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
                    this._stopIfRunning();
                    this.automaton.triangleEngine.activate({rule, wrap: this.automaton.triangleEngine.wrapEdges});
                    this._updateTwinRuleInfo()
                    this._onUpdateHeader();
                    this._onSyncPlayButton();
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
                    this._stopIfRunning();
                    const mode = this.automaton.triangleEngine.neighborhoodMode;
                    this.automaton.triangleEngine.activate({rule, mode});
                    this.automaton.triangleEngine.reset();
                    this.automaton.render();
                    this._onUpdateHeader();
                    this._onShowNotification(t('notif.rule.enabled', {rule}), 'info', 1500);
                    this._onSyncPlayButton();
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
            this._stopIfRunning();
            await this.automaton._initSpecialEngine('wolfram');

            document.getElementById('rd2dToggle') && (document.getElementById('rd2dToggle').checked = false);
            this._toggleRD2DControls(false);
            this._toggleWolframControls(true);
            document.getElementById('ruleSelector').disabled = true;
            document.getElementById('neighborhoodType').disabled = true;

            this.automaton.wolframEngine.activate(rule, direction);
            this.automaton.renderer.resizeCanvas();
            this.automaton.renderer.reGrid();
            this.automaton.render();

            this._onUpdateHeader();
            this._updateModeIndicator('wolfram');
            this._onShowNotification(t('notif.wolfram.enabled', {rule}), 'info', 2000);
            this._onSyncPlayButton();
        } catch (error) {
            console.error('Error cargando WolframEngine:', error);
            this._onShowNotification(t('notif.wolfram.error'), 'warning', 3000);
        }
    }

    deactivateWolframMode() {
        this._stopIfRunning();

        document.getElementById('ruleSelector').disabled = false;
        document.getElementById('neighborhoodType').disabled = false;
        this._toggleWolframControls(false);

        this.automaton.wolframEngine?.deactivate();
        this.automaton.specialMode = null;
        this.automaton.renderer.reGrid();
        this.automaton.render();

        this._updateModeIndicator('standard');
        this._onUpdateHeader();
        this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        this._onSyncPlayButton();
    }

    async activateRD2DMode() {
        try {
            this._stopIfRunning();
            await this.automaton._initSpecialEngine('rd2d');

            document.getElementById('wolframToggle') && (document.getElementById('wolframToggle').checked = false);
            this._toggleWolframControls(false);
            this._toggleRD2DControls(true);

            document.getElementById('ruleSelector').disabled = true;
            const neighborhoodSelect = document.getElementById('neighborhoodType');
            if (neighborhoodSelect) {
                neighborhoodSelect.value = 'neumann';
                neighborhoodSelect.disabled = true;
            }

            this.automaton.rd2dEngine.activate();
            this.automaton.renderer.resizeCanvas();
            this.automaton.renderer.reGrid();
            this.automaton.render();

            this._onUpdateHeader();
            this._updateModeIndicator('rd2d');
            this._onShowNotification(t('notif.rd2d.enabled'), 'info', 2000);
            this._onSyncPlayButton();
        } catch (error) {
            console.error('Error cargando RD2DEngine:', error);
            this._onShowNotification(t('notif.rd2d.error'), 'warning', 3000);
        }
    }

    deactivateRD2DMode() {
        this._stopIfRunning();

        document.getElementById('ruleSelector').disabled = false;
        const neighborhoodSelect = document.getElementById('neighborhoodType');
        if (neighborhoodSelect) {
            neighborhoodSelect.disabled = false;
            neighborhoodSelect.value = 'moore';
        }
        this._toggleRD2DControls(false);

        this.automaton.rd2dEngine?.deactivate();
        this.automaton.specialMode = null;
        this.automaton.renderer.reGrid();
        this.automaton.render();

        this._updateModeIndicator('standard');
        this._onUpdateHeader();
        this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        this._onSyncPlayButton();
    }

    async activateTriangleMode(rule = 50) {
        if (!this.automaton?.grid) {
            this._onShowNotification(t('notif.automata.error'), 'warning', 3000);
            return;
        }

        try {
            this._stopIfRunning();

            for (let x = 0; x < this.automaton.gridSize; x++) {
                for (let y = 0; y < this.automaton.gridSize; y++) {
                    this.automaton.grid[x][y] = 0;
                }
            }

            await this.automaton._initSpecialEngine('triangle');

            this._toggleTriangleControls(true);
            document.getElementById('ruleSelector').disabled = true;
            document.getElementById('neighborhoodType').disabled = true;

            const wrapToggle = document.getElementById('wrapToggle');
            const wrap = wrapToggle ? wrapToggle.checked : true;

            this.automaton.triangleEngine.activate({rule, wrap});

            if (this.automaton.triangleEngine.gridManager) {
                this.automaton.renderer.setGridManager(this.automaton.triangleEngine.gridManager);
            }

            this.automaton.triangleEngine._initializeFromAutomaton();
            this.automaton.triangleEngine.initialized = true;

            this.automaton.renderer.markAllDirty();
            this.automaton.render();

            const destroboscopeToggle = document.getElementById('destroboscopeToggle');
            if (destroboscopeToggle) {
                this.automaton.triangleEngine.destroboscope = destroboscopeToggle.checked;
            }
            this._updateTwinRuleInfo();

            this._onUpdateHeader();
            this._updateModeIndicator('triangle');
            this._onShowNotification(t('notif.triangle.enabled', {rule}), 'info', 2000);
            this._onSyncPlayButton();
        } catch (error) {
            console.error('Error cargando TriangleEngine:', error);
            this._onShowNotification(t('notif.triangle.error'), 'warning', 3000);
            this.deactivateTriangleMode();
        }
    }

    deactivateTriangleMode() {
        this._stopIfRunning();
        this._toggleTriangleControls(false);
        document.getElementById('ruleSelector').disabled = false;
        document.getElementById('neighborhoodType').disabled = false;

        if (this.automaton.triangleEngine) {
            this.automaton.triangleEngine.clear();
            this.automaton.triangleEngine.deactivate();
            this.automaton.triangleEngine = null;
        }

        if (this.automaton._originalRenderer) {
            const oldRenderer = this.automaton.renderer;   // renderer triangular activo
            this.automaton.renderer = this.automaton._originalRenderer;
            this.automaton._originalRenderer = null;
            // Destruir el renderer triangular: elimina el overlay canvas del DOM
            oldRenderer?.destroy?.();
            // Recalcular el canvas al tamaño correcto del grid estándar
            this.automaton.renderer.resize(
                this.automaton.gridSize,
                this.automaton.cellSize
            );
        }
        if (this.automaton._originalCore) {
            this.automaton.core = this.automaton._originalCore;
            this.automaton._originalCore = null;
        }

        this.automaton.specialMode = null;
        this.automaton.generation = 0;

        for (let x = 0; x < this.automaton.gridSize; x++) {
            for (let y = 0; y < this.automaton.gridSize; y++) {
                this.automaton.grid[x][y] = 0;
            }
        }

        this.automaton.renderer.markAllDirty();
        this.automaton.render();

        this._updateModeIndicator('standard');
        this._onUpdateHeader();
        this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        this._onSyncPlayButton();
    }

    // =========================================
    // CONTROLES VISUALES DE MODO
    // =========================================

    async activateLangtonMode(rule = 'RL', antCount = 0) {
        try {
            this._stopIfRunning();
            await this.automaton._initSpecialEngine('langton');

            document.getElementById('ruleSelector').disabled = true;
            document.getElementById('neighborhoodType').disabled = true;

            this.automaton.langtonEngine.activate({rule, antCount});
            this.automaton.renderer.resizeCanvas();
            this.automaton.renderer.reGrid();
            this.automaton.render();

            this._onUpdateHeader();
            this._updateModeIndicator('langton');
            this._toggleLangtonControls(true);
            this._onShowNotification(t('notif.langton.enabled'), 'info', 2000);
            eventBus.emit('automaton:modeChanged', {mode: 'langton'});
            this._onSyncPlayButton();
        } catch (error) {
            console.error('Error cargando LangtonEngine:', error);
            this._onShowNotification(t('notif.langton.error'), 'warning', 3000);
        }
    }

    deactivateLangtonMode() {
        this._stopIfRunning();

        document.getElementById('ruleSelector').disabled = false;
        document.getElementById('neighborhoodType').disabled = false;

        this.automaton.langtonEngine?.deactivate();
        this.automaton.specialMode = null;
        this.automaton.renderer.reGrid();
        this.automaton.render();

        this._toggleLangtonControls(false);
        this._updateModeIndicator('standard');
        this._onUpdateHeader();
        this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        eventBus.emit('automaton:modeChanged', {mode: 'standard'});
        this._onSyncPlayButton();
    }

    async activateWireworldMode() {
        try {
            this._stopIfRunning();
            await this.automaton._initSpecialEngine('wireworld');

            document.getElementById('ruleSelector').disabled = true;
            const neighborhoodSelectWW = document.getElementById('neighborhoodType');
            if (neighborhoodSelectWW) {
                neighborhoodSelectWW.value = 'moore';
                neighborhoodSelectWW.disabled = true;
            }

            this.automaton.wireworldEngine.activate();
            this.automaton.renderer.resizeCanvas();
            this.automaton.renderer.reGrid();
            this.automaton.render();

            this._onUpdateHeader();
            this._updateModeIndicator('wireworld');
            this._toggleWireworldControls(true);
            this._onShowNotification(t('notif.wireworld.enabled'), 'info', 2000);
            eventBus.emit('automaton:modeChanged', {mode: 'wireworld'});
            this._onSyncPlayButton();
        } catch (error) {
            console.error('Error cargando WireWorldEngine:', error);
            this._onShowNotification(t('notif.wireworld.error'), 'warning', 3000);
        }
    }

    deactivateWireworldMode() {
        this._stopIfRunning();

        document.getElementById('ruleSelector').disabled = false;
        const neighborhoodSelectWW = document.getElementById('neighborhoodType');
        if (neighborhoodSelectWW) {
            neighborhoodSelectWW.disabled = false;
            neighborhoodSelectWW.value = 'moore';
        }

        this.automaton.wireworldEngine?.deactivate();
        this.automaton.specialMode = null;
        this.automaton.renderer.reGrid();
        this.automaton.render();

        this._toggleWireworldControls(false);
        this._updateModeIndicator('standard');
        this._onUpdateHeader();
        this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        eventBus.emit('automaton:modeChanged', {mode: 'standard'});
        this._onSyncPlayButton();
    }

    async activateUWMode() {
        try {
            this._stopIfRunning();
            await this.automaton._initSpecialEngine('ulam-warburton');

            document.getElementById('ruleSelector').disabled = true;
            const neighborhoodSelect = document.getElementById('neighborhoodType');
            if (neighborhoodSelect) {
                neighborhoodSelect.value = 'neumann';
                neighborhoodSelect.disabled = true;
            }

            this.automaton.uwEngine.activate();
            this.automaton.renderer.resizeCanvas();
            this.automaton.renderer.reGrid();
            this.automaton.render();

            this._onUpdateHeader();
            this._updateModeIndicator('ulam-warburton');
            this._onShowNotification(t('notif.uw.enabled'), 'info', 2000);
            this._onSyncPlayButton();
        } catch (error) {
            console.error('Error cargando UlamWarburtonEngine:', error);
            this._onShowNotification(t('notif.uw.error'), 'warning', 3000);
        }
    }

    deactivateUWMode() {
        this._stopIfRunning();

        document.getElementById('ruleSelector').disabled = false;
        const neighborhoodSelect = document.getElementById('neighborhoodType');
        if (neighborhoodSelect) {
            neighborhoodSelect.disabled = false;
            neighborhoodSelect.value = 'moore';
        }

        this.automaton.uwEngine?.deactivate();
        this.automaton.specialMode = null;
        this.automaton.renderer.reGrid();
        this.automaton.render();

        this._updateModeIndicator('standard');
        this._onUpdateHeader();
        this._onShowNotification(t('notif.standard.enabled'), 'info', 2000);
        this._onSyncPlayButton();
    }

    _updateModeIndicator(mode) {
        // Emitir SIEMPRE, antes del guard del DOM.
        // Modo estándar: rule=null → PatternManager resolverá la regla activa del selector.
        // Modos especiales: rule=null (no aplica filtro B/S).
        eventBus.emit('automaton:filterChanged', {mode, rule: null});

        const indicator = document.getElementById('modeIndicator');
        if (!indicator) return;

        if (mode === 'triangle') {
            const info = this.automaton.triangleEngine.getInfo();
            indicator.className = 'mode-indicator triangle-mode';
            indicator.innerHTML = `<i class="fa-solid fa-play"></i> ETA R${info.rule} ${info.mode === 'edge' ? '▲' : '▽'}`;
        } else if (mode === 'wolfram') {
            const info = this.automaton.wolframEngine.getInfo();
            indicator.className = 'mode-indicator wolfram-mode';
            indicator.innerHTML = `<i class="fas fa-arrows-alt-v"></i> Wolfram R${info.rule} ${info.direction === 'vertical' ? '↓' : '→'}`;
        } else if (mode === 'langton') {
            const info = this.automaton.langtonEngine?.getInfo() || {rule: 'RL', antCount: 0};
            const antLabel = info.antCount > 0 ? `×${info.antCount}` : 'custom';
            indicator.className = 'mode-indicator langton-mode';
            indicator.innerHTML = `<i class="fas fa-bug"></i> Langton "${info.rule}" ${antLabel}`;
        } else if (mode === 'wireworld') {
            indicator.className = 'mode-indicator wireworld-mode';
            indicator.innerHTML = `<i class="fas fa-bolt"></i> WireWorld`;
        } else if (mode === 'ulam-warburton') {
            indicator.className = 'mode-indicator uw-mode';
            indicator.innerHTML = `<i class="fas fa-snowflake"></i> Ulam-Warburton`;
        } else {
            indicator.className = 'mode-indicator standard-mode';
            indicator.innerHTML = `<i class="fas fa-th"></i> 2D Cellular`;
        }
    }

    _toggleLangtonControls(show) {
        const el = document.getElementById('langtonControls');
        if (!el) return;
        el.classList.toggle('active', show);
        el.style.opacity = show ? '1' : '0.5';
        el.style.pointerEvents = show ? 'all' : 'none';
    }

    _toggleWireworldControls(show) {
        const el = document.getElementById('wireworldControls');
        if (!el) return;
        el.classList.toggle('active', show);
        el.style.opacity = show ? '1' : '0.5';
        el.style.pointerEvents = show ? 'all' : 'none';
    }

    _toggleWolframControls(show) {
        const el = document.getElementById('wolframControls');
        if (!el) return;
        el.classList.toggle('active', show);
        el.style.opacity = show ? '1' : '0.5';
        el.style.pointerEvents = show ? 'all' : 'none';
    }

    _toggleRD2DControls(show) {
        const el = document.querySelector('.rd2d-info');
        if (!el) return;
        el.style.opacity = show ? '1' : '0.5';
        el.style.pointerEvents = show ? 'all' : 'none';
    }

    _toggleTriangleControls(show) {
        const el = document.getElementById('triangleControls');
        if (!el) return;
        el.classList.toggle('active', show);
        el.style.opacity = show ? '1' : '0.5';
        el.style.pointerEvents = show ? 'all' : 'none';
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

    _deactivateOtherModes(activeMode) {
        if (activeMode !== 'wolfram') {
            const toggle = document.getElementById('wolframToggle');
            if (toggle?.checked) {
                toggle.checked = false;
                this._toggleWolframControls(false);
                this.automaton.wolframEngine?.deactivate();
            }
        }
        if (activeMode !== 'rd2d') {
            const toggle = document.getElementById('rd2dToggle');
            if (toggle?.checked) {
                toggle.checked = false;
                this._toggleRD2DControls(false);
                this.automaton.rd2dEngine?.deactivate();
            }
        }
        if (activeMode !== 'triangle') {
            const toggle = document.getElementById('triangleToggle');
            if (toggle?.checked) {
                toggle.checked = false;
                this._toggleTriangleControls(false);
                this.automaton.triangleEngine?.deactivate();
                this.automaton.triangleEngine = null;

                // Restaurar renderer estándar (sin esto el canvas triangular persiste)
                if (this.automaton._originalRenderer) {
                    const oldRenderer = this.automaton.renderer;
                    this.automaton.renderer = this.automaton._originalRenderer;
                    this.automaton._originalRenderer = null;
                    oldRenderer?.destroy?.();
                }
                if (this.automaton._originalCore) {
                    this.automaton.core = this.automaton._originalCore;
                    this.automaton._originalCore = null;
                }
                this.automaton.specialMode = null;

                this.automaton.renderer.resize(
                    this.automaton.gridSize,
                    this.automaton.cellSize
                );
            }
        }
        if (activeMode !== 'ulam-warburton') {
            const toggle = document.getElementById('uwToggle');
            if (toggle?.checked) {
                toggle.checked = false;
                this.automaton.uwEngine?.deactivate();
            }
        }
        if (activeMode !== 'langton') {
            const toggle = document.getElementById('langtonToggle');
            if (toggle?.checked) {
                toggle.checked = false;
                this._toggleLangtonControls(false);
                this.automaton.langtonEngine?.deactivate();
            }
        }
        if (activeMode !== 'wireworld') {
            const toggle = document.getElementById('wireworldToggle');
            if (toggle?.checked) {
                toggle.checked = false;
                this._toggleWireworldControls(false);
                this.automaton.wireworldEngine?.deactivate();
            }
        }
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