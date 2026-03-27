/**
 * engine-rectangular-patches.js
 *
 * Parchea los motores especiales para soportar grids rectangulares.
 * Cada engine usa this._ctx.gridWidth / gridHeight en lugar de gridSize.
 * Índice plano: x * height + y  (column-major, consistente con GridManager).
 *
 * ─── DISEÑO ────────────────────────────────────────────────────────────────
 * La función window.patchEnginesForRectangularGrids() es idempotente:
 *   • Usa el flag `_rectPatched_<method>` en cada prototipo para evitar
 *     doble-aplicación si se invoca varias veces.
 *   • SpecialEngineManager._loadScript() la llama tras cada carga lazy para
 *     que los engines cargados a demanda (Wolfram, RD2D)
 *   • GenerationsEngine se carga de forma estática en index.html y recibe
 *     el parche en la llamada inicial al final de este archivo.
 */

window.patchEnginesForRectangularGrids = function () {
    'use strict';

    /**
     * Parchea un método de forma idempotente.
     * Si el flag `_rectPatched_<method>` ya existe en el prototipo, no hace nada.
     */
    function patch(proto, method, factory) {
        if (!proto || typeof proto[method] !== 'function') return;
        const flag = `_rectPatched_${method}`;
        if (proto[flag]) return;
        proto[method] = factory(proto[method]);
        proto[flag] = true;
    }

    // ─── RD2DEngine ───────────────────────────────────────────────────────
    patch(window.RD2DEngine?.prototype, 'activate', (_orig) => function () {
        this.gridWidth = this.automaton.gridWidth || this.automaton.gridSize;
        this.gridHeight = this.automaton.gridHeight || this.automaton.gridSize;
        this.gridSize = Math.max(this.gridWidth, this.gridHeight);
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;
        this._forceReinit = false;
        this._initStateGrid();
        return this;
    });

    patch(window.RD2DEngine?.prototype, '_initStateGrid', (_orig) => function () {
        const w = this.gridWidth || this.gridSize;
        const h = this.gridHeight || this.gridSize;
        this.stateGrid = this._allocGrid(w, h);
        this._backStateGrid = this._allocGrid(w, h);
    });

    patch(window.RD2DEngine?.prototype, '_allocGrid', (_orig) => function (w, h) {
        h = (h !== undefined) ? h : w;
        const g = new Array(w);
        for (let x = 0; x < w; x++) g[x] = new Uint8Array(h);
        return g;
    });

    patch(window.RD2DEngine?.prototype, '_checkUserSeed', (_orig) => function () {
        const w = this.gridWidth || this.gridSize;
        const h = this.gridHeight || this.gridSize;
        for (let x = 0; x < w; x++) {
            if (!this.automaton.grid[x]) continue;
            for (let y = 0; y < h; y++) {
                if (this.automaton.grid[x][y]) return true;
            }
        }
        return false;
    });

    patch(window.RD2DEngine?.prototype, '_getState', (_orig) => function (x, y) {
        const w = this.gridWidth || this.gridSize;
        const h = this.gridHeight || this.gridSize;
        if (this.automaton.wrapEdges) {
            const wx = ((x % w) + w) % w;
            const wy = ((y % h) + h) % h;
            return this.stateGrid[wx]?.[wy] || 0;
        }
        if (x < 0 || x >= w || y < 0 || y >= h) return 0;
        return this.stateGrid[x]?.[y] || 0;
    });

    patch(window.RD2DEngine?.prototype, '_syncToAutomatonGrid', (_orig) => function () {
        const w = this.gridWidth || this.gridSize;
        const h = this.gridHeight || this.gridSize;
        for (let x = 0; x < w; x++) {
            if (!this.automaton.grid[x]) continue;
            for (let y = 0; y < h; y++) {
                const isAlive = this.stateGrid[x]?.[y] !== 0;
                if (this.automaton.grid[x][y] !== (isAlive ? 1 : 0)) {
                    this.automaton.grid[x][y] = isAlive ? 1 : 0;
                    this.automaton.renderer.markDirty(x, y);
                }
            }
        }
    });

    patch(window.RD2DEngine?.prototype, '_initializeDefaultSeed', (_orig) => function () {
        const w = this.gridWidth || this.gridSize;
        const h = this.gridHeight || this.gridSize;
        const cx = (w / 2) | 0;
        const cy = (h / 2) | 0;
        this._initStateGrid();
        for (let i = -2; i <= 2; i++) {
            const vy = cy + i;
            if (vy >= 0 && vy < h) {
                this.stateGrid[cx][vy] = 15;
                this.automaton.grid[cx][vy] = 1;
            }
            const hx = cx + i;
            if (hx >= 0 && hx < w && i !== 0) {
                this.stateGrid[hx][cy] = 15;
                this.automaton.grid[hx][cy] = 1;
            }
        }
        this.generation = 0;
        this.initialized = true;
        this._forceReinit = false;
    });

    patch(window.RD2DEngine?.prototype, 'step', (_orig) => function () {
        if (!this.isActive || !this.automaton?.grid) return false;

        const curW = this.automaton.gridWidth || this.automaton.gridSize;
        const curH = this.automaton.gridHeight || this.automaton.gridSize;
        if (curW !== (this.gridWidth || this.gridSize) ||
            curH !== (this.gridHeight || this.gridSize)) {
            this.gridWidth = curW;
            this.gridHeight = curH;
            this.gridSize = Math.max(curW, curH);
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
            this._changedCells = [];
            const w = this.gridWidth || this.gridSize;
            const h = this.gridHeight || this.gridSize;
            for (let x = 0; x < w; x++) {
                for (let y = 0; y < h; y++) {
                    if (this.stateGrid[x][y] !== 0) this._changedCells.push(x * h + y);
                }
            }
            return true;
        }

        const w = this.gridWidth || this.gridSize;
        const h = this.gridHeight || this.gridSize;
        const back = this._backStateGrid;
        this._changedCells.length = 0;
        let changed = false;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const ns = this._getState(x, y - 1) ^ this._getState(x, y + 1)
                    ^ this._getState(x + 1, y) ^ this._getState(x - 1, y);
                back[x][y] = ns;
                if (ns !== this.stateGrid[x][y]) {
                    changed = true;
                    this._changedCells.push(x * h + y);
                }
            }
        }

        this._backStateGrid = this.stateGrid;
        this.stateGrid = back;
        this.generation++;
        this._syncToAutomatonGrid();
        return changed;
    });

};

// Aplicar inmediatamente para engines estáticos (GenerationsEngine está en index.html)
window.patchEnginesForRectangularGrids();