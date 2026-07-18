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
 * ─── Población ─────────────────────────────────────────────────────────
 * La población reportada (getPopulation) cuenta TODAS las celdas en estado
 * distinto de 0 —vivas y moribundas—, igual que MCell y que los demás
 * motores multiestado (WireWorld, Langton). grid[][] en cambio solo refleja
 * el estado 1: es la superficie de edición binaria, no la métrica.
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

        // Lookup tables indexadas por nº de vecinos en estado 1 (Moore r1 → 0..8).
        // Sustituyen el `new Set(...)` que se asignaba en cada step() y el Set.has()
        // del hot-loop por un acceso a Uint8Array. Se reconstruyen en activate().
        this._birthLUT = new Uint8Array(9);
        this._survivalLUT = new Uint8Array(9);

        // Grids de estados 0..C-1 (column-major, igual que ctx.grid)
        this.stateGrid = null;
        this._backGrid = null;

        this.generation = 0;
        this._changedCells = [];      // índices planos x*gridHeight+y

        // Población: celdas con estado ≠ 0. Mantenida exacta por los caminos
        // internos (activate/reset/randomize/step); las ediciones externas
        // que mutan stateGrid la refrescan vía recountPopulation().
        this._population = 0;

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

        this._birthLUT.fill(0);
        this._survivalLUT.fill(0);
        for (const b of this.birth) if (b >= 0 && b <= 8) this._birthLUT[b] = 1;
        for (const s of this.survival) if (s >= 0 && s <= 8) this._survivalLUT[s] = 1;

        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        this.stateGrid = this._allocGrid(gw, gh);
        this._backGrid = this._allocGrid(gw, gh);

        // Importar grid binario actual → estado 1
        let pop = 0;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                const s = grid[x][y] ? 1 : 0;
                this.stateGrid[x][y] = s;
                pop += s;
            }
        }
        this._population = pop;

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

        let pop = 0;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                const s = grid[x][y] ? 1 : 0;
                this.stateGrid[x][y] = s;
                pop += s;
            }
        }
        this._population = pop;
        this._ctx.renderer.markAllDirty();
    }

    /**
     * Randomiza con estados 0 y 1 (los estados moribundos emergen solos).
     * @param {number} density — proporción de celdas vivas (0-1)
     */
    randomize(density = 0.35) {
        if (!this.stateGrid) return;
        const {gridWidth: gw, gridHeight: gh, grid} = this._ctx;

        let pop = 0;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                const s = Math.random() < density ? 1 : 0;
                this.stateGrid[x][y] = s;
                grid[x][y] = s;
                pop += s;
            }
        }
        this._population = pop;

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
        const bLUT = this._birthLUT;
        const sLUT = this._survivalLUT;
        const renderer = this._ctx.renderer;

        this._changedCells.length = 0;
        let pop = 0;

        for (let x = 0; x < gw; x++) {
            const xm = wrap ? (x === 0 ? gw - 1 : x - 1) : x - 1;
            const xp = wrap ? (x === gw - 1 ? 0 : x + 1) : x + 1;

            for (let y = 0; y < gh; y++) {
                const ym = wrap ? (y === 0 ? gh - 1 : y - 1) : y - 1;
                const yp = wrap ? (y === gh - 1 ? 0 : y + 1) : y + 1;

                const cur = sg[x][y];
                let next;

                if (cur === 0 || cur === 1) {
                    // Ambos estados usan el mismo conteo de vecinos en estado 1.
                    // Extraído en helper para eliminar la duplicación del bloque original.
                    const n = this._countAliveNeighbors(sg, gw, gh, x, xm, xp, y, ym, yp);
                    next = cur === 0
                        ? bLUT[n]
                        : (sLUT[n] ? 1 : (C > 2 ? 2 : 0));
                } else {
                    // Moribundo: avanzar al siguiente estado de envejecimiento
                    next = (cur + 1) % C;
                }

                back[x][y] = next;
                if (next !== 0) pop++;

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
        this._population = pop;
        this.generation++;

        return true;
    }

    getChangedCells() {
        return this._changedCells;
    }

    // =========================================
    // POBLACIÓN
    // =========================================

    /**
     * Población actual: celdas en cualquier estado ≠ 0 (vivas + moribundas).
     * O(1). Exacta tras activate/reset/randomize/step; las ediciones que
     * mutan stateGrid desde fuera del motor deben refrescarla con
     * recountPopulation().
     */
    getPopulation() {
        return this._population;
    }

    /**
     * Recuenta la población escaneando stateGrid y actualiza el contador.
     * O(N); pensado para los caminos de edición (paste/import/flood-fill)
     * que escriben stateGrid directamente.
     */
    recountPopulation() {
        if (!this.stateGrid) return 0;
        const {gridWidth: gw, gridHeight: gh} = this._ctx;
        let pop = 0;
        for (let x = 0; x < gw; x++) {
            const col = this.stateGrid[x];
            for (let y = 0; y < gh; y++) {
                if (col[y] !== 0) pop++;
            }
        }
        this._population = pop;
        return pop;
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

export {GenerationsEngine};