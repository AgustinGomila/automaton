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

    // ─── WolframEngine ────────────────────────────────────────────────────
    patch(window.WolframEngine?.prototype, 'activate', (_orig) => function (ruleNumber = 30, direction = 'vertical') {
        this.gridWidth = this.automaton?.gridWidth || this.automaton?.gridSize || 200;
        this.gridHeight = this.automaton?.gridHeight || this.automaton?.gridSize || 200;
        this.gridSize = Math.max(this.gridWidth, this.gridHeight);
        this.ruleNumber = Math.max(0, Math.min(255, ruleNumber));
        this.ruleTable = this._generateRuleTable(this.ruleNumber);
        this.direction = direction;
        this.isActive = true;
        this.initialized = false;
        this.generation = 0;
        this.currentRow = 0;
        this.currentCol = 0;
        this._forceReinit = false;
        this._changedCells = [];
        return this;
    });

    patch(window.WolframEngine?.prototype, 'step', (_orig) => function () {
        if (!this.isActive || !this.automaton?.grid) return false;

        // Re-sincronizar si el grid cambió de tamaño
        const curW = this.automaton.gridWidth || this.automaton.gridSize;
        const curH = this.automaton.gridHeight || this.automaton.gridSize;
        if (curW !== this.gridWidth || curH !== this.gridHeight) {
            this.gridWidth = curW;
            this.gridHeight = curH;
            this.initialized = false;
        }

        if (!this.initialized) {
            if (!this._checkUserSeed()) this._initializeSeed();
            else {
                this.direction === 'vertical'
                    ? (this.currentRow = 1)
                    : (this.currentCol = 1);
            }
            this.initialized = true;
            this.generation = 0;
        }

        if (this.direction === 'vertical' && this.currentRow >= this.gridHeight) return false;
        if (this.direction === 'horizontal' && this.currentCol >= this.gridWidth) return false;

        this._changedCells.length = 0;

        if (this.direction === 'vertical') {
            const y = this.currentRow;
            for (let x = 0; x < this.gridWidth; x++) {
                const left = x > 0 ? this.automaton.grid[x - 1][y - 1] : 0;
                const center = this.automaton.grid[x][y - 1];
                const right = x < this.gridWidth - 1 ? this.automaton.grid[x + 1][y - 1] : 0;
                const ns = this.ruleTable[(left << 2) | (center << 1) | right];
                if (ns) {
                    this.automaton.grid[x][y] = 1;
                    this.automaton.renderer.markDirty(x, y);
                    this._changedCells.push(x * this.gridHeight + y);
                }
            }
            this.currentRow++;
        } else {
            const x = this.currentCol;
            for (let y = 0; y < this.gridHeight; y++) {
                const top = y > 0 ? this.automaton.grid[x - 1][y - 1] : 0;
                const center = this.automaton.grid[x - 1][y];
                const bottom = y < this.gridHeight - 1 ? this.automaton.grid[x - 1][y + 1] : 0;
                const ns = this.ruleTable[(top << 2) | (center << 1) | bottom];
                if (ns) {
                    this.automaton.grid[x][y] = 1;
                    this.automaton.renderer.markDirty(x, y);
                    this._changedCells.push(x * this.gridHeight + y);
                }
            }
            this.currentCol++;
        }

        this.generation++;
        this.automaton.generation = this.generation;
        return true;
    });

    patch(window.WolframEngine?.prototype, '_initializeSeed', (_orig) => function () {
        if (!this.automaton?.grid) return;
        if (this.initialized && !this._forceReinit) return;

        const w = this.gridWidth || this.automaton.gridWidth || 200;
        const h = this.gridHeight || this.automaton.gridHeight || 200;

        if (this.direction === 'vertical') {
            for (let x = 0; x < w; x++) {
                if (this.automaton.grid[x]) this.automaton.grid[x][0] = 0;
            }
            const cx = (w / 2) | 0;
            if (this.automaton.grid[cx]) this.automaton.grid[cx][0] = 1;
            this.currentRow = 1;
        } else {
            if (!this.automaton.grid[0]) return;
            for (let y = 0; y < h; y++) this.automaton.grid[0][y] = 0;
            this.automaton.grid[0][(h / 2) | 0] = 1;
            this.currentCol = 1;
        }

        this.initialized = true;
        this._forceReinit = false;
        if (typeof this.automaton._markAllDirty === 'function') this.automaton._markAllDirty();
    });

    patch(window.WolframEngine?.prototype, '_checkUserSeed', (_orig) => function () {
        const w = this.gridWidth || this.automaton.gridWidth || 200;
        const h = this.gridHeight || this.automaton.gridHeight || 200;
        if (this.direction === 'vertical') {
            for (let x = 0; x < w; x++) if (this.automaton.grid[x]?.[0]) return true;
        } else {
            for (let y = 0; y < h; y++) if (this.automaton.grid[0]?.[y]) return true;
        }
        return false;
    });

    patch(window.WolframEngine?.prototype, 'getInfo', (_orig) => function () {
        return {
            active: this.isActive,
            rule: this.ruleNumber,
            direction: this.direction,
            progress: this.direction === 'vertical' ? this.currentRow : this.currentCol,
            max: this.direction === 'vertical'
                ? (this.gridHeight || this.gridSize)
                : (this.gridWidth || this.gridSize),
            generation: this.generation
        };
    });

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