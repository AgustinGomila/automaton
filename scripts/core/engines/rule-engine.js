/**
 * RuleEngine — Motor de reglas B/S para autómatas celulares tipo Life-like.
 *
 * Soporta grids rectangulares: los métodos nextGeneration y
 * nextGenerationMoore reciben width y height explícitos.
 * El índice plano es x * height + y (column-major consistente).
 */

import {parseRuleString} from '../../config/rules.js';

class RuleEngine {
    static PRESETS = {
        CONWAY: {birth: [3], survival: [2, 3], name: "Conway's Life"},
        HIGH_LIFE: {birth: [3, 6], survival: [2, 3], name: "HighLife"},
        DAY_NIGHT: {birth: [3, 6, 7, 8], survival: [3, 4, 6, 7, 8], name: "Day & Night"},
        SEEDS: {birth: [2], survival: [], name: "Seeds"},
        DIAMOEBA: {birth: [3, 5, 6, 7, 8], survival: [5, 6, 7, 8], name: "Diamoeba"},
        ANNEAL: {birth: [4, 6, 7, 8], survival: [3, 5, 6, 7, 8], name: "Anneal"}
    };

    constructor(rule = {birth: [3], survival: [2, 3]}) {
        this.setRule(rule);
    }

    static fromString(ruleString) {
        const {birth, survival} = parseRuleString(ruleString);
        if (!birth.length && !survival.length) {
            throw new Error(`Formato de regla inválido: ${ruleString}. Use B3/S23`);
        }
        return new RuleEngine({birth, survival});
    }

    static fromPreset(name) {
        const preset = RuleEngine.PRESETS[name.toUpperCase()];
        if (!preset) throw new Error(`Preset desconocido: ${name}`);
        return new RuleEngine(preset);
    }

    setRule(rule) {
        if (!this._isValidRuleArray(rule.birth) || !this._isValidRuleArray(rule.survival)) {
            throw new Error('Regla inválida: birth y survival deben ser arrays de enteros 0-8');
        }
        this.birth = [...rule.birth].sort((a, b) => a - b);
        this.survival = [...rule.survival].sort((a, b) => a - b);
        this._birthSet = new Set(this.birth);
        this._survivalSet = new Set(this.survival);
        this.ruleString = `B${this.birth.join('')}/S${this.survival.join('')}`;
    }

    _isValidRuleArray(arr) {
        return Array.isArray(arr) && arr.every(n => Number.isInteger(n) && n >= 0 && n <= 8);
    }

    computeNextState(currentState, neighborCount) {
        return currentState
            ? (this._survivalSet.has(neighborCount) ? 1 : 0)
            : (this._birthSet.has(neighborCount) ? 1 : 0);
    }

    // =========================================
    // PASO GENÉRICO — cualquier vecindad / radio
    // =========================================

    /**
     * Genera la siguiente generación usando el algoritmo general.
     *
     * @param {Uint8Array[]} currentGrid  — column-major, width columnas
     * @param {Function}     countNeighbors — (x, y) => number
     * @param {Uint8Array[]|null} outGrid  — back buffer; null → crear nuevo
     * @param {number}       [width]       — columnas (default currentGrid.length)
     * @param {number}       [height]      — filas    (default columna[0].length)
     * @returns {{ newGrid, changedCells: Uint32Array, changedCount, generationStats }}
     */
    nextGeneration(currentGrid, countNeighbors, outGrid = null,
                   width = currentGrid.length,
                   height = currentGrid[0]?.length ?? width) {

        const newGrid = outGrid ||
            Array.from({length: width}, () => new Uint8Array(height));
        const buf = this._ensureChangedBuf(width, height);

        let changedCount = 0, births = 0, deaths = 0;

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const current = currentGrid[x][y];
                const next = this.computeNextState(current, countNeighbors(x, y));
                newGrid[x][y] = next;
                if (next !== current) {
                    buf[changedCount++] = x * height + y;
                    if (current === 0) births++; else deaths++;
                }
            }
        }

        return {
            newGrid, changedCells: buf, changedCount,
            generationStats: {births, deaths, totalChanges: changedCount}
        };
    }

    // =========================================
    // FASTPATH MOORE RADIO-1
    // =========================================

    /**
     * Fastpath para Moore radio-1: el caso más común (~95% del uso).
     *
     * @param {Uint8Array[]} currentGrid
     * @param {Uint8Array[]} outGrid       — back buffer (no null)
     * @param {boolean}      wrapX         — wrap en eje X
     * @param {boolean}      wrapY         — wrap en eje Y
     * @param {number}       [width]       — columnas
     * @param {number}       [height]      — filas
     * @returns {{ newGrid, changedCells: Uint32Array, changedCount, generationStats }}
     */
    nextGenerationMoore(currentGrid, outGrid, wrapX, wrapY,
                        width = currentGrid.length,
                        height = currentGrid[0]?.length ?? width) {

        // Backward-compat: si wrapX es boolean y wrapY es number, se llamó con la
        // firma legacy (wrap, width, height). Normalizamos.
        if (typeof wrapY === 'number') {
            height = width;
            width = wrapY;
            wrapY = wrapX;
        }

        const buf = this._ensureChangedBuf(width, height);
        let changedCount = 0, births = 0, deaths = 0;

        for (let x = 0; x < width; x++) {
            const xm = wrapX ? (x === 0 ? width - 1 : x - 1) : x - 1;
            const xp = wrapX ? (x === width - 1 ? 0 : x + 1) : x + 1;
            const colM = (xm >= 0) ? currentGrid[xm] : null;
            const col = currentGrid[x];
            const colP = (xp < width) ? currentGrid[xp] : null;

            for (let y = 0; y < height; y++) {
                const ym = wrapY ? (y === 0 ? height - 1 : y - 1) : y - 1;
                const yp = wrapY ? (y === height - 1 ? 0 : y + 1) : y + 1;

                const ymOk = ym >= 0, ypOk = yp < height;

                let n = 0;
                if (colM) {
                    if (ymOk) n += colM[ym];
                    n += colM[y];
                    if (ypOk) n += colM[yp];
                }
                if (ymOk) n += col[ym];
                if (ypOk) n += col[yp];
                if (colP) {
                    if (ymOk) n += colP[ym];
                    n += colP[y];
                    if (ypOk) n += colP[yp];
                }

                const current = col[y];
                const next = current
                    ? (this._survivalSet.has(n) ? 1 : 0)
                    : (this._birthSet.has(n) ? 1 : 0);
                outGrid[x][y] = next;

                if (next !== current) {
                    buf[changedCount++] = x * height + y;
                    if (current === 0) births++; else deaths++;
                }
            }
        }

        return {
            newGrid: outGrid, changedCells: buf, changedCount,
            generationStats: {births, deaths, totalChanges: changedCount}
        };
    }

    // =========================================
    // BUFFER DE CAMBIOS
    // =========================================

    /**
     * Reutiliza el buffer de changed cells.
     * Crece si el grid es mayor que el buffer actual.
     * Recorta si el grid ocupa menos del 25% del buffer (evita retener
     * 16 MB tras un redimensionado de 2000×2000 → 100×100).
     * El umbral del 25% previene thrashing en redimensionados frecuentes.
     * @param {number} width
     * @param {number} height
     */
    _ensureChangedBuf(width, height) {
        const needed = width * height;
        if (!this._changedBuf
            || this._changedBuf.length < needed
            || this._changedBuf.length > needed * 4) {
            this._changedBuf = new Uint32Array(needed);
        }
        return this._changedBuf;
    }

    // =========================================
    // UTILIDADES
    // =========================================

    equals(other) {
        if (!(other instanceof RuleEngine)) return false;
        return this.birth.length === other.birth.length &&
            this.survival.length === other.survival.length &&
            this.birth.every((v, i) => v === other.birth[i]) &&
            this.survival.every((v, i) => v === other.survival[i]);
    }

    clone() {
        return new RuleEngine({birth: [...this.birth], survival: [...this.survival]});
    }
}

export {RuleEngine};