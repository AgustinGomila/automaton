/**
 * UlamWarburtonEngine — Motor del Autómata de Ulam-Warburton.
 *
 * Regla: una celda muerta nace si tiene EXACTAMENTE 1 vecino vivo
 * en la vecindad de Von Neumann (N, S, E, W). Las celdas vivas
 * nunca mueren.
 *
 * Partiendo de una sola celda central produce un patrón fractal
 * en forma de diamante cuya población sigue la fórmula:
 *   P(n) = (2/3)(4^n + 2)  para n ≥ 1
 *
 * ─── Convención de índice plano ────────────────────────────────────────
 * Column-major:  index = x * gridHeight + y
 * Consistente con GridRenderer y GridManager.
 *
 * ─── Grids rectangulares ───────────────────────────────────────────────
 * Lee gridWidth y gridHeight directamente desde el automaton en cada paso,
 * por lo que funciona correctamente con grids no cuadrados y tras resize.
 *
 * ─── Modo toroidal ─────────────────────────────────────────────────────
 * Respeta automaton.wrapEdges en tiempo real: el cambio del toggle
 * aplica desde el siguiente step() sin reinicialización.
 *
 * Referencia: Ulam (1962), Warburton (1986).
 */
class UlamWarburtonEngine {

    /**
     * @param {Object} automaton — contexto inyectado por SpecialEngineManager.
     *   Expone: .grid, .gridWidth, .gridHeight, .renderer, .wrapEdges
     */
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.generation = 0;
        this.initialized = false;

        // Índices planos (x * gridHeight + y) de las celdas nacidas en el último paso.
        this._changedCells = [];
    }

    // ─── Ciclo de vida ────────────────────────────────────────────────────

    /**
     * Activa el motor. Si el grid ya tiene celdas vivas las respeta como semilla;
     * si está vacío coloca una única celda central en el primer step().
     * @returns {UlamWarburtonEngine} this
     */
    activate() {
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;
        this._changedCells.length = 0;

        const {gridWidth, gridHeight} = this.automaton;
        console.debug(`🔷 Ulam-Warburton activado, ${gridWidth}×${gridHeight}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        console.debug('🔷 Ulam-Warburton desactivado');
    }

    /**
     * Reinicia contadores y estado de inicialización.
     * Seguro de llamar tras resizeGrid(): el siguiente step() leerá las
     * dimensiones actuales directamente desde automaton.
     */
    reset() {
        this.generation = 0;
        this.initialized = false;
        this._changedCells.length = 0;
    }

    /**
     * Distribuye celdas vivas aleatoriamente y reinicia contadores.
     * @param {number} density — Proporción de celdas vivas (0–1)
     */
    randomize(density = 0.35) {
        const {gridWidth: gw, gridHeight: gh, grid} = this.automaton;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                grid[x][y] = Math.random() < density ? 1 : 0;
            }
        }
        this.generation = 0;
        this._changedCells.length = 0;
        this.automaton.renderer.markAllDirty();
    }

    // ─── Paso de simulación ───────────────────────────────────────────────

    /**
     * Avanza una generación.
     *
     * Algoritmo en dos pasadas para preservar consistencia temporal:
     *   1. Identificar candidatos (celdas muertas con exactamente 1 vecino vivo)
     *      sin modificar el grid.
     *   2. Aplicar todos los nacimientos a la vez.
     *
     * Vecindad Von Neumann (N, S, E, W). Con wrapEdges activo los bordes
     * se tratan de forma toroidal; el cambio aplica en caliente sin reinicio.
     *
     * @returns {boolean} true si nacieron celdas; false si el patrón es estable.
     */
    step() {
        if (!this.isActive) return false;

        // Primera ejecución: respetar dibujo del usuario o colocar semilla central.
        if (!this.initialized) {
            if (!this._checkUserSeed()) this._initializeSeed();
            this.initialized = true;
            this.generation = 0;
            return true;
        }

        // Leer dimensiones en vivo: funciona correctamente tras resize y con
        // grids rectangulares sin necesidad de reinicializar el engine.
        const {gridWidth: gw, gridHeight: gh, grid, wrapEdges: wrap} = this.automaton;
        const renderer = this.automaton.renderer;
        this._changedCells.length = 0;

        // Pasada 1 — recoger candidatos sin modificar el grid
        const candidates = [];
        for (let x = 0; x < gw; x++) {
            const col = grid[x];   // caché de columna: evita doble lookup
            for (let y = 0; y < gh; y++) {
                if (col[y] === 1) continue;

                let n = 0;
                if (wrap) {
                    n += grid[(x - 1 + gw) % gw][y];
                    n += grid[(x + 1) % gw][y];
                    n += col[(y - 1 + gh) % gh];
                    n += col[(y + 1) % gh];
                } else {
                    if (x > 0) n += grid[x - 1][y];
                    if (x < gw - 1) n += grid[x + 1][y];
                    if (y > 0) n += col[y - 1];
                    if (y < gh - 1) n += col[y + 1];
                }

                if (n === 1) candidates.push(x * gh + y);
            }
        }

        // Pasada 2 — aplicar nacimientos
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            const x = (idx / gh) | 0;
            const y = idx % gh;
            grid[x][y] = 1;
            this._changedCells.push(idx);
            renderer.markDirtyIndex(idx);
        }

        this.generation++;
        return candidates.length > 0;   // false ⟹ patrón estable
    }

    /**
     * Índices planos (x * gridHeight + y) de las celdas nacidas en el último paso.
     * @returns {number[]}
     */
    getChangedCells() {
        return this._changedCells;
    }

    // ─── Privados ─────────────────────────────────────────────────────────

    /**
     * Verifica si el grid tiene alguna celda viva dibujada por el usuario.
     * @returns {boolean}
     */
    _checkUserSeed() {
        const {gridWidth: gw, gridHeight: gh, grid} = this.automaton;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y]) return true;
            }
        }
        return false;
    }

    /**
     * Limpia el grid y coloca una única celda viva en el centro geométrico.
     */
    _initializeSeed() {
        const {gridWidth: gw, gridHeight: gh, grid} = this.automaton;
        for (let x = 0; x < gw; x++) grid[x].fill(0);
        grid[(gw / 2) | 0][(gh / 2) | 0] = 1;
        this.automaton.renderer.markAllDirty();
    }
}

window.UlamWarburtonEngine = UlamWarburtonEngine;