/**
 * RuleController — Gestión del selector de reglas B/S y la regla custom.
 *
 * Responsabilidades:
 *   - Poblar #ruleSelector con las reglas de window.RULES
 *   - Cambiar la regla activa (changeRule)
 *   - Aplicar una regla custom B/S/C (applyCustomRule)
 *
 * Dependencias externas (inyectadas):
 *   - automaton               — instancia de CellularAutomaton
 *   - onActivateGenerations   — (birth, survival, numStates) activa Generations
 *   - onDeactivateGenerations — () desactiva Generations
 *   - onUpdateHeader          — () actualiza el header
 *   - onUpdateRuleInfo        — (rule) actualiza el display de info de regla
 *   - addEventListener        — helper compartido de registro+cleanup
 */
class RuleController {

    constructor({
                    automaton,
                    onActivateGenerations,
                    onDeactivateGenerations,
                    onUpdateHeader,
                    onUpdateRuleInfo,
                    addEventListener
                }) {
        this.automaton = automaton;
        this._onActivateGenerations = onActivateGenerations;
        this._onDeactivateGenerations = onDeactivateGenerations;
        this._onUpdateHeader = onUpdateHeader;
        this._onUpdateRuleInfo = onUpdateRuleInfo;
        this._addEventListener = addEventListener;
    }

    bindEvents() {
        this._addEventListener(
            document.getElementById('ruleSelector'), 'change', () => this.changeRule()
        );
        this._addEventListener(
            document.getElementById('applyCustomRuleBtn'), 'click', () => this.applyCustomRule()
        );
    }

    loadRules() {
        const selector = document.getElementById('ruleSelector');
        if (!selector) return;

        while (selector.options.length > 0) selector.removeItem(0);

        Object.keys(window.RULES).forEach(key => {
            const rule = window.RULES[key];
            const option = document.createElement('option');
            option.value = key;

            option.textContent = (key === 'custom' && rule.birth.length > 0 && rule.survival.length > 0)
                ? `${t('config.rule.custom')} (${rule.ruleString})`
                : `${rule.name} (${rule.ruleString})`;

            selector.appendChild(option);
        });

        if (window.RULES.conway) {
            selector.value = 'conway';
            this._onUpdateRuleInfo(window.RULES.conway);
        }
    }

    changeRule() {
        const selector = document.getElementById('ruleSelector');

        if (selector.value === 'custom') {
            document.getElementById('birthInput').value = this.automaton.rule.birth.join(',');
            document.getElementById('survivalInput').value = this.automaton.rule.survival.join(',');

        } else if (window.RULES?.[selector.value]) {
            const rule = window.RULES[selector.value];
            document.getElementById('birthInput').value = rule.birth.join(',');
            document.getElementById('survivalInput').value = rule.survival.join(',');

            if (this.automaton.specialMode === SpecialEngineManager.MODES.GENERATIONS) {
                const numStates = parseInt(document.getElementById('generationsStates')?.value) || 3;
                this._onActivateGenerations(rule.birth, rule.survival, numStates);
            } else {
                const statesSlider = document.getElementById('generationsStates');
                const statesDisplay = document.getElementById('generationsStatesDisplay');
                if (statesSlider) statesSlider.value = '2';
                if (statesDisplay) statesDisplay.textContent = '2';

                this.automaton.setRule(rule.survival, rule.birth);
                this._onUpdateHeader();
                eventBus.emit('automaton:filterChanged', {
                    mode: SpecialEngineManager.MODES.STANDARD,
                    rule: rule.ruleString
                });
            }
        }

        selector.blur();
    }

    applyCustomRule() {
        const birthInput = document.getElementById('birthInput').value;
        const survivalInput = document.getElementById('survivalInput').value;
        const numStates = parseInt(document.getElementById('generationsStates')?.value) || 2;

        try {
            const customRule = parseCustomRule(birthInput, survivalInput);

            if (numStates > 2) {
                this._onActivateGenerations(customRule.birth, customRule.survival, numStates);
                return;
            }

            if (this.automaton.specialMode === SpecialEngineManager.MODES.GENERATIONS) {
                this._onDeactivateGenerations();
            }

            this.automaton.setRule(customRule.survival, customRule.birth);

            if (window.RULES?.custom) {
                window.RULES.custom.survival = customRule.survival;
                window.RULES.custom.birth = customRule.birth;
                window.RULES.custom.ruleString = `B${customRule.birth.join('')}/S${customRule.survival.join('')}`;

                const selector = document.getElementById('ruleSelector');
                const selectedOption = selector.options[selector.selectedIndex];
                selectedOption.textContent = `${t('config.rule.custom')} (${window.RULES.custom.ruleString})`;

                this._onUpdateRuleInfo(window.RULES.custom);
                eventBus.emit('automaton:filterChanged', {
                    mode: SpecialEngineManager.MODES.STANDARD,
                    rule: window.RULES.custom.ruleString
                });
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }
}

// =============================================================================

/**
 * NeighborhoodController — Grilla visual de vecindad y controles de tipo/radio.
 *
 * Responsabilidades:
 *   - Construir la grilla (2R+1)×(2R+1) con celdas activables por drag
 *   - Detectar si la selección coincide con Moore / Neumann / Custom
 *   - Aplicar la vecindad al autómata al cambiar tipo o radio
 *   - Actualizar el contador de vecinos activos
 *
 * Dependencias externas (inyectadas):
 *   - automaton           — instancia de CellularAutomaton
 *   - onUpdateHeader      — () => void
 *   - onUpdateNeighborhood— () => void  (actualiza el display de vecindad)
 *   - addEventListener    — helper compartido de registro+cleanup
 */
class NeighborhoodController {

    constructor({automaton, onUpdateHeader, onUpdateNeighborhood, addEventListener}) {
        this.automaton = automaton;
        this._onUpdateHeader = onUpdateHeader;
        this._onUpdateNeighborhood = onUpdateNeighborhood;
        this._addEventListener = addEventListener;
    }

    bindEvents() {
        const typeSelect = document.getElementById('neighborhoodType');
        const radiusSlider = document.getElementById('neighborhoodRadius');

        if (typeSelect) {
            this._addEventListener(typeSelect, 'change',
                (e) => this.changeNeighborhoodType(e.target.value)
            );
        }

        if (radiusSlider) {
            this._addEventListener(radiusSlider, 'input', (e) => {
                const radius = parseInt(e.target.value);
                this.changeNeighborhoodRadius(radius);
                const display = document.getElementById('radiusValue');
                if (display) display.textContent = e.target.value;
            });
        }

        this.renderGrid(this.automaton.neighborhoodRadius);
    }

    changeNeighborhoodType(type) {
        if (type === 'custom') {
            this._applyCustomNeighborhood();
        } else {
            this.automaton.setNeighborhoodType(type);
        }
        this.renderGrid(this.automaton.neighborhoodRadius);
        this._onUpdateHeader();
    }

    changeNeighborhoodRadius(radius) {
        this.automaton.setNeighborhoodRadius(radius);
        this._onUpdateHeader();
        const display = document.getElementById('radiusValue');
        if (display) display.textContent = radius;
        this.renderGrid(radius);
    }

    /**
     * Construye (o reconstruye) la grilla visual de (2R+1)×(2R+1) celdas.
     *
     * Estado inicial según el tipo activo:
     *   - moore   → todas las celdas activas
     *   - neumann → solo el diamante (|dx|+|dy| ≤ R)
     *   - custom  → selección existente recortada al nuevo radio
     *
     * @param {number} radius
     */
    renderGrid(radius) {
        const container = document.getElementById('neighborhoodGrid');
        if (!container) return;

        const side = 2 * radius + 1;

        // Tamaño de celda adaptado al ancho disponible del panel.
        // clientWidth = 0 cuando el acordeón está cerrado → usar el panel lateral.
        const availableWidth =
            container.parentElement?.clientWidth ||
            document.getElementById('leftPanel')?.clientWidth ||
            document.querySelector('.config-section')?.clientWidth ||
            240;
        const gap = 3;
        const parentWidth = availableWidth - 16;
        const maxCellSize = Math.floor((parentWidth - gap * (side - 1)) / side);
        const cellSize = Math.max(8, Math.min(26, maxCellSize));

        container.style.gridTemplateColumns = `repeat(${side}, ${cellSize}px)`;
        container.style.gap = `${gap}px`;
        container.style.setProperty('--nc-size', `${cellSize}px`);
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
            // Custom: conservar selección existente recortada al nuevo radio
            activeSet = new Set(
                this.automaton.core.neighborhood.offsets
                    .filter(o => Math.abs(o.dx) <= radius && Math.abs(o.dy) <= radius)
                    .map(o => `${o.dx},${o.dy}`)
            );
        }

        let _dragging = false;
        let _paintActive = false;

        this._addEventListener(document, 'mouseup', () => {
            _dragging = false;
        });

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
                    this._addEventListener(cell, 'mousedown', (e) => {
                        e.preventDefault();
                        _dragging = true;
                        _paintActive = !cell.classList.contains('active');
                        cell.classList.toggle('active', _paintActive);
                        this._onCellToggled();
                    });

                    this._addEventListener(cell, 'mouseenter', () => {
                        if (!_dragging) return;
                        if (cell.classList.contains('active') !== _paintActive) {
                            cell.classList.toggle('active', _paintActive);
                            this._onCellToggled();
                        }
                    });
                }

                container.appendChild(cell);
            }
        }

        this._updateNeighborCount();
    }

    _onCellToggled() {
        const radius = this.automaton.neighborhoodRadius;
        const detected = this._detectPresetType(radius);

        if (detected === 'moore' || detected === 'neumann') {
            this.automaton.setNeighborhoodType(detected);
        } else {
            this._applyCustomNeighborhood();
        }

        const typeSelect = document.getElementById('neighborhoodType');
        if (typeSelect) typeSelect.value = detected;

        this._updateNeighborCount();
        this._onUpdateHeader();
    }

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
        this._updateNeighborCount();
        this._onUpdateNeighborhood();
    }

    _updateNeighborCount() {
        const countEl = document.getElementById('customNeighborCount');
        if (!countEl) return;
        const active = document.querySelectorAll('#neighborhoodGrid .neighborhood-cell.active').length;
        countEl.textContent = active;
    }
}

window.RuleController = RuleController;
window.NeighborhoodController = NeighborhoodController;