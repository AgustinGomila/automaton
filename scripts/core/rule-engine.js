/**
 * RuleEngine - Motor de reglas para autómatas celulares tipo Life-like
 * Responsabilidad: Aplicar reglas B/S (Birth/Survival) de forma pura
 * Sin dependencias de grid, renderizado o estado de aplicación
 */
class RuleEngine {
    /**
     * Reglas predefinidas comunes
     */
    static PRESETS = {
        CONWAY: {birth: [3], survival: [2, 3], name: "Conway's Life"},
        HIGH_LIFE: {birth: [3, 6], survival: [2, 3], name: "HighLife"},
        DAY_NIGHT: {birth: [3, 6, 7, 8], survival: [3, 4, 6, 7, 8], name: "Day & Night"},
        SEEDS: {birth: [2], survival: [], name: "Seeds"},
        DIAMOEBA: {birth: [3, 5, 6, 7, 8], survival: [5, 6, 7, 8], name: "Diamoeba"},
        ANNEAL: {birth: [4, 6, 7, 8], survival: [3, 5, 6, 7, 8], name: "Anneal"}
    };

    /**
     * @param {Object} rule
     * @param {number[]} rule.birth - Condiciones de nacimiento (ej: [3])
     * @param {number[]} rule.survival - Condiciones de supervivencia (ej: [2,3])
     */
    constructor(rule = {birth: [3], survival: [2, 3]}) {
        this.setRule(rule);
    }

    /**
     * Crea una regla desde string (formato B3/S23)
     * @param {string} ruleString
     * @returns {RuleEngine}
     */
    static fromString(ruleString) {
        const match = ruleString.match(/B?(\d+)\/S?(\d+)/i);
        if (!match) {
            throw new Error(`Formato de regla inválido: ${ruleString}. Use formato B3/S23`);
        }

        const birth = match[1].split('').map(Number);
        const survival = match[2].split('').map(Number);

        return new RuleEngine({birth, survival});
    }

    /**
     * Crea regla desde preset
     * @param {string} presetName
     * @returns {RuleEngine}
     */
    static fromPreset(presetName) {
        const preset = RuleEngine.PRESETS[presetName.toUpperCase()];
        if (!preset) {
            throw new Error(`Preset desconocido: ${presetName}`);
        }
        return new RuleEngine(preset);
    }

    /**
     * Establece nueva regla
     * @param {Object} rule
     * @throws {Error} Si la regla es inválida
     */
    setRule(rule) {
        // Validación
        if (!this._isValidRuleArray(rule.birth) || !this._isValidRuleArray(rule.survival)) {
            throw new Error('Regla inválida: birth y survival deben ser arrays de enteros 0-8');
        }

        this.birth = [...rule.birth].sort((a, b) => a - b);
        this.survival = [...rule.survival].sort((a, b) => a - b);

        // Pre-calcular sets para lookup O(1)
        this._birthSet = new Set(this.birth);
        this._survivalSet = new Set(this.survival);

        // Generar string de regla (ej: "B3/S23")
        this.ruleString = `B${this.birth.join('')}/S${this.survival.join('')}`;
    }

    /**
     * @param {any} arr
     * @returns {boolean}
     * @private
     */
    _isValidRuleArray(arr) {
        return Array.isArray(arr) && arr.every(n =>
            Number.isInteger(n) && n >= 0 && n <= 8
        );
    }

    /**
     * Calcula el siguiente estado de una celda
     * @param {number} currentState - 0 (muerta) o 1 (viva)
     * @param {number} neighborCount - Cantidad de vecinos vivos
     * @returns {number} 0 o 1
     */
    computeNextState(currentState, neighborCount) {
        if (currentState === 1) {
            // Celda viva: sobrevive si está en survival set
            return this._survivalSet.has(neighborCount) ? 1 : 0;
        } else {
            // Celda muerta: nace si está en birth set
            return this._birthSet.has(neighborCount) ? 1 : 0;
        }
    }

    /**
     * Procesa una generación completa del grid
     * @param {Uint8Array[]} currentGrid - Grid actual
     * @param {Function} countNeighbors - Función (x, y) => count
     * @returns {Object} {newGrid, changedCells: [{x, y}, ...]}
     */
    nextGeneration(currentGrid, countNeighbors) {
        const size = currentGrid.length;
        const newGrid = Array.from({length: size}, () => new Uint8Array(size));
        const changedCells = [];

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const currentState = currentGrid[x][y];
                const neighborCount = countNeighbors(x, y);
                const nextState = this.computeNextState(currentState, neighborCount);

                newGrid[x][y] = nextState;

                if (nextState !== currentState) {
                    changedCells.push({x, y, from: currentState, to: nextState});
                }
            }
        }

        return {
            newGrid,
            changedCells,
            generationStats: {
                births: changedCells.filter(c => c.from === 0).length,
                deaths: changedCells.filter(c => c.from === 1).length,
                totalChanges: changedCells.length
            }
        };
    }

    /**
     * Compara dos reglas
     * @param {RuleEngine} other
     * @returns {boolean}
     */
    equals(other) {
        if (!(other instanceof RuleEngine)) return false;

        const sameBirth = this.birth.length === other.birth.length &&
            this.birth.every((v, i) => v === other.birth[i]);
        const sameSurvival = this.survival.length === other.survival.length &&
            this.survival.every((v, i) => v === other.survival[i]);

        return sameBirth && sameSurvival;
    }

    /**
     * Clona la regla actual
     * @returns {RuleEngine}
     */
    clone() {
        return new RuleEngine({
            birth: [...this.birth],
            survival: [...this.survival]
        });
    }
}

// Exportar global
window.RuleEngine = RuleEngine;