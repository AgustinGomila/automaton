/**
 * GenerationsEngine — Motor de autómatas celulares tipo "Generaciones" (B/S/C).
 *
 * Extiende el modelo Life-like binario añadiendo C estados (C ≥ 2):
 *   - Estado 0:       muerto (vacío)
 *   - Estado 1:       vivo activo — aplica reglas B y S
 *   - Estados 2..C-1: moribundo — decrementan 1 por generación hasta llegar a 0
 *
 * Solo el estado 1 cuenta como vecino vivo para las reglas B/S.
 * El envejecimiento (2→3→…→0) es determinista y no depende de vecinos.
 *
 * ─── Convención de índice plano ────────────────────────────────────────
 * Column-major:  index = x * gridHeight + y
 * Consistente con GridRenderer y GridManager.
 *
 * ─── Grids rectangulares ───────────────────────────────────────────────
 * Lee gridWidth/gridHeight desde _ctx en cada operación; no guarda
 * snapshots de dimensiones, por lo que funciona tras resize.
 *
 * Notación Golly: S/B/C  (ej. "25/03467/6" o "03467/25/6" según variante)
 * Notación canónica usada internamente: B.../S.../C
 *
 * Referencia: Dewdney (1988), Bays (1987), MCell documentation.
 */
class GenerationsEngine {

    /**
     * @param {Object} ctx  Contexto inyectado por SpecialEngineManager
     *   ctx.grid       → automaton.grid (Uint8Array[])
     *   ctx.gridWidth  → ancho actual del grid
     *   ctx.gridHeight → alto actual del grid
     *   ctx.renderer   → GridRenderer activo
     *   ctx.wrapEdges  → boolean, modo toroidal
     */
    constructor(ctx) {
        this._ctx = ctx;
        this.isActive = false;

        // Regla
        this.birth = [3];
        this.survival = [2, 3];
        this.numStates = 2;           // C — número total de estados (mín 2)

        // Tablas de lookup pre-computadas (Uint8Array[9]): evitan new Set() en cada step.
        // Índice = número de vecinos vivos (0–8), valor = 0|1.
        this._birthTable = new Uint8Array(9);
        this._survivalTable = new Uint8Array(9);

        // Grids de estados 0..C-1 (column-major, igual que ctx.grid)
        this.stateGrid = null;
        this._backGrid = null;

        this.generation = 0;
        this._changedCells = [];      // índices planos x*gridHeight+y

        // Paleta de colores: _palette[state] → string CSS | null
        this._palette = [];
    }

    // =========================================
    // CICLO DE VIDA
    // =========================================

    /**
     * Activa el motor con la configuración dada.
     * Respeta el dibujo actual del usuario (celdas vivas → estado 1).
     * @param {Object} options
     * @param {number[]} options.birth
     * @param {number[]} options.survival
     * @param {number}   options.numStates — C, mínimo 2
     */
    activate({birth, survival, numStates} = {}) {
        this.birth = birth ?? [3];
        this.survival = survival ?? [2, 3];
        this.numStates = Math.max(2, Math.min(numStates ?? 2, 256));

        // Pre-computar tablas de lookup: O(1) por celda en step() en lugar de Set.has()
        this._birthTable.fill(0);
        this._survivalTable.fill(0);
        for (const n of this.birth) this._birthTable[n] = 1;
        for (const n of this.survival) this._survivalTable[n] = 1;

        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        this.stateGrid = this._allocGrid(gw, gh);
        this._backGrid = this._allocGrid(gw, gh);

        // Importar grid binario actual → estado 1
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                this.stateGrid[x][y] = grid[x][y] ? 1 : 0;
            }
        }

        this._buildPalette();
        this._ctx.renderer.setColorProvider(this._colorProvider.bind(this));
        this._ctx.renderer.markAllDirty();

        this.generation = 0;
        this._changedCells = [];
        this.isActive = true;

        console.debug(`🌀 Generations activado: B${this.birth.join('')}/S${this.survival.join('')}/C${this.numStates} [${gw}×${gh}]`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.stateGrid = null;
        this._backGrid = null;
        this._ctx.renderer?.setColorProvider(null);
        console.debug('🌀 Generations desactivado');
    }

    /**
     * Reinicia stateGrid re-importando el grid binario actual.
     * Si las dimensiones cambiaron (ej. tras resizeGrid), recrea los buffers.
     */
    reset() {
        this.generation = 0;
        this._changedCells = [];
        if (!this.stateGrid) return;

        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        // Recrear buffers si cualquiera de las dimensiones cambió
        if (this.stateGrid.length !== gw || this.stateGrid[0]?.length !== gh) {
            this.stateGrid = this._allocGrid(gw, gh);
            this._backGrid = this._allocGrid(gw, gh);
        } else {
            for (let x = 0; x < gw; x++) this.stateGrid[x].fill(0);
        }

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                this.stateGrid[x][y] = grid[x][y] ? 1 : 0;
            }
        }
        this._ctx.renderer.markAllDirty();
    }

    /**
     * Randomiza con estados 0 y 1 (los estados moribundos emergen solos).
     * @param {number} density — proporción de celdas vivas (0-1)
     */
    randomize(density = 0.35) {
        if (!this.stateGrid) return;
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                const s = Math.random() < density ? 1 : 0;
                this.stateGrid[x][y] = s;
                grid[x][y] = s;
            }
        }

        this.generation = 0;
        this._changedCells = [];
        this._ctx.renderer.markAllDirty();
    }

    // =========================================
    // PASO DE SIMULACIÓN
    // =========================================

    /**
     * Avanza una generación con doble buffer (swap sin allocaciones).
     *
     * Regla por estado actual (cur):
     *   cur=0 → nace si n vecinos estado-1 ∈ birth
     *   cur=1 → sobrevive si n vecinos estado-1 ∈ survival; si no → 2 (o 0 si C=2)
     *   cur≥2 → moribundo: avanza al siguiente estado ((cur+1) % C)
     *
     * @returns {boolean} true siempre — Generations no tiene estado estable detectado.
     */
    step() {
        if (!this.isActive || !this.stateGrid) return false;

        const {gridWidth: gw, gridHeight: gh, grid, wrapEdges: wrap} = this._ctx;
        const sg = this.stateGrid;
        const back = this._backGrid;
        const C = this.numStates;
        // Usar tablas pre-computadas en lugar de new Set() por step
        const bTable = this._birthTable;
        const sTable = this._survivalTable;
        const renderer = this._ctx.renderer;

        this._changedCells.length = 0;

        for (let x = 0; x < gw; x++) {
            const xm = wrap ? (x === 0 ? gw - 1 : x - 1) : x - 1;
            const xp = wrap ? (x === gw - 1 ? 0 : x + 1) : x + 1;

            for (let y = 0; y < gh; y++) {
                const ym = wrap ? (y === 0 ? gh - 1 : y - 1) : y - 1;
                const yp = wrap ? (y === gh - 1 ? 0 : y + 1) : y + 1;

                const cur = sg[x][y];
                let next;

                if (cur === 0 || cur === 1) {
                    const n = this._countAliveNeighbors(sg, gw, gh, x, xm, xp, y, ym, yp);
                    next = cur === 0
                        ? bTable[n]
                        : (sTable[n] ? 1 : (C > 2 ? 2 : 0));
                } else {
                    // Moribundo: avanzar al siguiente estado de envejecimiento
                    next = (cur + 1) % C;
                }

                back[x][y] = next;

                if (next !== cur) {
                    const idx = x * gh + y;
                    this._changedCells.push(idx);
                    // Solo estado 1 es "vivo" para el resto del sistema
                    grid[x][y] = next === 1 ? 1 : 0;
                    renderer.markDirtyIndex(idx);
                }
            }
        }

        // Swap de buffers sin allocaciones
        this._backGrid = sg;
        this.stateGrid = back;
        this.generation++;

        return true;
    }

    getChangedCells() {
        return this._changedCells;
    }

    // =========================================
    // SINCRONIZACIÓN TRAS EDICIÓN MANUAL
    // =========================================

    /**
     * Reconstruye stateGrid desde grid[][] tras paste/move.
     * Celdas vivas → estado 1; celdas muertas → estado 0 (borra moribundos).
     */
    syncFromGrid() {
        if (!this.stateGrid) return;
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y]) {
                    this.stateGrid[x][y] = 1;
                } else if (this.stateGrid[x][y] !== 0) {
                    // Solo limpiar si era moribundo — no tocar celdas que ya eran 0
                    this.stateGrid[x][y] = 0;
                }
            }
        }
    }

    // =========================================
    // INFO
    // =========================================

    getInfo() {
        return {
            birth: this.birth,
            survival: this.survival,
            numStates: this.numStates,
            generation: this.generation,
            ruleString: `B${this.birth.join('')}/S${this.survival.join('')}/C${this.numStates}`
        };
    }

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Aloca un grid column-major Uint8Array[w][h], inicializado a cero.
     * @param {number} w - ancho (número de columnas)
     * @param {number} h - alto (número de filas por columna); por defecto = w
     */
    _allocGrid(w, h = w) {
        const g = new Array(w);
        for (let x = 0; x < w; x++) g[x] = new Uint8Array(h);
        return g;
    }

    /**
     * Cuenta los vecinos en estado 1 (Moore, 8 vecinos) de la celda (x, y).
     *
     * Los índices xm/xp/ym/yp están pre-calculados con wrap por el caller;
     * los bounds checks excluyen vecinos fuera del grid en modo no-toroidal.
     *
     * Extraído de step() para eliminar la duplicación idéntica entre los
     * bloques cur=0 y cur=1, que usaban exactamente el mismo cómputo.
     *
     * @param {Uint8Array[]} sg  - stateGrid
     * @param {number} gw       - gridWidth (para bounds check)
     * @param {number} gh       - gridHeight (para bounds check)
     * @param {number} x        - columna actual
     * @param {number} xm       - columna izquierda (ya wraped o -1 si borde)
     * @param {number} xp       - columna derecha   (ya wraped o gw si borde)
     * @param {number} y        - fila actual
     * @param {number} ym       - fila superior     (ya wraped o -1 si borde)
     * @param {number} yp       - fila inferior     (ya wraped o gh si borde)
     * @returns {number} número de vecinos en estado 1
     */
    _countAliveNeighbors(sg, gw, gh, x, xm, xp, y, ym, yp) {
        let n = 0;
        // Columna izquierda (xm)
        if (xm >= 0 && xm < gw) {
            if (ym >= 0 && ym < gh && sg[xm][ym] === 1) n++;
            if (sg[xm][y] === 1) n++;
            if (yp >= 0 && yp < gh && sg[xm][yp] === 1) n++;
        }
        // Columna central (x) — excluyendo (x,y) que es la celda actual
        if (ym >= 0 && ym < gh && sg[x][ym] === 1) n++;
        if (yp >= 0 && yp < gh && sg[x][yp] === 1) n++;
        // Columna derecha (xp)
        if (xp >= 0 && xp < gw) {
            if (ym >= 0 && ym < gh && sg[xp][ym] === 1) n++;
            if (sg[xp][y] === 1) n++;
            if (yp >= 0 && yp < gh && sg[xp][yp] === 1) n++;
        }
        return n;
    }

    /**
     * Construye la paleta de colores para C estados.
     * Estado 0   → null (fondo del renderer)
     * Estado 1   → verde vivo (#059669)
     * Estados 2..C-1 → rampa continua verde→amarillo→naranja→rojo con
     *   luminosidad decreciente: el más reciente es el más cálido,
     *   el más antiguo se acerca al negro.
     */
    _buildPalette() {
        this._palette = new Array(this.numStates);
        this._palette[0] = null;  // muerto — renderer usa fondo

        if (this.numStates === 2) {
            this._palette[1] = null;  // usa color alive estándar del renderer
            return;
        }

        this._palette[1] = '#059669';  // verde vivo estándar

        const dying = this.numStates - 2;
        for (let i = 0; i < dying; i++) {
            const t = dying === 1 ? 0 : i / (dying - 1);  // 0=recién muerto, 1=casi negro
            const hue = Math.round(60 * (1 - t));             // 60°→0° (amarillo→rojo)
            const lit = Math.round(50 * (1 - t * 0.8));       // 50%→10%
            this._palette[2 + i] = `hsl(${hue}, 90%, ${lit}%)`;
        }
    }

    /**
     * Proveedor de color para GridRenderer.setColorProvider().
     * Recibe un índice plano (x * gridHeight + y) y devuelve color CSS o null.
     */
    _colorProvider(cellIndex) {
        if (!this.stateGrid) return null;
        const gh = this._ctx.gridHeight;
        const x = (cellIndex / gh) | 0;
        const y = cellIndex % gh;
        return this._palette[this.stateGrid[x]?.[y]] ?? null;
    }
}

window.GenerationsEngine = GenerationsEngine;