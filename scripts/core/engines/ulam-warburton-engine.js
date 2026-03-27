/**
 * Motor de Autómata Ulam-Warburton (UW)
 *
 * Regla: una celda muerta nace si tiene EXACTAMENTE 1 vecino vivo
 * en la vecindad de Von Neumann (N, S, E, W). Las celdas vivas
 * nunca mueren.
 *
 * Partiendo de una sola celda central produce un patrón fractal
 * en forma de diamante cuya población sigue la fórmula:
 *   P(n) = (2/3)(4^n + 2)  para n ≥ 1
 *
 * Índice plano: x * gridHeight + y  (column-major, igual que GridRenderer/GridManager).
 * Soporta grids rectangulares y modo toroidal vía automaton.wrapEdges.
 *
 * Referencia: Ulam (1962), Warburton (1986).
 */
class UlamWarburtonEngine {
    /**
     * @param {CellularAutomaton} automaton
     */
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.generation = 0;

        // Dimensiones actuales del grid (actualizadas en activate())
        this.gridWidth = 0;
        this.gridHeight = 0;

        this.initialized = false;

        // Índices planos (x * gridHeight + y) de las celdas nacidas en el último paso
        this._changedCells = [];
    }

    // ─── Ciclo de vida ──────────────────────────────────────────

    /**
     * Activa el motor. Si el grid ya tiene celdas vivas las respeta como semilla;
     * si está vacío coloca una única celda central en el primer step().
     * @returns {UlamWarburtonEngine} this
     */
    activate() {
        this.gridWidth = this.automaton.gridWidth;
        this.gridHeight = this.automaton.gridHeight;
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;
        this._changedCells.length = 0;

        console.debug(`🔷 Ulam-Warburton activado, ${this.gridWidth}×${this.gridHeight}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        console.debug('🔷 Ulam-Warburton desactivado');
    }

    /**
     * Reinicia los contadores sin modificar el grid.
     * Permite que el coordinador establezca primero el estado
     * (semilla o random) antes de llamar a este método.
     */
    reset() {
        this.generation = 0;
        this.initialized = false;
        this._changedCells.length = 0;
    }

    /**
     * Distribuye celdas vivas aleatoriamente y reinicia contadores.
     * Llamado por automaton.randomize() cuando el modo UW está activo.
     * @param {number} density - Proporción de celdas vivas (0-1)
     */
    randomize(density = 0.35) {
        // Leer dimensiones actuales (pueden haber cambiado si el grid se redimensionó)
        const gw = this.gridWidth || this.automaton.gridWidth;
        const gh = this.gridHeight || this.automaton.gridHeight;

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                this.automaton.grid[x][y] = Math.random() < density ? 1 : 0;
            }
        }
        this.generation = 0;
        this._changedCells.length = 0;
        this.automaton.renderer.markAllDirty();
    }

    // ─── Paso de simulación ─────────────────────────────────────

    /**
     * Avanza una generación.
     *
     * Vecindad Von Neumann ortogonal (N, S, E, W).
     * Con wrapEdges activo los bordes se tratan de forma toroidal.
     *
     * Índice plano: x * gridHeight + y (column-major, igual que GridRenderer).
     *
     * @returns {boolean} true si nacieron celdas; false si el patrón es estable.
     */
    step() {
        if (!this.isActive) return false;

        // Primera ejecución: respetar dibujo del usuario o colocar semilla central.
        if (!this.initialized) {
            if (!this._checkUserSeed()) {
                this._initializeSeed();
            }
            this.initialized = true;
            this.generation = 0;
            return true;
        }

        const gw = this.gridWidth;
        const gh = this.gridHeight;
        const grid = this.automaton.grid;
        const wrap = this.automaton.wrapEdges;
        this._changedCells.length = 0;

        // Primera pasada: recoger candidatos SIN modificar el grid,
        // para que el cómputo de vecinos use solo el estado actual.
        const candidates = [];

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y] === 1) continue;

                // Contar vecinos ortogonales vivos (Von Neumann).
                // Con wrap toroidal todos los bordes participan simétricamente.
                let n = 0;
                if (wrap) {
                    n += grid[(x - 1 + gw) % gw][y];
                    n += grid[(x + 1) % gw][y];
                    n += grid[x][(y - 1 + gh) % gh];
                    n += grid[x][(y + 1) % gh];
                } else {
                    if (x > 0) n += grid[x - 1][y];
                    if (x < gw - 1) n += grid[x + 1][y];
                    if (y > 0) n += grid[x][y - 1];
                    if (y < gh - 1) n += grid[x][y + 1];
                }

                if (n === 1) candidates.push(x * gh + y);
            }
        }

        // Segunda pasada: aplicar nacimientos
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            const x = (idx / gh) | 0;
            const y = idx % gh;
            grid[x][y] = 1;
            this._changedCells.push(idx);
            this.automaton.renderer.markDirtyIndex(idx);
        }

        this.generation++;
        return candidates.length > 0;   // false ⟹ patrón estable
    }

    /**
     * Devuelve los índices planos (x * gridHeight + y) de las celdas
     * nacidas en el último paso, listos para updateActivityAges.
     * @returns {number[]}
     */
    getChangedCells() {
        return this._changedCells;
    }

    // ─── Privados ────────────────────────────────────────────────

    /**
     * Verifica si el grid tiene alguna celda viva dibujada por el usuario.
     * @returns {boolean}
     * @private
     */
    _checkUserSeed() {
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (this.automaton.grid[x][y]) return true;
            }
        }
        return false;
    }

    /**
     * Limpia el grid y coloca una única celda viva en el centro geométrico.
     * @private
     */
    _initializeSeed() {
        const gw = this.gridWidth;
        const gh = this.gridHeight;
        for (let x = 0; x < gw; x++) {
            this.automaton.grid[x].fill(0);
        }
        const cx = (gw / 2) | 0;
        const cy = (gh / 2) | 0;
        this.automaton.grid[cx][cy] = 1;
        this.automaton.renderer.markAllDirty();
    }
}

window.UlamWarburtonEngine = UlamWarburtonEngine;