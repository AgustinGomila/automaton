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
 * ─── Frontier tracking ─────────────────────────────────────────────────────
 * En lugar de escanear todo el grid O(gw×gh) en cada step, el engine
 * mantiene un Set<number> (_frontier) con los índices planos de las celdas
 * muertas adyacentes a al menos una celda viva.
 *
 * Complejidad por step: O(|frontier|) en lugar de O(gw×gh).
 * El fractal maduro tiene una frontera delgada ≪ gw×gh:
 *   - Grid 1000×1000 = 1,000,000 celdas
 *   - Frontera a generación 200 ≈ 10,000–30,000 celdas
 *   → speedup esperado: 30–100× respecto al scan completo.
 *
 * El frontier se construye O(N) al inicializar y se actualiza
 * incrementalmente O(nacimientos×4) en cada step.
 *
 * ─── Convención de índice plano ────────────────────────────────────────────
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

        // Índices planos (x * gridHeight + y) de las celdas nacidas en el último paso.
        this._changedCells = [];

        /**
         * Celdas frontera: muertas adyacentes a ≥1 celda viva.
         * null = no inicializado; se construye en el primer step().
         * Actualización incremental O(nacimientos×4) por step.
         * @type {Set<number>|null}
         */
        this._frontier = null;

        // Dimensiones cacheadas para detectar resize y reconstruir el frontier.
        this._lastGw = 0;
        this._lastGh = 0;
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
        this._frontier = null;

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
     * Seguro de llamar tras resizeGrid().
     */
    reset() {
        this.generation = 0;
        this.initialized = false;
        this._changedCells.length = 0;
        this._frontier = null;
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
        this._frontier = null;  // Se reconstruye desde el grid en el próximo step
        this.initialized = true;
        this.automaton.renderer.markAllDirty();
    }

    // ─── Paso de simulación ───────────────────────────────────────────────

    /**
     * Avanza una generación.
     *
     * Con frontier tracking, solo se evalúan las celdas muertas adyacentes
     * a celdas vivas — no todo el grid.
     *
     * Dos pasadas (consistencia temporal):
     *   1. Identificar candidatos en el frontier (n === 1) sin modificar el grid.
     *   2. Aplicar nacimientos y actualizar frontier incrementalmente O(births×4).
     *
     * @returns {boolean} true si nacieron celdas; false si el patrón es estable.
     */
    step() {
        if (!this.isActive) return false;

        const {gridWidth: gw, gridHeight: gh, grid, wrapEdges: wrap} = this.automaton;
        const renderer = this.automaton.renderer;

        // Primera ejecución: semilla inicial → construir frontier
        if (!this.initialized) {
            if (!this._checkUserSeed()) this._initializeSeed();
            this.initialized = true;
            this.generation = 0;
            this._buildFrontier(grid, gw, gh, wrap);
            this._lastGw = gw;
            this._lastGh = gh;
            return true;
        }

        // Detectar resize: reconstruir frontier si cambiaron las dimensiones
        if (gw !== this._lastGw || gh !== this._lastGh) {
            this._frontier = null;
            this._lastGw = gw;
            this._lastGh = gh;
        }

        // Reconstruir frontier si fue invalidado (resize, randomize, reset+draw)
        if (!this._frontier) {
            this._buildFrontier(grid, gw, gh, wrap);
        }

        this._changedCells.length = 0;

        // ── Pasada 1: evaluar solo celdas del frontier ───────────────────────
        const candidates = [];
        for (const idx of this._frontier) {
            const x = (idx / gh) | 0;
            const y = idx % gh;

            // Limpiar entradas obsoletas (celda fue activada externamente)
            if (grid[x][y] === 1) {
                this._frontier?.delete(idx);
                continue;
            }

            let n = 0;
            if (wrap) {
                n += grid[(x - 1 + gw) % gw][y]
                    + grid[(x + 1) % gw][y]
                    + grid[x][(y - 1 + gh) % gh]
                    + grid[x][(y + 1) % gh];
            } else {
                if (x > 0) n += grid[x - 1][y];
                if (x < gw - 1) n += grid[x + 1][y];
                if (y > 0) n += grid[x][y - 1];
                if (y < gh - 1) n += grid[x][y + 1];
            }

            if (n === 1) candidates.push(idx);
        }

        // ── Pasada 2: aplicar nacimientos + actualización incremental ─────────
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            const x = (idx / gh) | 0;
            const y = idx % gh;

            grid[x][y] = 1;
            this._frontier.delete(idx);   // La celda nació — ya no es candidata
            this._changedCells.push(idx);
            renderer.markDirtyIndex(idx);

            // Añadir vecinos muertos al frontier — O(4) por nacimiento
            this._addDeadNeighbors(x, y, grid, gw, gh, wrap);
        }

        this.generation++;
        return candidates.length > 0;
    }

    /**
     * Índices planos (x * gridHeight + y) de las celdas nacidas en el último paso.
     * @returns {number[]}
     */
    getChangedCells() {
        return this._changedCells;
    }

    // ─── Frontier ─────────────────────────────────────────────────────────

    /**
     * Construye el frontier escaneando el grid — O(gw×gh), solo al inicializar.
     * @private
     */
    _buildFrontier(grid, gw, gh, wrap) {
        this._frontier = new Set();
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y] === 1) {
                    this._addDeadNeighbors(x, y, grid, gw, gh, wrap);
                }
            }
        }
    }

    /**
     * Añade los vecinos muertos Von Neumann de (x, y) al frontier.
     * Llamado al nacer una celda: O(4) — núcleo del frontier tracking.
     * @private
     */
    _addDeadNeighbors(x, y, grid, gw, gh, wrap) {
        const f = this._frontier;
        const nb = wrap
            ? [
                [(x - 1 + gw) % gw, y],
                [(x + 1) % gw, y],
                [x, (y - 1 + gh) % gh],
                [x, (y + 1) % gh],
            ]
            : [
                [x - 1, y], [x + 1, y],
                [x, y - 1], [x, y + 1],
            ];

        for (const [nx, ny] of nb) {
            if (nx >= 0 && nx < gw && ny >= 0 && ny < gh && grid[nx][ny] === 0) {
                f.add(nx * gh + ny);
            }
        }
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