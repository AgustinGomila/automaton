/**
 * scripts/core/engines/rd2d-engine.js
 *
 * RD2DEngine — Motor de Distinción Recursiva 2D.
 *
 * Basado en el trabajo de Louis Kauffman sobre Distinción Recursiva.
 * 16 estados representados por 4 bits: [N, S, E, W].
 * Regla: nuevo_estado = vecN XOR vecS XOR vecE XOR vecW
 *
 * ─── Optimización step() ───────────────────────────────────────────────
 * El hot-loop inline los 4 accesos de vecinos directamente en lugar de
 * llamar _getState() 4 veces por celda. Beneficios:
 *   - Elimina 4M calls/frame (1000×1000) con su overhead de V8 dispatch.
 *   - Cachea wrapEdges, gw, gh fuera del doble loop.
 *   - Loop x-exterior / y-interior (column-major) coincide con el layout
 *     stateGrid[x][y], maximizando la localidad de caché del Uint8Array.
 *
 * ─── Convención de índice plano ────────────────────────────────────────
 * Column-major:  index = x * gridHeight + y
 * Consistente con GridRenderer y GridManager.
 */

class RD2DEngine {

    /**
     * Paleta de colores por número de fronteras abiertas (0-4 bits activos).
     */
    static COLORS = [
        null,       // 0 fronteras — vacío
        '#ef4444',  // 1 frontera  — rojo
        '#f97316',  // 2 fronteras — naranja
        '#eab308',  // 3 fronteras — amarillo
        '#22c55e',  // 4 fronteras — verde
    ];

    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;

        this.gridWidth = 0;
        this.gridHeight = 0;

        this.stateGrid = null;
        this._backStateGrid = null;

        this.generation = 0;
        this.initialized = false;
        this._forceReinit = false;

        this._changedBuf = new Uint32Array(0);  // buffer pre-allocado, crece/recorta según necesidad
        this._changedCount = 0;
    }

    /** Nombre legible del estado para debugging. */
    static getStateName(state) {
        const names = [
            '∅', 'E', 'W', 'EW', 'S', 'SE', 'SW', 'SEW',
            'N', 'NE', 'NW', 'NEW', 'NS', 'NSE', 'NSW', 'NSEW'
        ];
        return names[state] || '∅';
    }

    static countBorders(state) {
        let count = 0;
        for (let i = 0; i < 4; i++) count += (state >> i) & 1;
        return count;
    }

    // ─── Ciclo de vida ────────────────────────────────────────────────────

    activate() {
        this.isActive = true;
        this.gridWidth = this.automaton.gridWidth;
        this.gridHeight = this.automaton.gridHeight;
        this.generation = 0;
        this.initialized = false;
        this._forceReinit = false;
        this._initStateGrid();

        this.automaton.renderer.setColorProvider(
            (idx) => this._colorProvider(idx)
        );
        console.debug(`🔵 RD-2D activado, ${this.gridWidth}×${this.gridHeight}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.stateGrid = null;
        this._backStateGrid = null;
        this.initialized = false;
        // Usar ?. doble: el renderer puede ser el triangular (sin setColorProvider)
        // si RD2D se desactiva mientras Triangle aún no restauró el renderer estándar.
        this.automaton.renderer?.setColorProvider?.(null);
    }

    /**
     * Resetea para reinicio controlado.
     * Limpia stateGrid y fuerza repintado completo para que las celdas
     * coloreadas desaparezcan del canvas.
     *
     * La limpieza de automaton.grid solo ocurre cuando el engine está activo:
     * resetAllEngines() llama a este método en todos los engines y no debemos
     * borrar el grid principal cuando RD2D no era el modo activo.
     */
    reset() {
        this.initialized = false;
        this._forceReinit = false;
        this.generation = 0;
        this._changedCount = 0;

        if (this.stateGrid) {
            for (let x = 0; x < this.stateGrid.length; x++) {
                this.stateGrid[x]?.fill(0);
            }
        }

        // Solo limpiar el grid binario y forzar repintado si RD2D estaba activo.
        // Si no estaba activo (llamado desde resetAllEngines durante randomize/clear),
        // no debemos tocar el grid principal: podría borrar datos recién escritos.
        if (this.isActive && this.automaton?.grid) {
            const gw = this.gridWidth;
            for (let x = 0; x < gw; x++) {
                if (this.automaton.grid[x]) this.automaton.grid[x].fill(0);
            }
            this.automaton?.renderer?.markAllDirty?.();
        }
    }

    syncFromGrid() {
        this._initStateGrid();
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        for (let x = 0; x < gw; x++) {
            if (!this.automaton.grid[x]) continue;
            for (let y = 0; y < gh; y++) {
                this.stateGrid[x][y] = this.automaton.grid[x][y]
                    ? (this._inferStateFromNeighbors(x, y) || 15)
                    : 0;
            }
        }
    }

    // ─── Paso de simulación ───────────────────────────────────────────────

    /**
     * Avanza una generación.
     *
     * Hot-path: los 4 vecinos se acceden inline con ternarios (wrap)
     * o bounds checks (bounded). Sin llamadas a _getState().
     * Loop x-exterior/y-interior = column-major = cache-friendly para Uint8Array.
     */
    step() {
        if (!this.isActive || !this.automaton?.grid) return false;

        // Resincronizar si el grid cambió de tamaño
        const curW = this.automaton.gridWidth;
        const curH = this.automaton.gridHeight;
        if (curW !== this.gridWidth || curH !== this.gridHeight) {
            this.gridWidth = curW;
            this.gridHeight = curH;
            this._initStateGrid();
            this.initialized = false;
        }

        if (!this.initialized) {
            if (this._checkUserSeed()) {
                this.syncFromGrid();
            } else {
                this._initializeDefaultSeed();
            }
            this.initialized = true;
            this.generation = 0;

            // Registrar todas las celdas no-vacías como cambiadas
            const gw = this.gridWidth;
            const gh = this.gridHeight;
            const buf = this._ensureChangedBuf(gw, gh);
            this._changedCount = 0;
            for (let x = 0; x < gw; x++) {
                for (let y = 0; y < gh; y++) {
                    if (this.stateGrid[x][y] !== 0) buf[this._changedCount++] = x * gh + y;
                }
            }
            return true;
        }

        const gw = this.gridWidth;
        const gh = this.gridHeight;
        const wrap = this.automaton.wrapEdges;  // cachear fuera del loop
        const sg = this.stateGrid;
        const back = this._backStateGrid;
        const buf = this._ensureChangedBuf(gw, gh);

        this._changedCount = 0;
        let changed = false;

        if (wrap) {
            // ── Path toroidal: ternarios sin branching extra ──────────────
            for (let x = 0; x < gw; x++) {
                const xm = x === 0 ? gw - 1 : x - 1;
                const xp = x === gw - 1 ? 0 : x + 1;
                const colBack = back[x];
                const colCurr = sg[x];
                const colM = sg[xm];
                const colP = sg[xp];

                for (let y = 0; y < gh; y++) {
                    const ym = y === 0 ? gh - 1 : y - 1;
                    const yp = y === gh - 1 ? 0 : y + 1;

                    const ns = colCurr[ym]   // N
                        ^ colCurr[yp]   // S
                        ^ colP[y]        // E
                        ^ colM[y];       // W

                    colBack[y] = ns;
                    if (ns !== colCurr[y]) {
                        changed = true;
                        buf[this._changedCount++] = x * gh + y;
                    }
                }
            }
        } else {
            // ── Path bounded: bounds checks explícitos ───────────────────
            for (let x = 0; x < gw; x++) {
                const colBack = back[x];
                const colCurr = sg[x];

                for (let y = 0; y < gh; y++) {
                    const ns = (y > 0 ? colCurr[y - 1] : 0)   // N
                        ^ (y < gh - 1 ? colCurr[y + 1] : 0)   // S
                        ^ (x < gw - 1 ? sg[x + 1][y] : 0)   // E
                        ^ (x > 0 ? sg[x - 1][y] : 0);  // W

                    colBack[y] = ns;
                    if (ns !== colCurr[y]) {
                        changed = true;
                        buf[this._changedCount++] = x * gh + y;
                    }
                }
            }
        }

        // Swap de buffers sin allocaciones
        this._backStateGrid = sg;
        this.stateGrid = back;
        this.generation++;

        this._syncToAutomatonGrid();
        return changed;
    }

    getChangedCells() {
        return this._changedBuf.subarray(0, this._changedCount);
    }

    // ─── Desplazamiento toroidal (pan) ────────────────────────────────────

    shift(dx, dy) {
        if (!this.stateGrid) return;
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        const src = this.stateGrid;
        const dst = this._backStateGrid;

        for (let x = 0; x < gw; x++) {
            const srcX = ((x - dx) % gw + gw) % gw;
            const srcCol = src[srcX];
            const dstCol = dst[x];
            for (let y = 0; y < gh; y++) {
                dstCol[y] = srcCol[((y - dy) % gh + gh) % gh];
            }
        }

        this._backStateGrid = src;
        this.stateGrid = dst;
    }

    // ─── Info ─────────────────────────────────────────────────────────────

    getInfo() {
        let aliveCells = 0;
        if (this.stateGrid) {
            const gw = this.gridWidth;
            const gh = this.gridHeight;
            for (let x = 0; x < gw; x++) {
                for (let y = 0; y < gh; y++) {
                    if (this.stateGrid[x][y] !== 0) aliveCells++;
                }
            }
        }
        return {
            active: this.isActive,
            generation: this.generation,
            aliveCells,
            gridWidth: this.gridWidth,
            gridHeight: this.gridHeight,
            states: 16,
            rule: 'XOR(N,S,E,W)'
        };
    }

    // ─── Privados ─────────────────────────────────────────────────────────

    /**
     * Proveedor de color para GridRenderer.setColorProvider().
     * Solo se llama si el path WASM no está activo (RD-2D usa colorProvider).
     */
    _colorProvider(cellIndex) {
        if (!this.stateGrid) return null;
        const gh = this.gridHeight;
        const x = (cellIndex / gh) | 0;
        const y = cellIndex % gh;
        const state = this.stateGrid[x]?.[y];
        if (!state) return null;
        let count = 0;
        for (let i = 0; i < 4; i++) count += (state >> i) & 1;
        return RD2DEngine.COLORS[count] ?? '#94a3b8';
    }

    /**
     * Reutiliza el buffer de changed cells.
     * Crece si el grid es mayor que el buffer actual.
     * Recorta si el grid ocupa menos del 25% del buffer (evita retener
     * memoria tras un redimensionado de grids grandes a pequeños).
     * @param {number} gw
     * @param {number} gh
     */
    _ensureChangedBuf(gw, gh) {
        const needed = gw * gh;
        if (!this._changedBuf.length
            || this._changedBuf.length < needed
            || this._changedBuf.length > needed * 4) {
            this._changedBuf = new Uint32Array(needed);
        }
        return this._changedBuf;
    }

    _initStateGrid() {
        this.stateGrid = this._allocGrid(this.gridWidth, this.gridHeight);
        this._backStateGrid = this._allocGrid(this.gridWidth, this.gridHeight);
    }

    _allocGrid(w, h = w) {
        const g = new Array(w);
        for (let x = 0; x < w; x++) g[x] = new Uint8Array(h);
        return g;
    }

    _checkUserSeed() {
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        for (let x = 0; x < gw; x++) {
            if (!this.automaton.grid[x]) continue;
            for (let y = 0; y < gh; y++) {
                if (this.automaton.grid[x][y]) return true;
            }
        }
        return false;
    }

    /**
     * Devuelve el estado de una celda con soporte toroidal o bounded.
     * Solo se usa fuera del hot-loop (syncFromGrid, inferState).
     */
    _getState(x, y) {
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        if (this.automaton.wrapEdges) {
            const wx = ((x % gw) + gw) % gw;
            const wy = ((y % gh) + gh) % gh;
            return this.stateGrid[wx]?.[wy] || 0;
        }
        if (x < 0 || x >= gw || y < 0 || y >= gh) return 0;
        return this.stateGrid[x]?.[y] || 0;
    }

    _syncToAutomatonGrid() {
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        for (let x = 0; x < gw; x++) {
            if (!this.automaton.grid[x]) continue;
            for (let y = 0; y < gh; y++) {
                const isAlive = this.stateGrid[x]?.[y] !== 0;
                if (this.automaton.grid[x][y] !== (isAlive ? 1 : 0)) {
                    this.automaton.grid[x][y] = isAlive ? 1 : 0;
                    this.automaton.renderer.markDirty(x, y);
                }
            }
        }
    }

    _initializeDefaultSeed() {
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        const cx = (gw / 2) | 0;
        const cy = (gh / 2) | 0;

        this._initStateGrid();

        for (let i = -2; i <= 2; i++) {
            const vy = cy + i;
            if (vy >= 0 && vy < gh) {
                this.stateGrid[cx][vy] = 15;
                this.automaton.grid[cx][vy] = 1;
            }
            const hx = cx + i;
            if (hx >= 0 && hx < gw && i !== 0) {
                this.stateGrid[hx][cy] = 15;
                this.automaton.grid[hx][cy] = 1;
            }
        }

        this.generation = 0;
        this.initialized = true;
        this._forceReinit = false;
    }

    _inferStateFromNeighbors(x, y) {
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        let state = 0;

        if (y > 0 && this.automaton.grid[x]?.[y - 1]) state |= 8;  // N
        if (y < gh - 1 && this.automaton.grid[x]?.[y + 1]) state |= 4;  // S
        if (x < gw - 1 && this.automaton.grid[x + 1]?.[y]) state |= 2;  // E
        if (x > 0 && this.automaton.grid[x - 1]?.[y]) state |= 1;  // W

        return state === 0 ? 15 : state;
    }
}

export {RD2DEngine};