/**
 * SpecialModeUI — Capa de presentación para los modos especiales del autómata.
 *
 * Responsabilidad exclusiva: operaciones DOM relacionadas con los modos
 * especiales (indicadores, paneles de controles, selectores, badges).
 *
 * No conoce los engines ni la lógica de activación. Recibe el automaton
 * solo para leer info de estado de los engines activos (solo lectura).
 *
 * Extraído de SpecialModeController para separar presentación de coordinación.
 */
class SpecialModeUI {

    /** @param {Object} automaton — instancia de CellularAutomaton (solo lectura) */
    constructor(automaton) {
        this.automaton = automaton;
    }

    // =========================================
    // PANELES DE CONTROLES
    // =========================================

    /**
     * Muestra u oculta un panel de controles de modo especial.
     * @param {string}  selector    — id del elemento (o selector CSS si cssQuery=true)
     * @param {boolean} show        — true para activar, false para desactivar
     * @param {boolean} cssQuery    — true para usar querySelector en lugar de getElementById
     * @param {boolean} toggleClass — true para aplicar la clase 'active' (default true)
     */
    toggleControls(selector, show, {cssQuery = false, toggleClass = true} = {}) {
        const el = cssQuery
            ? document.querySelector(selector)
            : document.getElementById(selector);
        if (!el) return;
        if (toggleClass) el.classList.toggle('active', show);
        el.style.opacity = show ? '1' : '0.5';
        el.style.pointerEvents = show ? 'all' : 'none';
    }

    toggleLangtonControls(show) {
        this.toggleControls('langtonControls', show);
    }

    toggleWireworldControls(show) {
        this.toggleControls('wireworldControls', show);
    }

    toggleWolframControls(show) {
        this.toggleControls('wolframControls', show);
    }

    toggleTriangleControls(show) {
        this.toggleControls('triangleControls', show);
    }

    toggleRD2DControls(show) {
        this.toggleControls('.rd2d-info', show, {cssQuery: true, toggleClass: false});
    }

    // =========================================
    // SELECTORES COMPARTIDOS
    // =========================================

    /**
     * Habilita o deshabilita el selector de reglas y el de vecindad.
     * @param {boolean}     disabled     — true al activar un modo especial
     * @param {string|null} neighborhood — valor a asignar a neighborhoodType; null = no cambiar
     */
    setModeSelectors(disabled, neighborhood = null) {
        document.getElementById('ruleSelector').disabled = disabled;
        const neighborhoodSelect = document.getElementById('neighborhoodType');
        if (neighborhoodSelect) {
            if (neighborhood !== null) neighborhoodSelect.value = neighborhood;
            neighborhoodSelect.disabled = disabled;
        }
    }

    // =========================================
    // INDICADOR DE MODO
    // =========================================

    /**
     * Actualiza el indicador visual de modo activo, el toggle de Standard,
     * los acordeones y emite el evento automaton:filterChanged.
     * @param {string} mode — SpecialEngineManager.MODES.X
     */
    updateModeIndicator(mode) {
        const isGenerations = mode === SpecialEngineManager.MODES.GENERATIONS;
        const isStandard = mode === SpecialEngineManager.MODES.STANDARD;
        const isStandardLike = isStandard || isGenerations;

        // Evento de filtro (PatternManager lo usa para filtrar patrones)
        if (isGenerations) {
            eventBus.emit('automaton:filterChanged', {
                mode,
                rule: undefined,
                skipStandardRuleUpdate: true
            });
        } else {
            eventBus.emit('automaton:filterChanged', {mode, rule: null});
        }

        // Acordeón "rules": visible en Standard/Generations, oculto en modos especiales
        const rulesHeader = document.querySelector('.accordion-header[data-accordion="rules"]');
        if (rulesHeader) rulesHeader.classList.toggle('active', isStandardLike);

        // Toggle Standard
        const standardToggle = document.getElementById('standardToggle');
        if (standardToggle) standardToggle.checked = isStandardLike;

        // Acordeones de engines especiales
        for (const engineMode of Object.values(SpecialEngineManager.MODES)) {
            if (engineMode === SpecialEngineManager.MODES.STANDARD) continue;
            if (engineMode === SpecialEngineManager.MODES.GENERATIONS) continue;

            const header = document.querySelector(`.accordion-header[data-accordion="${engineMode}"]`);
            if (header) header.classList.toggle('active', engineMode === mode);
        }

        // Indicador visual principal
        this._renderModeIndicator(mode);
    }

    /**
     * Actualiza el texto del badge de regla gemela (modo Triangle destroboscópico).
     */
    updateTwinRuleInfo() {
        const info = document.getElementById('twinRuleInfo');
        if (!info || !this.automaton.triangleEngine?.isActive) return;
        const engine = this.automaton.triangleEngine;
        info.textContent = engine.destroboscope
            ? `↔ Twin: regla ${engine._twinRuleNumber}`
            : '';
    }

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Renderiza el contenido del #modeIndicator según el modo activo.
     * @param {string} mode
     */
    _renderModeIndicator(mode) {
        const indicator = document.getElementById('modeIndicator');
        if (!indicator) return;

        switch (mode) {
            case SpecialEngineManager.MODES.TRIANGLE: {
                const info = this.automaton.triangleEngine.getInfo();
                indicator.className = 'mode-indicator triangle-mode';
                indicator.innerHTML = `<i class="fa-solid fa-play"></i> ETA R${info.rule}`;
                break;
            }
            case SpecialEngineManager.MODES.WOLFRAM: {
                const info = this.automaton.wolframEngine.getInfo();
                indicator.className = 'mode-indicator wolfram-mode';
                indicator.innerHTML = `<i class="fas fa-arrows-alt-v"></i> Wolfram R${info.rule} ${info.direction === 'vertical' ? '↓' : '→'}`;
                break;
            }
            case SpecialEngineManager.MODES.LANGTON: {
                const info = this.automaton.langtonEngine?.getInfo() || {rule: 'RL', antCount: 0};
                const antLabel = info.antCount > 0 ? `×${info.antCount}` : 'custom';
                indicator.className = 'mode-indicator langton-mode';
                indicator.innerHTML = `<i class="fas fa-bug"></i> Langton "${info.rule}" ${antLabel}`;
                break;
            }
            case SpecialEngineManager.MODES.WIREWORLD:
                indicator.className = 'mode-indicator wireworld-mode';
                indicator.innerHTML = `<i class="fas fa-bolt"></i> WireWorld`;
                break;
            case SpecialEngineManager.MODES.ULAM_WARBURTON:
                indicator.className = 'mode-indicator uw-mode';
                indicator.innerHTML = `<i class="fas fa-snowflake"></i> Ulam-Warburton`;
                break;
            case SpecialEngineManager.MODES.GENERATIONS: {
                const info = this.automaton.generationsEngine?.getInfo();
                indicator.className = 'mode-indicator generations-mode';
                indicator.innerHTML = `<i class="fas fa-layer-group"></i> Generations ${info?.ruleString ?? ''}`;
                break;
            }
            default:
                indicator.className = 'mode-indicator standard-mode';
                indicator.innerHTML = `<i class="fas fa-th"></i> 2D Cellular`;
        }
    }
}

window.SpecialModeUI = SpecialModeUI;