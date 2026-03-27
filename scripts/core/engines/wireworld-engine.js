/**
 * WireWorldEngine - Motor del autómata WireWorld (Brian Silverman, 1987).
 *
 * 4 estados:
 *   0 — Empty     (vacío, siempre permanece vacío)
 *   1 — Head      (cabeza de electrón, → Tail)
 *   2 — Tail      (cola de electrón, → Conductor)
 *   3 — Conductor (conductor; → Head si tiene 1 o 2 vecinos Head, si no → Conductor)
 *
 * Vecindario: Moore (8 vecinos), configurable con wrap toroidal.
 *
 * Fuente de verdad: stateGrid[][] (Uint8Array[gridWidth][gridHeight]).
 * grid[][] refleja vivo/muerto (0 si Empty, 1 si cualquier otro estado).
 * colorProvider inyecta el color de cada estado al renderer.
 *
 * Índice plano: x * gridHeight + y  (column-major, igual que GridRenderer/GridManager).
 * Soporta grids rectangulares: ctx.gridWidth y ctx.gridHeight se usan en lugar
 * del legacy ctx.gridSize (Math.max) para evitar desplazamientos de coordenadas
 * en grillas no cuadradas.
 *
 * Referencia: Dewdney (1990), Scientific American.
 */
class WireWorldEngine {

    // Colores canónicos de WireWorld
    static COLORS = [
        null,       // 0 Empty     — el renderer usa el fondo
        '#60a5fa',  // 1 Head      — azul eléctrico
        '#f97316',  // 2 Tail      — naranja
        '#eab308',  // 3 Conductor — amarillo
    ];

    static EMPTY = 0;
    static HEAD = 1;
    static TAIL = 2;
    static CONDUCTOR = 3;

    /**
     * @param {Object} ctx - Contexto inyectado por SpecialEngineManager
     *   ctx.grid       → automaton.grid (Uint8Array[])
     *   ctx.gridWidth  → ancho del grid en celdas
     *   ctx.gridHeight → alto del grid en celdas
     *   ctx.renderer   → GridRenderer activo
     *   ctx.wrapEdges  → boolean
     */
    constructor(ctx) {
        this._ctx = ctx;

        this.isActive = false;
        this.generation = 0;

        this.stateGrid = null;  // Uint8Array[gridWidth][gridHeight] — estado 0..3
        this._nextState = null;  // buffer de doble paso
        this._changedIndices = [];
    }

    // =========================================
    // CICLO DE VIDA
    // =========================================

    activate() {
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        const grid = this._ctx.grid;

        this.stateGrid = Array.from({length: gw}, () => new Uint8Array(gh));
        this._nextState = Array.from({length: gw}, () => new Uint8Array(gh));

        // Las celdas vivas del grid actual se promueven a Conductor (3).
        // Permite entrar desde cualquier otro modo sin perder el dibujo.
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y]) {
                    this.stateGrid[x][y] = WireWorldEngine.CONDUCTOR;
                    // grid[x][y] ya es 1, no hace falta tocarlo
                }
            }
        }

        this.generation = 0;
        this._changedIndices = [];

        this._ctx.renderer.setColorProvider(this._colorProvider.bind(this));
        this._ctx.renderer.markAllDirty();

        this.isActive = true;
        console.debug('⚡ WireWorld activado');
        return this;
    }

    deactivate() {
        this.isActive = false;
        this._ctx.renderer?.setColorProvider(null);
        console.debug('⚡ WireWorld desactivado');
    }

    reset() {
        if (!this.isActive) return;
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;

        // Si stateGrid tiene un tamaño distinto al grid actual (puede ocurrir tras
        // redimensionado del grid), recrearlo en lugar de intentar limpiar columnas
        // inexistentes, lo que causaría TypeError al llamar .fill() sobre undefined.
        if (!this.stateGrid || this.stateGrid.length !== gw || this.stateGrid[0]?.length !== gh) {
            this.stateGrid = Array.from({length: gw}, () => new Uint8Array(gh));
            this._nextState = Array.from({length: gw}, () => new Uint8Array(gh));
        } else {
            for (let x = 0; x < gw; x++) {
                this.stateGrid[x].fill(0);
            }
        }

        // Limpiar grid principal siempre
        for (let x = 0; x < gw; x++) {
            this._ctx.grid[x].fill(0);
        }

        this.generation = 0;
        this._changedIndices = [];
        this._ctx.renderer.markAllDirty();
    }

    /**
     * Randomiza el grid con una distribución realista para WireWorld:
     * conductores dispersos (~30%), muy pocas cabezas (~2%), resto vacío.
     * No se colocan colas (se forman naturalmente al avanzar).
     * @param {number} density - densidad base (0-1), ajustada internamente
     */
    randomize(density = 0.35) {
        if (!this.stateGrid) return;
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        const conductorProb = density * 0.9;
        const headProb = density * 0.05;

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                const r = Math.random();
                let s;
                if (r < headProb) s = WireWorldEngine.HEAD;
                else if (r < headProb + conductorProb) s = WireWorldEngine.CONDUCTOR;
                else s = WireWorldEngine.EMPTY;

                this.stateGrid[x][y] = s;
                this._ctx.grid[x][y] = s > 0 ? 1 : 0;
            }
        }

        this.generation = 0;
        this._changedIndices = [];
        this._ctx.renderer.markAllDirty();
    }

    // =========================================
    // PASO DE SIMULACIÓN
    // =========================================

    /**
     * Avanza una generación.
     *
     * Vecindario Moore (8 vecinos), con wrap toroidal opcional.
     * Índice plano: x * gridHeight + y (column-major, igual que GridRenderer).
     */
    step() {
        if (!this.isActive) return false;

        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        const state = this.stateGrid;
        const grid = this._ctx.grid;
        const renderer = this._ctx.renderer;
        const wrap = this._ctx.wrapEdges;
        const changed = this._changedIndices;
        changed.length = 0;

        // Asegurar buffer del tamaño correcto
        if (!this._nextState || this._nextState.length !== gw || this._nextState[0]?.length !== gh) {
            this._nextState = Array.from({length: gw}, () => new Uint8Array(gh));
        }
        const next = this._nextState;

        // Calcular siguiente estado para cada celda
        for (let x = 0; x < gw; x++) {
            const col = state[x];
            const ncol = next[x];
            for (let y = 0; y < gh; y++) {
                const s = col[y];
                if (s === WireWorldEngine.EMPTY) {
                    ncol[y] = WireWorldEngine.EMPTY;
                } else if (s === WireWorldEngine.HEAD) {
                    ncol[y] = WireWorldEngine.TAIL;
                } else if (s === WireWorldEngine.TAIL) {
                    ncol[y] = WireWorldEngine.CONDUCTOR;
                } else {
                    // CONDUCTOR: contar cabezas en vecindad Moore (8)
                    let heads = 0;
                    for (let ddx = -1; ddx <= 1 && heads < 3; ddx++) {
                        let nx = x + ddx;
                        if (wrap) nx = (nx + gw) % gw;
                        else if (nx < 0 || nx >= gw) continue;

                        const nrow = state[nx];
                        for (let ddy = -1; ddy <= 1; ddy++) {
                            if (ddx === 0 && ddy === 0) continue;
                            let ny = y + ddy;
                            if (wrap) ny = (ny + gh) % gh;
                            else if (ny < 0 || ny >= gh) continue;
                            if (nrow[ny] === WireWorldEngine.HEAD) heads++;
                        }
                    }
                    ncol[y] = (heads === 1 || heads === 2)
                        ? WireWorldEngine.HEAD
                        : WireWorldEngine.CONDUCTOR;
                }
            }
        }

        // Aplicar y registrar cambios
        for (let x = 0; x < gw; x++) {
            const col = state[x];
            const ncol = next[x];
            const gcol = grid[x];
            for (let y = 0; y < gh; y++) {
                const ns = ncol[y];
                if (col[y] !== ns) {
                    col[y] = ns;
                    gcol[y] = ns > 0 ? 1 : 0;
                    // Índice plano column-major: x * gridHeight + y
                    const idx = x * gh + y;
                    changed.push(idx);
                    renderer.markDirtyIndex(idx);
                }
            }
        }

        this.generation++;
        return true;
    }

    getChangedCells() {
        return this._changedIndices;
    }

    // =========================================
    // DIBUJO MANUAL
    // =========================================

    /**
     * Coloca el estado indicado en la celda (x, y) y marca dirty.
     * Usado por canvas-controller para pintar con el pincel activo.
     *
     * Índice plano: x * gridHeight + y (column-major, igual que GridRenderer).
     */
    setStateAt(x, y, state) {
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        if (x < 0 || x >= gw || y < 0 || y >= gh) return false;

        if (this.stateGrid[x][y] === state) return false;

        this.stateGrid[x][y] = state;
        this._ctx.grid[x][y] = state > 0 ? 1 : 0;

        // Índice plano column-major: x * gridHeight + y
        const idx = x * gh + y;
        this._ctx.renderer.markDirtyIndex(idx);
        return true;
    }

    // =========================================
    // DESPLAZAMIENTO TOROIDAL (pan)
    // =========================================

    shift(dx, dy) {
        if (!this.stateGrid) return;
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        const src = this.stateGrid;
        const dst = Array.from({length: gw}, () => new Uint8Array(gh));

        for (let x = 0; x < gw; x++) {
            const srcX = ((x - dx) % gw + gw) % gw;
            const srcCol = src[srcX];
            const dstCol = dst[x];
            for (let y = 0; y < gh; y++) {
                dstCol[y] = srcCol[((y - dy) % gh + gh) % gh];
            }
        }

        this.stateGrid = dst;

        const grid = this._ctx.grid;
        for (let x = 0; x < gw; x++) {
            const col = dst[x];
            const gcol = grid[x];
            for (let y = 0; y < gh; y++) {
                gcol[y] = col[y] > 0 ? 1 : 0;
            }
        }
    }

    // =========================================
    // SINCRONIZACIÓN TRAS MOVE/PASTE
    // =========================================

    /**
     * Reconstruye stateGrid a partir del estado actual de grid[][].
     * - Celda viva (grid=1) con stateGrid=0 → asignada como Conductor (3)
     * - Celda muerta (grid=0) → stateGrid=0
     * - Celda viva con stateGrid>0 → se preserva el estado
     * Llamado por endDrag() en canvas-controller tras un move/paste.
     */
    syncFromGrid() {
        if (!this.stateGrid) return;
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        const grid = this._ctx.grid;

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y] === 0) {
                    this.stateGrid[x][y] = WireWorldEngine.EMPTY;
                } else if (this.stateGrid[x][y] === WireWorldEngine.EMPTY) {
                    this.stateGrid[x][y] = WireWorldEngine.CONDUCTOR;
                }
                // Si grid=1 y stateGrid>0, se preserva el estado real
            }
        }
    }

    // =========================================
    // INFO
    // =========================================

    getInfo() {
        return {};
    }

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Proveedor de color para GridRenderer.setColorProvider().
     * Recibe un índice plano (x * gridHeight + y) y devuelve color CSS o null.
     *
     * IMPORTANTE: la descomposición usa gridHeight como divisor, igual que
     * GridRenderer, para que la coordenada x/y corresponda a la celda correcta.
     */
    _colorProvider(cellIndex) {
        if (!this.stateGrid) return null;
        const gh = this._ctx.gridHeight;
        const x = (cellIndex / gh) | 0;
        const y = cellIndex % gh;
        return WireWorldEngine.COLORS[this.stateGrid[x][y]] ?? null;
    }
}

window.WireWorldEngine = WireWorldEngine;