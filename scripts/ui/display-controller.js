/**
 * DisplayController - Gestiona todas las actualizaciones del DOM informativo.
 *
 * Responsabilidad: renderizar en el DOM el estado actual del autómata:
 * cabecera, reglas, vecindad, estadísticas, coordenadas y modo de dibujo.
 *
 * No conoce eventos de usuario, canvas ni motores especiales.
 * Solo lee del autómata y escribe en el DOM.
 */
class DisplayController {
    /**
     * @param {CellularAutomaton} automaton
     */
    constructor(automaton) {
        this.automaton = automaton;
    }

    // =========================================
    // CABECERA / REGLAS / VECINDAD
    // =========================================

    updateHeaderInfo() {
        // === MODO RD-2D ===
        if (this.automaton.specialMode === 'rd2d' && this.automaton.rd2dEngine?.isActive) {
            const wrap = this.automaton.wrapEdges ? '∞' : '■';
            this._setTitle(t('app.title.rd2d'));
            this._setH1('fas fa-border-style', t('header.title', {ruleName: 'RD-2D'}));
            this._setRulesSpecific(`
                <p><span class="rd2d-states"><i class="fas fa-cube"></i> ${t('rd2d.states.label')}:</span> 16 [N,S,E,W]</p>
                <p><span class="rd2d-rule"><i class="fas fa-project-diagram"></i> ${t('rd2d.rule.label')}:</span> XOR(${t('rd2d.neighbors')})</p>
            `);
            this._setNeighborhoodText(t('rd2d.neighborhood', {wrap}));
            this.updateNeighborhoodInfo();
            return;
        }

        // === MODO WOLFRAM ===
        if (this.automaton.specialMode === 'wolfram' && this.automaton.wolframEngine?.isActive) {
            const info = this.automaton.wolframEngine.getInfo();
            const wrap = this.automaton.wrapEdges ? '∞' : '■';
            const directionSymbol = info.direction === 'vertical' ? '↓' : '→';
            const directionText = info.direction === 'vertical'
                ? t('wolfram.vertical.short') : t('wolfram.horizontal.short');
            const binary = info.rule.toString(2).padStart(8, '0');

            this._setTitle(t('app.title.wolfram', {rule: info.rule}));
            this._setH1('fas fa-dice', t('header.title', {ruleName: `Wolfram R${info.rule}`}));
            this._setRulesSpecific(`
                <p><span class="wolfram-rule"><i class="fas fa-hashtag"></i> ${t('config.rule')}</span> ${info.rule}</p>
                <p><span class="wolfram-binary"><i class="fas fa-binary"></i> ${t('wolfram.binary')}</span> ${binary}</p>
                <p><span class="wolfram-direction"><i class="fas fa-arrows-alt-${info.direction === 'vertical' ? 'v' : 'h'}"></i> ${t('wolfram.direction')}:</span> ${directionText} ${directionSymbol}</p>
                <p class="notation">${t('wolfram.progress')} <span class="highlight">${info.progress}/${info.max}</span></p>
            `);
            this._setNeighborhoodText(t('wolfram.neighborhood', {wrap}));
            this.updateNeighborhoodInfo();
            return;
        }

        // === MODO TRIANGULAR ===
        if (this.automaton.specialMode === 'triangle' && this.automaton.triangleEngine?.isActive) {
            const info = this.automaton.triangleEngine.getInfo();
            const binary = info.rule.toString(2).padStart(8, '0');

            this._setTitle(t('app.title.triangle', {rule: info.rule}));
            this._setH1('fa-solid fa-play', t('header.title', {ruleName: `ETA R${info.rule}`}));
            this._setRulesSpecific(`
                <p><span class="triangle-rule"><i class="fas fa-hashtag"></i> ${t('config.rule')}</span> ${info.rule}</p>
                <p class="notation">${t('wolfram.binary')} <span class="highlight">${binary}</span></p>
            `);
            this._setNeighborhoodText(t('triangle.neighborhood'));
            this.updateNeighborhoodInfo();
            return;
        }

        // === MODO 2D ESTÁNDAR ===
        const selector = document.getElementById('ruleSelector');
        if (!selector) return;

        const ruleKey = selector.value;
        if (window.RULES?.[ruleKey]) {
            this.updateRuleInfo(window.RULES[ruleKey]);
        }
        this.updateNeighborhoodInfo();
    }

    updateRuleInfo(rule) {
        const rulesSpecific = document.getElementById('rulesSpecific');
        if (!rulesSpecific) return;

        this._setRulesSpecific(`
            <p><span class="birth"><i class="fas fa-seedling"></i> ${t('header.rules.birth')}</span> ${rule.birth.join(', ')} ${t('header.rules.neighbors')}</p>
            <p><span class="survival"><i class="fas fa-heart"></i> ${t('header.rules.survival')}</span> ${rule.survival.join(', ')} ${t('header.rules.neighbors')}</p>
            <p class="notation">${t('header.rules.notation')} <span class="highlight">${rule.ruleString}</span></p>
        `);

        this._setTitle(`${t('app.title')} - ${rule.name} ${rule.ruleString}`);
        this._setH1('fas fa-cogs', t('header.title', {ruleName: rule.name}));

        const type = this.automaton.neighborhoodType === 'moore' ? 'Moore' : 'Neumann';
        const radius = this.automaton.neighborhoodRadius;
        const wrap = this.automaton.wrapEdges ? '∞' : '■';
        this._setNeighborhoodText(t('header.neighborhood', {type, radius, wrap}));
    }

    updateNeighborhoodInfo() {
        const el = document.getElementById('neighborhoodInfo');
        if (!el || !this.automaton) return;

        const wrap = this.automaton.wrapEdges ? '∞' : '■';

        if (this.automaton.specialMode === 'wolfram' && this.automaton.wolframEngine?.isActive) {
            el.innerHTML = `<i class="fas fa-dice"></i> ${t('wolfram.neighborhood', {wrap})}`;
        } else if (this.automaton.specialMode === 'rd2d' && this.automaton.rd2dEngine?.isActive) {
            el.innerHTML = `<i class="fas fa-border-style"></i> ${t('rd2d.neighborhood', {wrap})}`;
        } else if (this.automaton.specialMode === 'triangle' && this.automaton.triangleEngine?.isActive) {
            el.innerHTML = `<i class="fa-solid fa-play"></i> ${t('triangle.neighborhood', {wrap})}`;
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

        if (typeof x === 'object' && x.q !== undefined) {
            coords.textContent = `Q: ${x.q}, R: ${x.r}`;
        } else {
            coords.textContent = t('header.coords', {x, y});
        }
    }

    // =========================================
    // MODO DE DIBUJO
    // =========================================

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

window.DisplayController = DisplayController;