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
        this.gridSize = 0;
        this.initialized = false;

        // Índices planos (x*size + y) de las celdas nacidas en el último paso
        this._changedCells = [];
    }

    // ─── Ciclo de vida ──────────────────────────────────────────

    /**
     * Activa el motor. Si el grid ya tiene celdas vivas las respeta como semilla;
     * si está vacío coloca una única celda central en el primer step().
     * @returns {UlamWarburtonEngine} this
     */
    activate() {
        this.gridSize = this.automaton.gridSize;
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;
        this._changedCells.length = 0;

        console.debug(`🔷 Ulam-Warburton activado, tamaño ${this.gridSize}`);
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
        const size = this.gridSize || this.automaton.gridSize;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
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

        const size = this.gridSize;
        const grid = this.automaton.grid;
        this._changedCells.length = 0;

        // Primera pasada: recoger candidatos SIN modificar el grid,
        // para que el cómputo de vecinos use solo el estado actual.
        const candidates = [];

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (grid[x][y] === 1) continue;

                // Contar vecinos ortogonales vivos (Von Neumann)
                let n = 0;
                if (x > 0) n += grid[x - 1][y];
                if (x < size - 1) n += grid[x + 1][y];
                if (y > 0) n += grid[x][y - 1];
                if (y < size - 1) n += grid[x][y + 1];

                if (n === 1) candidates.push(x * size + y);
            }
        }

        // Segunda pasada: aplicar nacimientos
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            const x = (idx / size) | 0;
            const y = idx % size;
            grid[x][y] = 1;
            this._changedCells.push(idx);
            this.automaton.renderer.markDirtyIndex(idx);
        }

        this.generation++;
        return candidates.length > 0;   // false ⟹ patrón estable
    }

    /**
     * Devuelve los índices planos (x*size + y) de las celdas
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
        const size = this.gridSize;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (this.automaton.grid[x][y]) return true;
            }
        }
        return false;
    }

    /**
     * Limpia el grid y coloca una única celda viva en el centro.
     * @private
     */
    _initializeSeed() {
        const size = this.gridSize;
        for (let x = 0; x < size; x++) {
            this.automaton.grid[x].fill(0);
        }
        const cx = (size / 2) | 0;
        const cy = (size / 2) | 0;
        this.automaton.grid[cx][cy] = 1;
        this.automaton.renderer.markAllDirty();
    }
}

window.UlamWarburtonEngine = UlamWarburtonEngine;