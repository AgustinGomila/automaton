/**
 * RD2DEngine — Motor de Distinción Recursiva 2D.
 *
 * Basado en el trabajo de Louis Kauffman sobre Distinción Recursiva.
 * 16 estados representados por 4 bits: [N, S, E, W] (Norte, Sur, Este, Oeste).
 * Cada bit indica si la frontera correspondiente está "abierta" (1) o "cerrada" (0).
 *
 * Estados (0-15):
 *   0: 0000 (vacío)    4: 0100 (S)       8: 1000 (N)      12: 1100 (NS)
 *   1: 0001 (E)        5: 0101 (SE)      9: 1001 (NE)     13: 1101 (NSE)
 *   2: 0010 (W)        6: 0110 (SW)     10: 1010 (NW)     14: 1110 (NSW)
 *   3: 0011 (EW)       7: 0111 (SEW)    11: 1011 (NEW)    15: 1111 (NSEW)
 *
 * Regla de evolución: XOR de los estados de los 4 vecinos cardinales.
 *   nuevo_estado[x][y] = vecino_N XOR vecino_S XOR vecino_E XOR vecino_W
 *
 * ─── Convención de índice plano ────────────────────────────────────────
 * Column-major:  index = x * gridHeight + y
 * Consistente con GridRenderer y GridManager.
 *
 * ─── Grids rectangulares ───────────────────────────────────────────────
 * gridWidth y gridHeight se guardan como propiedades de instancia y se
 * re-sincronizan al inicio de step() para detectar resize en caliente.
 */
class RD2DEngine {

    /**
     * @param {Object} automaton — instancia de CellularAutomaton.
     *   Expone: .grid, .gridWidth, .gridHeight, .wrapEdges, .renderer,
     *           ._markAllDirty()
     */
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;

        // Dimensiones snapshot — se sincronizan en step() para detectar resize
        this.gridWidth = 0;
        this.gridHeight = 0;

        // Doble buffer de estados 0-15
        this.stateGrid = null;
        this._backStateGrid = null;

        this.generation = 0;
        this.initialized = false;
        this._forceReinit = false;

        // Índices planos (x * gridHeight + y) de las celdas cambiadas en el último paso
        this._changedCells = [];
    }

    // =========================================
    // UTILIDADES ESTÁTICAS
    // =========================================

    /** Nombre legible del estado para debugging. */
    static getStateName(state) {
        const names = [
            '∅', 'E', 'W', 'EW', 'S', 'SE', 'SW', 'SEW',
            'N', 'NE', 'NW', 'NEW', 'NS', 'NSE', 'NSW', 'NSEW'
        ];
        return names[state] || '∅';
    }

    /** Cuenta fronteras abiertas (bits activos) en un estado. */
    static countBorders(state) {
        let count = 0;
        for (let i = 0; i < 4; i++) count += (state >> i) & 1;
        return count;
    }

    /** Convierte estado numérico a objeto de fronteras {N, S, E, W}. */
    static stateToBorders(state) {
        return {
            N: (state >> 3) & 1,
            S: (state >> 2) & 1,
            E: (state >> 1) & 1,
            W: state & 1
        };
    }

    // =========================================
    // CICLO DE VIDA
    // =========================================

    /**
     * Activa el motor RD-2D.
     * @returns {RD2DEngine} this para chaining
     */
    activate() {
        this.gridWidth = this.automaton.gridWidth;
        this.gridHeight = this.automaton.gridHeight;
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;
        this._forceReinit = false;
        this._initStateGrid();
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.stateGrid = null;
        this._backStateGrid = null;
        this.initialized = false;
    }

    /**
     * Resetea para reinicio controlado.
     * La próxima llamada a step() reinicializará desde el grid actual.
     */
    reset() {
        this.initialized = false;
        this._forceReinit = false;
        this.generation = 0;
        this._changedCells.length = 0;

        if (this.stateGrid) {
            for (let x = 0; x < this.stateGrid.length; x++) {
                this.stateGrid[x]?.fill(0);
            }
        }
    }

    // =========================================
    // PASO DE SIMULACIÓN
    // =========================================

    /**
     * Calcula la siguiente generación aplicando XOR de vecinos cardinales.
     * @returns {boolean} true si alguna celda cambió; false si el estado es estable.
     */
    step() {
        if (!this.isActive || !this.automaton?.grid) return false;

        // Re-sincronizar dimensiones si el grid cambió de tamaño
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

            // Registrar todas las celdas no-vacías como cambiadas en la inicialización
            this._changedCells = [];
            const gw = this.gridWidth;
            const gh = this.gridHeight;
            for (let x = 0; x < gw; x++) {
                for (let y = 0; y < gh; y++) {
                    if (this.stateGrid[x][y] !== 0) this._changedCells.push(x * gh + y);
                }
            }
            return true;
        }

        const gw = this.gridWidth;
        const gh = this.gridHeight;
        const back = this._backStateGrid;
        this._changedCells.length = 0;
        let changed = false;

        for (let y = 0; y < gh; y++) {
            for (let x = 0; x < gw; x++) {
                // Regla XOR de los 4 vecinos cardinales
                const ns = this._getState(x, y - 1)
                    ^ this._getState(x, y + 1)
                    ^ this._getState(x + 1, y)
                    ^ this._getState(x - 1, y);
                back[x][y] = ns;
                if (ns !== this.stateGrid[x][y]) {
                    changed = true;
                    this._changedCells.push(x * gh + y);
                }
            }
        }

        // Swap de buffers sin allocaciones
        this._backStateGrid = this.stateGrid;
        this.stateGrid = back;
        this.generation++;

        this._syncToAutomatonGrid();
        return changed;
    }

    getChangedCells() {
        return this._changedCells;
    }

    // =========================================
    // SINCRONIZACIÓN TRAS EDICIÓN MANUAL
    // =========================================

    /**
     * Sincroniza el stateGrid RD desde el grid binario del autómata.
     * Convierte celdas vivas del usuario a estados RD apropiados.
     */
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

    // =========================================
    // DESPLAZAMIENTO TOROIDAL (pan)
    // =========================================

    /**
     * Desplaza el stateGrid (dx, dy) celdas en modo toroidal.
     * Llamado por shiftGrid() cuando el usuario hace pan con Alt+drag.
     */
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

        // Swap: dst pasa a ser el stateGrid activo, src queda como back buffer
        this._backStateGrid = src;
        this.stateGrid = dst;
    }

    // =========================================
    // INFO
    // =========================================

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

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Inicializa los dos buffers de estado (doble buffer para swap sin allocaciones).
     */
    _initStateGrid() {
        this.stateGrid = this._allocGrid(this.gridWidth, this.gridHeight);
        this._backStateGrid = this._allocGrid(this.gridWidth, this.gridHeight);
    }

    /**
     * Aloca un grid column-major Uint8Array[w][h], inicializado a cero.
     * @param {number} w - ancho (número de columnas)
     * @param {number} h - alto (número de filas por columna); por defecto = w
     */
    _allocGrid(w, h = w) {
        const g = new Array(w);
        for (let x = 0; x < w; x++) g[x] = new Uint8Array(h);
        return g;
    }

    /**
     * Verifica si el usuario dibujó alguna semilla en el grid binario.
     * @returns {boolean}
     */
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
     * Obtiene el estado de una celda con soporte toroidal o bounded.
     * @param {number} x
     * @param {number} y
     * @returns {number} Estado 0-15
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

    /**
     * Actualiza grid[][] desde stateGrid y marca dirty las celdas que cambiaron.
     */
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

    /**
     * Coloca la semilla por defecto: una cruz centrada en el centro geométrico
     * del grid, con estado 15 (NSEW) en cada celda de la cruz.
     */
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

    /**
     * Intenta inferir un estado RD razonable basado en los vecinos cardinales vivos.
     * Si una celda tiene vecinos vivos en ciertas direcciones, abre esas fronteras.
     * @returns {number} Estado inferido (0-15), o 15 si no hay vecinos.
     */
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

window.RD2DEngine = RD2DEngine;