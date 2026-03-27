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
 *     que los engines cargados a demanda (Wolfram, RD2D, UW, Langton,
 *     WireWorld) reciban el parche al estar disponibles.
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

    // ─── GenerationsEngine ────────────────────────────────────────────────
    patch(window.GenerationsEngine?.prototype, 'step', (_orig) => function () {
        if (!this.isActive || !this.stateGrid) return false;

        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const sg = this.stateGrid;
        const back = this._backGrid;
        const grid = this._ctx.grid;
        const wrap = this._ctx.wrapEdges;
        const C = this.numStates;
        const bSet = new Set(this.birth);
        const sSet = new Set(this.survival);
        const renderer = this._ctx.renderer;

        this._changedCells.length = 0;
        let changed = false;

        for (let x = 0; x < width; x++) {
            const xm = wrap ? (x === 0 ? width - 1 : x - 1) : x - 1;
            const xp = wrap ? (x === width - 1 ? 0 : x + 1) : x + 1;

            for (let y = 0; y < height; y++) {
                const ym = wrap ? (y === 0 ? height - 1 : y - 1) : y - 1;
                const yp = wrap ? (y === height - 1 ? 0 : y + 1) : y + 1;

                const cur = sg[x][y];
                let next;

                if (cur === 0) {
                    let n = 0;
                    if (xm >= 0 && xm < width) {
                        if (ym >= 0 && ym < height && sg[xm][ym] === 1) n++;
                        if (sg[xm][y] === 1) n++;
                        if (yp >= 0 && yp < height && sg[xm][yp] === 1) n++;
                    }
                    if (ym >= 0 && ym < height && sg[x][ym] === 1) n++;
                    if (yp >= 0 && yp < height && sg[x][yp] === 1) n++;
                    if (xp >= 0 && xp < width) {
                        if (ym >= 0 && ym < height && sg[xp][ym] === 1) n++;
                        if (sg[xp][y] === 1) n++;
                        if (yp >= 0 && yp < height && sg[xp][yp] === 1) n++;
                    }
                    next = bSet.has(n) ? 1 : 0;

                } else if (cur === 1) {
                    let n = 0;
                    if (xm >= 0 && xm < width) {
                        if (ym >= 0 && ym < height && sg[xm][ym] === 1) n++;
                        if (sg[xm][y] === 1) n++;
                        if (yp >= 0 && yp < height && sg[xm][yp] === 1) n++;
                    }
                    if (ym >= 0 && ym < height && sg[x][ym] === 1) n++;
                    if (yp >= 0 && yp < height && sg[x][yp] === 1) n++;
                    if (xp >= 0 && xp < width) {
                        if (ym >= 0 && ym < height && sg[xp][ym] === 1) n++;
                        if (sg[xp][y] === 1) n++;
                        if (yp >= 0 && yp < height && sg[xp][yp] === 1) n++;
                    }
                    next = sSet.has(n) ? 1 : (C > 2 ? 2 : 0);

                } else {
                    next = (cur + 1) % C;
                }

                back[x][y] = next;

                if (next !== cur) {
                    changed = true;
                    const idx = x * height + y;
                    this._changedCells.push(idx);
                    grid[x][y] = next === 1 ? 1 : 0;
                    renderer.markDirtyIndex(idx);
                }
            }
        }

        this._backGrid = sg;
        this.stateGrid = back;
        this.generation++;
        return true;
    });

    /**
     * _colorProvider — decodifica el índice plano usando gridHeight.
     * Bug original: usaba `this._ctx.gridSize` (= Math.max(w,h)).
     * En grids rectangulares eso desplaza x e y, pintando cada celda
     * en la posición equivocada.
     */
    patch(window.GenerationsEngine?.prototype, '_colorProvider', (_orig) => function (cellIndex) {
        if (!this.stateGrid) return null;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const x = (cellIndex / height) | 0;
        const y = cellIndex % height;
        return this._palette[this.stateGrid[x]?.[y]] ?? null;
    });

    /**
     * activate — asigna stateGrid con dimensiones width × height.
     * Bug original: _allocGrid(size) creaba un grid cuadrado size × size.
     */
    patch(window.GenerationsEngine?.prototype, 'activate', (_orig) => function ({birth, survival, numStates} = {}) {
        this.birth = birth ?? [3];
        this.survival = survival ?? [2, 3];
        this.numStates = Math.max(2, Math.min(numStates ?? 2, 256));

        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;

        this.stateGrid = this._allocGridRect(width, height);
        this._backGrid = this._allocGridRect(width, height);

        // Importar grid binario actual → estado 1
        const src = this._ctx.grid;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                this.stateGrid[x][y] = src[x]?.[y] ? 1 : 0;
            }
        }

        this._buildPalette();
        this._ctx.renderer.setColorProvider(this._colorProvider.bind(this));
        this._ctx.renderer.markAllDirty();

        this.generation = 0;
        this._changedCells = [];
        this.isActive = true;

        console.debug(`🌀 Generations activado: B${this.birth.join('')}/S${this.survival.join('')}/C${this.numStates} [${width}×${height}]`);
        return this;
    });

    /** reset — reinicia stateGrid respetando width × height. */
    patch(window.GenerationsEngine?.prototype, 'reset', (_orig) => function () {
        this.generation = 0;
        this._changedCells = [];
        if (!this.stateGrid) return;

        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;

        // Recrear si las dimensiones cambiaron (ej. tras resize del grid)
        if (this.stateGrid.length !== width || this.stateGrid[0]?.length !== height) {
            this.stateGrid = this._allocGridRect(width, height);
            this._backGrid = this._allocGridRect(width, height);
        } else {
            for (let x = 0; x < width; x++) this.stateGrid[x].fill(0);
        }

        const src = this._ctx.grid;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                this.stateGrid[x][y] = src[x]?.[y] ? 1 : 0;
            }
        }
        this._ctx.renderer.markAllDirty();
    });

    /** randomize — distribuye estados sobre width × height. */
    patch(window.GenerationsEngine?.prototype, 'randomize', (_orig) => function (density = 0.35) {
        if (!this.stateGrid) return;
        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const grid = this._ctx.grid;

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const s = Math.random() < density ? 1 : 0;
                this.stateGrid[x][y] = s;
                grid[x][y] = s ? 1 : 0;
            }
        }

        this.generation = 0;
        this._changedCells = [];
        this._ctx.renderer.markAllDirty();
    });

    /** syncFromGrid — reconstruye stateGrid respetando width × height. */
    patch(window.GenerationsEngine?.prototype, 'syncFromGrid', (_orig) => function () {
        if (!this.stateGrid) return;
        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const grid = this._ctx.grid;

        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                if (grid[x]?.[y]) {
                    this.stateGrid[x][y] = 1;
                } else if (this.stateGrid[x]?.[y] !== 0) {
                    this.stateGrid[x][y] = 0;
                }
            }
        }
    });

    // ─── LangtonEngine ────────────────────────────────────────────────────
    patch(window.LangtonEngine?.prototype, 'step', (_orig) => function () {
        if (!this.isActive) return false;

        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const grid = this._ctx.grid;
        const renderer = this._ctx.renderer;
        const wrap = this._ctx.wrapEdges;
        const dirs = this._DIRS;
        const changed = this._changedIndices;
        changed.length = 0;

        for (const ant of this.ants) {
            const {x, y} = ant;
            const state = this.stateGrid[x][y];
            ant.dir = this._rotate(ant.dir, this.ruleTable[state]);

            const newState = (state + 1) % this.numColors;
            this.stateGrid[x][y] = newState;
            grid[x][y] = newState > 0 ? 1 : 0;

            const idx = x * height + y;
            changed.push(idx);
            renderer.markDirtyIndex(idx);

            const d = dirs[ant.dir];
            let nx = x + d.dx;
            let ny = y + d.dy;
            if (wrap) {
                nx = (nx + width) % width;
                ny = (ny + height) % height;
            } else {
                nx = Math.max(0, Math.min(width - 1, nx));
                ny = Math.max(0, Math.min(height - 1, ny));
            }
            ant.x = nx;
            ant.y = ny;
        }

        this.generation++;
        return true;
    });

    patch(window.LangtonEngine?.prototype, 'shift', (_orig) => function (dx, dy) {
        if (!this.stateGrid) return;
        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const src = this.stateGrid;
        const dst = Array.from({length: width}, () => new Uint8Array(height));

        for (let x = 0; x < width; x++) {
            const srcX = ((x - dx) % width + width) % width;
            const srcCol = src[srcX];
            const dstCol = dst[x];
            for (let y = 0; y < height; y++) {
                dstCol[y] = srcCol[((y - dy) % height + height) % height];
            }
        }
        this.stateGrid = dst;

        for (const ant of this.ants) {
            ant.x = ((ant.x + dx) % width + width) % width;
            ant.y = ((ant.y + dy) % height + height) % height;
        }

        const grid = this._ctx.grid;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                grid[x][y] = dst[x][y] > 0 ? 1 : 0;
            }
        }
        for (const ant of this.ants) grid[ant.x][ant.y] = 1;
    });

    // ─── WireWorldEngine ──────────────────────────────────────────────────
    patch(window.WireWorldEngine?.prototype, 'step', (_orig) => function () {
        if (!this.isActive) return false;

        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const state = this.stateGrid;
        const grid = this._ctx.grid;
        const renderer = this._ctx.renderer;
        const wrap = this._ctx.wrapEdges;
        const changed = this._changedIndices;
        changed.length = 0;

        if (!this._nextState || this._nextState.length !== width) {
            this._nextState = Array.from({length: width}, () => new Uint8Array(height));
        }
        const next = this._nextState;

        for (let x = 0; x < width; x++) {
            const col = state[x];
            const ncol = next[x];
            for (let y = 0; y < height; y++) {
                const s = col[y];
                if (s === 0) {
                    ncol[y] = 0;
                } else if (s === 1) {
                    ncol[y] = 2;
                }  // HEAD → TAIL
                else if (s === 2) {
                    ncol[y] = 3;
                }  // TAIL → CONDUCTOR
                else {
                    let heads = 0;
                    for (let dx = -1; dx <= 1 && heads < 3; dx++) {
                        let nx = x + dx;
                        if (wrap) nx = (nx + width) % width;
                        else if (nx < 0 || nx >= width) continue;
                        const nrow = state[nx];
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            let ny = y + dy;
                            if (wrap) ny = (ny + height) % height;
                            else if (ny < 0 || ny >= height) continue;
                            if (nrow[ny] === 1) heads++;
                        }
                    }
                    ncol[y] = (heads === 1 || heads === 2) ? 1 : 3;
                }
            }
        }

        for (let x = 0; x < width; x++) {
            const col = state[x];
            const ncol = next[x];
            const gcol = grid[x];
            for (let y = 0; y < height; y++) {
                const ns = ncol[y];
                if (col[y] !== ns) {
                    col[y] = ns;
                    gcol[y] = ns > 0 ? 1 : 0;
                    const idx = x * height + y;
                    changed.push(idx);
                    renderer.markDirtyIndex(idx);
                }
            }
        }

        this.generation++;
        return true;
    });

    patch(window.WireWorldEngine?.prototype, 'shift', (_orig) => function (dx, dy) {
        if (!this.stateGrid) return;
        const width = this._ctx.gridWidth || this._ctx.gridSize;
        const height = this._ctx.gridHeight || this._ctx.gridSize;
        const src = this.stateGrid;
        const dst = Array.from({length: width}, () => new Uint8Array(height));

        for (let x = 0; x < width; x++) {
            const srcX = ((x - dx) % width + width) % width;
            const srcCol = src[srcX];
            const dstCol = dst[x];
            for (let y = 0; y < height; y++) {
                dstCol[y] = srcCol[((y - dy) % height + height) % height];
            }
        }
        this.stateGrid = dst;

        const grid = this._ctx.grid;
        for (let x = 0; x < width; x++) {
            const col = dst[x];
            const gcol = grid[x];
            for (let y = 0; y < height; y++) gcol[y] = col[y] > 0 ? 1 : 0;
        }
    });

    // ─── UlamWarburtonEngine ──────────────────────────────────────────────
    patch(window.UlamWarburtonEngine?.prototype, 'step', (_orig) => function () {
        if (!this.isActive) return false;

        if (!this.initialized) {
            if (!this._checkUserSeed()) this._initializeSeed();
            this.initialized = true;
            this.generation = 0;
            return true;
        }

        const automaton = this.automaton;
        const width = automaton.gridWidth || automaton.gridSize;
        const height = automaton.gridHeight || automaton.gridSize;
        const grid = automaton.grid;
        const wrap = automaton.wrapEdges;
        this._changedCells.length = 0;

        // Primera pasada: recoger candidatos SIN modificar el grid,
        // para que el cómputo de vecinos use solo el estado actual.
        const candidates = [];
        for (let x = 0; x < width; x++) {
            const col = grid[x];
            for (let y = 0; y < height; y++) {
                if (col[y] === 1) continue;

                // Vecindad Von Neumann (N, S, E, W).
                // Con wrap toroidal todos los bordes participan simétricamente.
                let n = 0;
                if (wrap) {
                    n += grid[(x - 1 + width) % width][y];
                    n += grid[(x + 1) % width][y];
                    n += col[(y - 1 + height) % height];
                    n += col[(y + 1) % height];
                } else {
                    if (x > 0) n += grid[x - 1][y];
                    if (x < width - 1) n += grid[x + 1][y];
                    if (y > 0) n += col[y - 1];
                    if (y < height - 1) n += col[y + 1];
                }

                if (n === 1) candidates.push(x * height + y);
            }
        }

        // Segunda pasada: aplicar nacimientos
        for (let i = 0; i < candidates.length; i++) {
            const idx = candidates[i];
            const x = (idx / height) | 0;
            const y = idx % height;
            grid[x][y] = 1;
            this._changedCells.push(idx);
            automaton.renderer.markDirtyIndex(idx);
        }

        this.generation++;
        return candidates.length > 0;
    });

    patch(window.UlamWarburtonEngine?.prototype, '_checkUserSeed', (_orig) => function () {
        const width = this.automaton.gridWidth || this.automaton.gridSize;
        const height = this.automaton.gridHeight || this.automaton.gridSize;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                if (this.automaton.grid[x][y]) return true;
            }
        }
        return false;
    });

    patch(window.UlamWarburtonEngine?.prototype, '_initializeSeed', (_orig) => function () {
        const width = this.automaton.gridWidth || this.automaton.gridSize;
        const height = this.automaton.gridHeight || this.automaton.gridSize;
        for (let x = 0; x < width; x++) this.automaton.grid[x].fill(0);
        this.automaton.grid[(width / 2) | 0][(height / 2) | 0] = 1;
        this.automaton.renderer.markAllDirty();
    });

    patch(window.UlamWarburtonEngine?.prototype, 'randomize', (_orig) => function (density = 0.35) {
        const width = this.automaton.gridWidth || this.automaton.gridSize;
        const height = this.automaton.gridHeight || this.automaton.gridSize;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                this.automaton.grid[x][y] = Math.random() < density ? 1 : 0;
            }
        }
        this.generation = 0;
        this._changedCells.length = 0;
        this.automaton.renderer.markAllDirty();
    });

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

    // ─── Helpers comunes ──────────────────────────────────────────────────
    /**
     * _allocGridRect — crea un grid width × height (column-major).
     * Se añade a GenerationsEngine como método de instancia accesible
     * desde todos los métodos parcheados que necesiten allocar buffers.
     */
    if (window.GenerationsEngine?.prototype &&
        !window.GenerationsEngine.prototype._allocGridRect) {
        window.GenerationsEngine.prototype._allocGridRect = function (width, height) {
            const g = new Array(width);
            for (let x = 0; x < width; x++) g[x] = new Uint8Array(height);
            return g;
        };
    }
};

// Aplicar inmediatamente para engines estáticos (GenerationsEngine está en index.html)
window.patchEnginesForRectangularGrids();