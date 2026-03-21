/**
 * RuleEngine — Motor de reglas B/S para autómatas celulares tipo Life-like.
 *
 * Responsabilidad: aplicar reglas Birth/Survival de forma pura,
 * sin conocer el grid, la UI ni el renderizado.
 */
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
        const match = ruleString.match(/B?(\d+)\/S?(\d+)/i);
        if (!match) throw new Error(`Formato de regla inválido: ${ruleString}. Use B3/S23`);
        return new RuleEngine({
            birth: match[1].split('').map(Number),
            survival: match[2].split('').map(Number)
        });
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

    /**
     * Genera la siguiente generación usando el algoritmo general
     * (cualquier vecindad / radio).
     *
     * @param {Uint8Array[]} currentGrid
     * @param {Function}     countNeighbors — (x, y) => number
     * @param {Uint8Array[]|null} outGrid   — back buffer; si es null se crea uno nuevo
     * @returns {{ newGrid, changedCells: Uint32Array, changedCount, generationStats }}
     */
    nextGeneration(currentGrid, countNeighbors, outGrid = null) {
        const size = currentGrid.length;
        const newGrid = outGrid || Array.from({length: size}, () => new Uint8Array(size));
        const buf = this._ensureChangedBuf(size);

        let changedCount = 0, births = 0, deaths = 0;

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                const current = currentGrid[x][y];
                const next = this.computeNextState(current, countNeighbors(x, y));
                newGrid[x][y] = next;
                if (next !== current) {
                    buf[changedCount++] = x * size + y;
                    if (current === 0) births++; else deaths++;
                }
            }
        }

        return {
            newGrid, changedCells: buf, changedCount,
            generationStats: {births, deaths, totalChanges: changedCount}
        };
    }

    /**
     * Fastpath para Moore radio-1: el caso más común (~95% del uso).
     *
     * Mejoras sobre nextGeneration():
     *   • Pre-cachea referencias de columna (colM / col / colP) por iteración exterior,
     *     reduciendo accesos a currentGrid[x] de 8 a 3 por celda.
     *   • Usa aritmética condicional (?: en lugar de %) para wrap de índices,
     *     que en V8 es ~30% más rápido que el operador módulo para valores positivos.
     *   • Elimina el callback countNeighbors() y su overhead de llamada.
     *
     * El resultado tiene exactamente el mismo formato que nextGeneration() para que
     * el caller no necesite distinguir cuál se usó.
     *
     * @param {Uint8Array[]} currentGrid
     * @param {Uint8Array[]} outGrid      — back buffer (no null)
     * @param {boolean}      wrap         — true = toroidal
     * @returns {{ newGrid, changedCells: Uint32Array, changedCount, generationStats }}
     */
    nextGenerationMoore1(currentGrid, outGrid, wrap) {
        const size = currentGrid.length;
        const buf = this._ensureChangedBuf(size);
        let changedCount = 0, births = 0, deaths = 0;

        if (wrap) {
            for (let x = 0; x < size; x++) {
                const xm = x === 0 ? size - 1 : x - 1;
                const xp = x === size - 1 ? 0 : x + 1;
                const colM = currentGrid[xm];
                const col = currentGrid[x];
                const colP = currentGrid[xp];

                for (let y = 0; y < size; y++) {
                    const ym = y === 0 ? size - 1 : y - 1;
                    const yp = y === size - 1 ? 0 : y + 1;

                    const n = colM[ym] + colM[y] + colM[yp]
                        + col[ym] + col[yp]
                        + colP[ym] + colP[y] + colP[yp];

                    const current = col[y];
                    const next = current
                        ? (this._survivalSet.has(n) ? 1 : 0)
                        : (this._birthSet.has(n) ? 1 : 0);
                    outGrid[x][y] = next;

                    if (next !== current) {
                        buf[changedCount++] = x * size + y;
                        if (current === 0) births++; else deaths++;
                    }
                }
            }
        } else {
            // Bounded: maneja bordes con offsets (-1..1) y guarda condición de bounds.
            for (let x = 0; x < size; x++) {
                for (let y = 0; y < size; y++) {
                    let n = 0;
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= size) continue;
                        const ncol = currentGrid[nx];
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            const ny = y + dy;
                            if (ny >= 0 && ny < size) n += ncol[ny];
                        }
                    }
                    const current = currentGrid[x][y];
                    const next = current
                        ? (this._survivalSet.has(n) ? 1 : 0)
                        : (this._birthSet.has(n) ? 1 : 0);
                    outGrid[x][y] = next;
                    if (next !== current) {
                        buf[changedCount++] = x * size + y;
                        if (current === 0) births++; else deaths++;
                    }
                }
            }
        }

        return {
            newGrid: outGrid, changedCells: buf, changedCount,
            generationStats: {births, deaths, totalChanges: changedCount}
        };
    }

    /** Reutiliza el buffer de changed cells; lo crece solo cuando el grid es mayor. */
    _ensureChangedBuf(size) {
        const needed = size * size;
        if (!this._changedBuf || this._changedBuf.length < needed) {
            this._changedBuf = new Uint32Array(needed);
        }
        return this._changedBuf;
    }

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

window.RuleEngine = RuleEngine;