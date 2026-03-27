/**
 * WireWorldEngine — Motor del autómata WireWorld (Brian Silverman, 1987).
 *
 * 4 estados:
 *   0 — Empty     (vacío, siempre permanece vacío)
 *   1 — Head      (cabeza de electrón → Tail en el siguiente paso)
 *   2 — Tail      (cola de electrón  → Conductor en el siguiente paso)
 *   3 — Conductor (→ Head si tiene 1 o 2 vecinos Head; si no → Conductor)
 *
 * Vecindario: Moore (8 vecinos), configurable con wrap toroidal.
 *
 * ─── Fuentes de verdad ─────────────────────────────────────────────────
 * stateGrid[][] almacena el estado 0..3 por celda.
 * grid[][] es un reflejo binario: 0 si Empty, 1 si cualquier otro estado.
 * colorProvider inyecta el color de cada estado al renderer.
 *
 * ─── Convención de índice plano ────────────────────────────────────────
 * Column-major:  index = x * gridHeight + y
 * Consistente con GridRenderer y GridManager.
 *
 * ─── Grids rectangulares ───────────────────────────────────────────────
 * Lee gridWidth/gridHeight desde _ctx en cada operación; no guarda
 * snapshots de dimensiones, por lo que funciona tras resize.
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
     *   ctx.gridWidth  → ancho actual del grid
     *   ctx.gridHeight → alto actual del grid
     *   ctx.renderer   → GridRenderer activo
     *   ctx.wrapEdges  → boolean, modo toroidal
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
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        this.stateGrid = Array.from({length: gw}, () => new Uint8Array(gh));
        this._nextState = Array.from({length: gw}, () => new Uint8Array(gh));

        // Las celdas vivas del grid actual se promueven a Conductor.
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

    /**
     * Reinicia el grid a estado vacío, conservando la regla activa.
     * Verifica ambas dimensiones al detectar si el grid fue redimensionado;
     * solo comprobar el ancho no es suficiente si únicamente cambió el alto.
     */
    reset() {
        if (!this.isActive) return;
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        // Recrear buffers si cualquiera de las dimensiones cambió
        if (!this.stateGrid || this.stateGrid.length !== gw || this.stateGrid[0]?.length !== gh) {
            this.stateGrid = Array.from({length: gw}, () => new Uint8Array(gh));
            this._nextState = Array.from({length: gw}, () => new Uint8Array(gh));
        } else {
            for (let x = 0; x < gw; x++) this.stateGrid[x].fill(0);
        }

        for (let x = 0; x < gw; x++) grid[x].fill(0);

        this.generation = 0;
        this._changedIndices = [];
        this._ctx.renderer.markAllDirty();
    }

    /**
     * Randomiza con una distribución realista para WireWorld:
     * conductores dispersos (~30%), muy pocas cabezas (~2%), resto vacío.
     * No se colocan colas — se forman naturalmente al avanzar.
     * @param {number} density — densidad base (0-1), ajustada internamente
     */
    randomize(density = 0.35) {
        if (!this.stateGrid) return;
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;
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
                grid[x][y] = s > 0 ? 1 : 0;
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
     * Dos pasadas para consistencia temporal:
     *   1. Calcular el siguiente estado de cada celda en _nextState.
     *   2. Aplicar _nextState → stateGrid y registrar cambios.
     *
     * Vecindario Moore (8 vecinos). Con wrapEdges activo los bordes
     * se tratan de forma toroidal; el cambio aplica en caliente.
     */
    step() {
        if (!this.isActive) return false;

        const {gridWidth: gw, gridHeight: gh, grid, wrapEdges: wrap} = this._ctx;
        const state = this.stateGrid;
        const renderer = this._ctx.renderer;
        const changed = this._changedIndices;
        changed.length = 0;

        // Asegurar buffer correcto en ambas dimensiones
        if (!this._nextState || this._nextState.length !== gw || this._nextState[0]?.length !== gh) {
            this._nextState = Array.from({length: gw}, () => new Uint8Array(gh));
        }
        const next = this._nextState;

        // Pasada 1 — calcular siguiente estado
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
                    // CONDUCTOR: contar cabezas en vecindad Moore (8).
                    // El early-exit a heads=3 evita trabajo innecesario; la regla
                    // solo distingue entre 0, 1-2 y ≥3 cabezas.
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

        // Pasada 2 — aplicar y registrar cambios
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
     */
    setStateAt(x, y, state) {
        const {gridWidth: gw, gridHeight: gh} = this._ctx;
        if (x < 0 || x >= gw || y < 0 || y >= gh) return false;

        if (this.stateGrid[x][y] === state) return false;

        this.stateGrid[x][y] = state;
        this._ctx.grid[x][y] = state > 0 ? 1 : 0;

        // Índice plano column-major: x * gridHeight + y
        this._ctx.renderer.markDirtyIndex(x * gh + y);
        return true;
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
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;
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

        for (let x = 0; x < gw; x++) {
            const col = dst[x];
            const gcol = grid[x];
            for (let y = 0; y < gh; y++) gcol[y] = col[y] > 0 ? 1 : 0;
        }
    }

    // =========================================
    // SINCRONIZACIÓN TRAS MOVE/PASTE
    // =========================================

    /**
     * Reconstruye stateGrid a partir del estado actual de grid[][].
     *   - grid=0                      → stateGrid = EMPTY
     *   - grid=1 y stateGrid=EMPTY    → stateGrid = CONDUCTOR
     *   - grid=1 y stateGrid>0        → se preserva el estado real
     * Llamado por endDrag() en canvas-controller tras un move/paste.
     */
    syncFromGrid() {
        if (!this.stateGrid) return;
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y] === 0) {
                    this.stateGrid[x][y] = WireWorldEngine.EMPTY;
                } else if (this.stateGrid[x][y] === WireWorldEngine.EMPTY) {
                    this.stateGrid[x][y] = WireWorldEngine.CONDUCTOR;
                }
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
     */
    _colorProvider(cellIndex) {
        if (!this.stateGrid) return null;
        const gh = this._ctx.gridHeight;
        const x = (cellIndex / gh) | 0;
        const y = cellIndex % gh;
        return WireWorldEngine.COLORS[this.stateGrid[x]?.[y]] ?? null;
    }
}

window.WireWorldEngine = WireWorldEngine;