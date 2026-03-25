/**
 * RuleEngine — Motor de reglas B/S para autómatas celulares tipo Life-like.
 *
 * Soporta grids rectangulares: los métodos nextGeneration y
 * nextGenerationMoore reciben width y height explícitos.
 * El índice plano es x * height + y (column-major consistente).
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
     * Mejoras sobre nextGeneration():
     *   • Pre-cachea referencias de columna (colM / col / colP).
     *   • Aritmética condicional en lugar de módulo para wrap de índices.
     *   • Sin callback countNeighbors() y su overhead de llamada.
     *   • Índice plano x * height + y (column-major rectangular).
     *
     * @param {Uint8Array[]} currentGrid
     * @param {Uint8Array[]} outGrid       — back buffer (no null)
     * @param {boolean}      wrap          — true = toroidal
     * @param {number}       [width]       — columnas
     * @param {number}       [height]      — filas
     * @returns {{ newGrid, changedCells: Uint32Array, changedCount, generationStats }}
     */
    nextGenerationMoore(currentGrid, outGrid, wrap,
                        width = currentGrid.length,
                        height = currentGrid[0]?.length ?? width) {

        const buf = this._ensureChangedBuf(width, height);
        let changedCount = 0, births = 0, deaths = 0;

        if (wrap) {
            for (let x = 0; x < width; x++) {
                const xm = x === 0 ? width - 1 : x - 1;
                const xp = x === width - 1 ? 0 : x + 1;
                const colM = currentGrid[xm];
                const col = currentGrid[x];
                const colP = currentGrid[xp];

                for (let y = 0; y < height; y++) {
                    const ym = y === 0 ? height - 1 : y - 1;
                    const yp = y === height - 1 ? 0 : y + 1;

                    const n = colM[ym] + colM[y] + colM[yp]
                        + col[ym] + col[yp]
                        + colP[ym] + colP[y] + colP[yp];

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
        } else {
            // Bounded: maneja bordes con offsets (-1..1) verificando bounds.
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    let n = 0;
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        if (nx < 0 || nx >= width) continue;
                        const ncol = currentGrid[nx];
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            const ny = y + dy;
                            if (ny >= 0 && ny < height) n += ncol[ny];
                        }
                    }
                    const current = currentGrid[x][y];
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
     * Reutiliza el buffer de changed cells; lo crece sólo cuando el grid es mayor.
     * @param {number} width
     * @param {number} height
     */
    _ensureChangedBuf(width, height) {
        const needed = width * height;
        if (!this._changedBuf || this._changedBuf.length < needed) {
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

window.RuleEngine = RuleEngine;