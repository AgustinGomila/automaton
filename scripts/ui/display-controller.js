import {t} from './i18n.js';
import {rulesLoader} from '../config/rules-loader.js';
import {SpecialEngineManager} from '../core/engines/special-engine-manager.js';

/**
 * DisplayController — Gestiona todas las actualizaciones del DOM informativo.
 *
 * Responsabilidad: renderizar en el DOM el estado actual del autómata:
 * cabecera, reglas, vecindad, estadísticas, coordenadas y modo de dibujo.
 *
 * No conoce eventos de usuario, canvas ni motores especiales directamente:
 * obtiene el modo activo y la info del engine via automaton.getActiveEngineInfo().
 */
class DisplayController {
    /**
     * @param {CellularAutomaton} automaton
     * @param {{ pattern, key, rotation }} patternState
     */
    constructor(automaton, patternState) {
        this.automaton = automaton;
        this._patternState = patternState || {pattern: null, key: null, rotation: 0};
    }

    // =========================================
    // CABECERA / REGLAS / VECINDAD
    // =========================================

    updateHeaderInfo() {
        const {mode, info} = this.automaton.getActiveEngineInfo();
        const wrap = this.automaton.wrapEdges ? '∞' : '■';
        const M = SpecialEngineManager.MODES;

        switch (mode) {
            case M.RD2D:
                this._setTitle(t('app.title.rd2d'));
                this._setH1('fas fa-border-style', t('header.title', {ruleName: 'RD-2D'}));
                this._setRulesSpecific(`
                    <p><span class="rd2d-states"><i class="fas fa-cube"></i> ${t('rd2d.states.label')}:</span> 16 [N,S,E,W]</p>
                    <p><span class="rd2d-rule"><i class="fas fa-project-diagram"></i> ${t('rd2d.rule.label')}:</span> XOR(${t('rd2d.neighbors')})</p>
                `);
                this._setNeighborhoodText(t('rd2d.neighborhood', {wrap}));
                break;

            case M.WOLFRAM: {
                const binary = Number(info.rule).toString(2).padStart(8, '0');
                const dirSymbol = info.direction === 'vertical' ? '↓' : '→';
                const dirText = t(info.direction === 'vertical' ? 'wolfram.vertical.short' : 'wolfram.horizontal.short');
                const dirAxis = info.direction === 'vertical' ? 'v' : 'h';
                this._setTitle(t('app.title.wolfram', {rule: info.rule}));
                this._setH1('fas fa-dice', t('header.title', {ruleName: `Wolfram R${info.rule}`}));
                this._setRulesSpecific(`
                    <p><span class="wolfram-rule"><i class="fas fa-hashtag"></i> ${t('config.rule')}</span> ${info.rule}</p>
                    <p><span class="wolfram-binary"><i class="fas fa-binary"></i> ${t('wolfram.binary')}</span> ${binary}</p>
                    <p><span class="wolfram-direction"><i class="fas fa-arrows-alt-${dirAxis}"></i> ${t('wolfram.direction')}:</span> ${dirText} ${dirSymbol}</p>
                    <p class="notation">${t('wolfram.progress')} <span class="highlight">${info.progress}/${info.max}</span></p>
                `);
                this._setNeighborhoodText(t('wolfram.neighborhood', {wrap}));
                break;
            }

            case M.TRIANGLE: {
                const binary = Number(info.rule).toString(2).padStart(8, '0');
                this._setTitle(t('app.title.triangle', {rule: info.rule}));
                this._setH1('fa-solid fa-play', t('header.title', {ruleName: `ETA R${info.rule}`}));
                this._setRulesSpecific(`
                    <p><span class="triangle-rule"><i class="fas fa-hashtag"></i> ${t('config.rule')}</span> ${info.rule}</p>
                    <p class="notation">${t('wolfram.binary')} <span class="highlight">${binary}</span></p>
                `);
                this._setNeighborhoodText(t('triangle.neighborhood'));
                break;
            }

            case M.LANGTON: {
                const antLabel = info.antCount > 0
                    ? `${info.antCount} ${t('langton.preset')}`
                    : t('langton.custom');
                this._setTitle(t('app.title.langton', {rule: info.rule}));
                this._setH1('fas fa-bug', t('header.title', {ruleName: `Langton "${info.rule}"`}));
                this._setRulesSpecific(`
                    <p><span class="langton-rule"><i class="fas fa-code"></i> ${t('langton.rule')}</span> ${info.rule}</p>
                    <p><span class="langton-colors"><i class="fas fa-palette"></i> ${t('langton.header.colors')}:</span> ${info.numColors}</p>
                    <p><span class="langton-ants"><i class="fas fa-bug"></i> ${t('langton.antCount')}</span> ${antLabel}</p>
                `);
                this._setNeighborhoodText(t('langton.neighborhood', {wrap}));
                break;
            }

            case M.WIREWORLD:
                this._setTitle(t('app.title.wireworld'));
                this._setH1('fas fa-bolt', t('header.title', {ruleName: 'WireWorld'}));
                this._setRulesSpecific(`
                    <p><span style="color:#eab308"><i class="fas fa-minus"></i> ${t('wireworld.conductor')}</span> → ${t('wireworld.head_if')}</p>
                    <p><span style="color:#60a5fa"><i class="fas fa-circle"></i> ${t('wireworld.head')}</span> → ${t('wireworld.tail')}</p>
                    <p><span style="color:#f97316"><i class="fas fa-circle"></i> ${t('wireworld.tail')}</span> → ${t('wireworld.conductor')}</p>
                `);
                this._setNeighborhoodText(t('wireworld.neighborhood', {wrap}));
                break;

            case M.ULAM_WARBURTON:
                this._setTitle(t('app.title.uw'));
                this._setH1('fas fa-snowflake', t('header.title', {ruleName: 'Ulam-Warburton'}));
                this._setRulesSpecific(`
                    <p><span class="birth"><i class="fas fa-seedling"></i> ${t('header.rules.birth')}</span> 1 ${t('header.rules.neighbors')}</p>
                    <p><span class="survival"><i class="fas fa-heart"></i> ${t('header.rules.survival')}</span> 1-4 ${t('header.rules.neighbors')}</p>
                `);
                this._setNeighborhoodText(t('uw.neighborhood', {wrap}));
                break;

            case M.GENERATIONS: {
                const gi = info;
                this._setTitle(t('app.title.generations', {rule: gi.ruleString}));
                this._setH1('fas fa-layer-group', t('header.title', {ruleName: `Generations ${gi.ruleString}`}));
                this._setRulesSpecific(`
                    <p><span class="birth"><i class="fas fa-seedling"></i> ${t('header.rules.birth')}</span> ${gi.birth.join(', ')} ${t('header.rules.neighbors')}</p>
                    <p><span class="survival"><i class="fas fa-heart"></i> ${t('header.rules.survival')}</span> ${gi.survival.join(', ')} ${t('header.rules.neighbors')}</p>
                    <p class="notation">${t('header.rules.notation')} <span class="highlight">${gi.ruleString}</span></p>
                `);
                this._setNeighborhoodText(t('header.neighborhood', {
                    type: this.automaton.neighborhoodType === 'moore' ? 'Moore' : 'Neumann',
                    radius: this.automaton.neighborhoodRadius,
                    wrap
                }));
                break;
            }

            case M.HEXAGONAL: {
                const hi = info;
                this._setTitle(t('app.title.hex', {rule: hi?.ruleString ?? ''}));
                this._setH1('fas fa-hexagon', t('header.title', {ruleName: `Hex ${hi?.ruleString ?? ''}`}));
                this._setRulesSpecific(`
                    <p><span class="birth"><i class="fas fa-seedling"></i> ${t('header.rules.birth')}</span> ${hi?.birth?.join(', ') ?? ''} ${t('header.rules.neighbors')}</p>
                    <p><span class="survival"><i class="fas fa-heart"></i> ${t('header.rules.survival')}</span> ${hi?.survival?.join(', ') ?? ''} ${t('header.rules.neighbors')}</p>
                    <p class="notation">${t('header.rules.notation')} <span class="highlight">${hi?.ruleString ?? ''}</span></p>
                `);
                this._setNeighborhoodText(t('hex.neighborhood', {wrap}));
                break;
            }

            default: { // STANDARD
                const selector = document.getElementById('ruleSelector');
                if (!selector) break;
                const ruleKey = selector.value;
                if (rulesLoader.RULES?.[ruleKey]) this.updateRuleInfo(rulesLoader.RULES[ruleKey]);
                break;
            }
        }

        this.updateNeighborhoodInfo();
    }

    updateRuleInfo(rule) {
        if (!document.getElementById('rulesSpecific')) return;

        this._setRulesSpecific(`
            <p><span class="birth"><i class="fas fa-seedling"></i> ${t('header.rules.birth')}</span> ${rule.birth.join(', ')} ${t('header.rules.neighbors')}</p>
            <p><span class="survival"><i class="fas fa-heart"></i> ${t('header.rules.survival')}</span> ${rule.survival.join(', ')} ${t('header.rules.neighbors')}</p>
            <p class="notation">${t('header.rules.notation')} <span class="highlight">${rule.ruleString}</span></p>
        `);
        this._setTitle(`${t('app.title')} - ${rule.name} ${rule.ruleString}`);
        this._setH1('fas fa-cogs', t('header.title', {ruleName: rule.name}));

        const nType = this.automaton.neighborhoodType;
        const type = nType === 'moore' ? 'Moore' : nType === 'neumann' ? 'Neumann' : t('config.neighborhood.custom.short');
        const radius = this.automaton.neighborhoodRadius;
        const wrap = this.automaton.wrapEdges ? '∞' : '■';
        this._setNeighborhoodText(t('header.neighborhood', {type, radius, wrap}));
    }

    updateNeighborhoodInfo() {
        const el = document.getElementById('neighborhoodInfo');
        if (!el || !this.automaton) return;

        const wrap = this.automaton.wrapEdges ? '∞' : '■';
        const M = SpecialEngineManager.MODES;

        const templates = {
            [M.WOLFRAM]: `<i class="fas fa-dice"></i> ${t('wolfram.neighborhood', {wrap})}`,
            [M.RD2D]: `<i class="fas fa-border-style"></i> ${t('rd2d.neighborhood', {wrap})}`,
            [M.TRIANGLE]: `<i class="fa-solid fa-play"></i> ${t('triangle.neighborhood', {wrap})}`,
            [M.HEXAGONAL]: `<i class="fas fa-hexagon"></i> ${t('hex.neighborhood', {wrap})}`,
            [M.ULAM_WARBURTON]: `<i class="fas fa-snowflake"></i> ${t('uw.neighborhood', {wrap})}`,
        };

        const mode = this.automaton.specialMode;
        if (templates[mode]) {
            el.innerHTML = templates[mode];
        } else if (this.automaton.neighborhoodType === 'custom') {
            const n = this.automaton.core?.neighborhood?.getInfo()?.neighborCount ?? 0;
            el.innerHTML = `<i class="fas fa-th"></i> ${t('header.neighborhood.custom', {n, wrap})}`;
        } else {
            const type = this.automaton.neighborhoodType === 'moore' ? 'Moore' : 'Neumann';
            const radius = this.automaton.neighborhoodRadius;
            el.innerHTML = `<i class="fas fa-crosshairs"></i> ${t('header.neighborhood', {type, radius, wrap})}`;
        }
    }

    // =========================================
    // ESTADÍSTICAS Y COORDENADAS
    // =========================================

    updateStats(stats) {
        const genEl = document.getElementById('generation');
        const popEl = document.getElementById('population');
        const densEl = document.getElementById('density');
        if (!genEl || !popEl || !densEl) return;

        genEl.textContent = (stats.generation || 0).toLocaleString();
        popEl.textContent = (stats.population || 0).toLocaleString();
        densEl.textContent = `${stats.density || 0}%`;
    }

    updateMouseCoords(x, y) {
        const coords = document.getElementById('mouseCoords');
        if (!coords) return;
        coords.textContent = (typeof x === 'object' && x.q !== undefined)
            ? `Q: ${x.q}, R: ${x.r}`
            : t('header.coords', {x, y});
    }

    // =========================================
    // MODO DE DIBUJO
    // =========================================

    updateDrawModeIndicator() {
        const indicators = [
            document.getElementById('drawModeIndicator'),
            document.getElementById('drawModeIndicatorModal')
        ];
        for (const indicator of indicators) {
            if (!indicator) continue;
            if (this._patternState.pattern) {
                indicator.className = 'pattern-mode-indicator pattern-selected';
                indicator.textContent = t('mode.pattern', {name: this._patternState.pattern.name});
            } else {
                indicator.className = 'pattern-mode-indicator free-draw';
                indicator.textContent = t('mode.freeDraw');
            }
        }
    }

    // =========================================
    // PRIVADOS — escritura DOM
    // =========================================

    _setTitle(text) {
        document.title = text;
    }

    _setH1(iconClass, text) {
        const h1 = document.querySelector('h1');
        if (h1) h1.innerHTML = `<i class="${iconClass}"></i> ${text}`;
    }

    _setRulesSpecific(html) {
        const el = document.getElementById('rulesSpecific');
        if (el) el.innerHTML = html;
    }

    _setNeighborhoodText(text) {
        const el = document.getElementById('neighborhoodText');
        if (el) el.textContent = text;
    }

    destroy() {
        this.automaton = null;
    }
}

export {DisplayController};