/**
 * scripts/core/engines/ulam-warburton-engine.js
 *
 * UlamWarburtonEngine — Motor del Autómata de Ulam-Warburton.
 *
 * Regla: una celda muerta nace si tiene EXACTAMENTE 1 vecino vivo
 * en la vecindad de Von Neumann (N, S, E, W). Las celdas vivas nunca mueren.
 *
 * ─── Algoritmo — Frontier tracking O(perímetro) ────────────────────────
 * En lugar de escanear los N² píxeles en cada paso, el motor mantiene un
 * Set de candidatos: celdas muertas adyacentes a celdas vivas. Cada step()
 * evalúa solo ese subconjunto.
 *
 *   Versión anterior:  O(N²)        — full-scan siempre
 *   Esta versión:      O(perímetro) — crece como O(generation)
 *
 * Para grids 1000×1000 en generaciones intermedias el perímetro es
 * típicamente < 5% de N², resultando en ~20-40× menos trabajo por paso.
 *
 * El frontier se construye en la inicialización y se actualiza
 * incrementalmente: cuando una celda nace, sus vecinas muertas se añaden.
 *
 * ─── Convención de índice plano ────────────────────────────────────────
 * Column-major:  index = x * gridHeight + y
 * Consistente con GridRenderer y GridManager.
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

        /**
         * Conjunto de índices planos de celdas muertas candidatas a nacer.
         * Se actualiza incrementalmente tras cada nacimiento.
         * @type {Set<number>}
         */
        this._frontier = new Set();

        /** Índices planos de celdas nacidas en el último paso. */
        this._changedCells = [];
    }

    // ─── Ciclo de vida ────────────────────────────────────────────────────

    activate() {
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;
        this._frontier.clear();
        this._changedCells.length = 0;

        const {gridWidth, gridHeight} = this.automaton;
        console.debug(`🔷 Ulam-Warburton activado, ${gridWidth}×${gridHeight}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this._frontier.clear();
        console.debug('🔷 Ulam-Warburton desactivado');
    }

    /**
     * Reinicia contadores. El frontier se reconstruirá en el próximo step().
     */
    reset() {
        this.generation = 0;
        this.initialized = false;
        this._frontier.clear();
        this._changedCells.length = 0;
    }

    randomize(density = 0.35) {
        const {gridWidth: gw, gridHeight: gh, grid} = this.automaton;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                grid[x][y] = Math.random() < density ? 1 : 0;
            }
        }
        this.generation = 0;
        this.initialized = false;           // fuerza rebuild del frontier
        this._frontier.clear();
        this._changedCells.length = 0;
        this.automaton.renderer.markAllDirty();
    }

    // ─── Paso de simulación ───────────────────────────────────────────────

    /**
     * Avanza una generación usando frontier tracking.
     *
     * Init (primer step o post-reset):
     *   - Coloca semilla central o respeta dibujo del usuario.
     *   - Construye el frontier desde todas las celdas vivas.
     *
     * Pasos siguientes:
     *   1. Evaluar solo las celdas del frontier (no todo el grid).
     *   2. Recolectar nacimientos (n === 1 vecino) sin modificar grid.
     *   3. Aplicar nacimientos y actualizar frontier incrementalmente.
     *
     * @returns {boolean} true si nacieron celdas; false si el patrón es estable.
     */
    step() {
        if (!this.isActive) return false;

        const {gridWidth: gw, gridHeight: gh, grid, wrapEdges: wrap} = this.automaton;
        const renderer = this.automaton.renderer;

        if (!this.initialized) {
            if (!this._checkUserSeed()) this._initializeSeed();
            this._buildFrontier(gw, gh, grid, wrap);
            this.initialized = true;
            this.generation = 0;
            return true;
        }

        this._changedCells.length = 0;

        // ── Pasada 1: evaluar candidatos del frontier ─────────────────────
        // Recolectamos sin modificar el grid (nacimientos simultáneos).
        const births = [];
        for (const idx of this._frontier) {
            const x = (idx / gh) | 0;
            const y = idx % gh;

            let n = 0;
            if (wrap) {
                n += grid[x === 0 ? gw - 1 : x - 1][y];
                n += grid[x === gw - 1 ? 0 : x + 1][y];
                n += grid[x][y === 0 ? gh - 1 : y - 1];
                n += grid[x][y === gh - 1 ? 0 : y + 1];
            } else {
                if (x > 0) n += grid[x - 1][y];
                if (x < gw - 1) n += grid[x + 1][y];
                if (y > 0) n += grid[x][y - 1];
                if (y < gh - 1) n += grid[x][y + 1];
            }

            if (n === 1) births.push(idx);
        }

        if (births.length === 0) {
            this.generation++;
            return false;   // patrón estable
        }

        // ── Pasada 2: aplicar nacimientos y actualizar frontier ───────────
        for (let i = 0; i < births.length; i++) {
            const idx = births[i];
            const x = (idx / gh) | 0;
            const y = idx % gh;

            grid[x][y] = 1;
            this._frontier.delete(idx);     // ya está viva: sale del frontier
            this._changedCells.push(idx);
            renderer.markDirtyIndex(idx);

            // Las vecinas muertas pasan a ser nuevos candidatos
            this._addToFrontier(x - 1, y, gw, gh, grid, wrap);
            this._addToFrontier(x + 1, y, gw, gh, grid, wrap);
            this._addToFrontier(x, y - 1, gw, gh, grid, wrap);
            this._addToFrontier(x, y + 1, gw, gh, grid, wrap);
        }

        this.generation++;
        return true;
    }

    /** @returns {number[]} Índices planos de celdas nacidas en el último paso. */
    getChangedCells() {
        return this._changedCells;
    }

    // ─── Privados ─────────────────────────────────────────────────────────

    /**
     * Construye el frontier completo escaneando todas las celdas vivas.
     * Solo se invoca en la inicialización; luego se mantiene incrementalmente.
     */
    _buildFrontier(gw, gh, grid, wrap) {
        this._frontier.clear();
        for (let x = 0; x < gw; x++) {
            const col = grid[x];
            for (let y = 0; y < gh; y++) {
                if (col[y] !== 1) continue;
                this._addToFrontier(x - 1, y, gw, gh, grid, wrap);
                this._addToFrontier(x + 1, y, gw, gh, grid, wrap);
                this._addToFrontier(x, y - 1, gw, gh, grid, wrap);
                this._addToFrontier(x, y + 1, gw, gh, grid, wrap);
            }
        }
    }

    /**
     * Agrega (nx, ny) al frontier si es una celda muerta válida.
     * Aplica wrap toroidal o descarta si está fuera de bounds.
     */
    _addToFrontier(nx, ny, gw, gh, grid, wrap) {
        if (wrap) {
            nx = ((nx % gw) + gw) % gw;
            ny = ((ny % gh) + gh) % gh;
        } else {
            if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) return;
        }
        if (grid[nx][ny] === 0) {
            this._frontier.add(nx * gh + ny);
        }
    }

    /** @returns {boolean} true si el grid tiene alguna celda viva. */
    _checkUserSeed() {
        const {gridWidth: gw, gridHeight: gh, grid} = this.automaton;
        for (let x = 0; x < gw; x++) {
            const col = grid[x];
            for (let y = 0; y < gh; y++) {
                if (col[y]) return true;
            }
        }
        return false;
    }

    /** Limpia el grid y coloca una única celda viva en el centro geométrico. */
    _initializeSeed() {
        const {gridWidth: gw, gridHeight: gh, grid} = this.automaton;
        for (let x = 0; x < gw; x++) grid[x].fill(0);
        grid[(gw / 2) | 0][(gh / 2) | 0] = 1;
        this.automaton.renderer.markAllDirty();
    }
}

export {UlamWarburtonEngine};