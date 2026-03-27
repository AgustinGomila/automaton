/**
 * LangtonEngine - Motor de la Hormiga de Langton y sus generalizaciones.
 *
 * Modelo: agente(s) con posición y dirección que se desplazan sobre un grid
 * de N colores según una tabla de giros (string de L/R/N/U por estado).
 *
 * Diferencia clave respecto a los CA estándar:
 *   - No es sincrónico — cada hormiga actúa secuencialmente en cada paso.
 *   - El grid almacena estados 0..N-1 (no solo 0/1).
 *   - Reutiliza GridManager, GridRenderer, StateManager y el loop del coordinador.
 *
 * Índice plano: x * gridHeight + y  (column-major, igual que GridRenderer/GridManager).
 * Soporta grids rectangulares: ctx.gridWidth y ctx.gridHeight se usan en lugar
 * del legacy ctx.gridSize (Math.max) para evitar desplazamientos de coordenadas
 * en grillas no cuadradas.
 *
 * Reglas estándar:
 *   RL   → Hormiga de Langton clásica (2 colores)
 *   LLRR → 4 colores, crea autopista rápida
 *   RLLR → 4 colores, crecimiento simétrico
 *   LRRL → 4 colores
 *   RLR  → 3 colores, expansión caótica
 *
 * Referencia: Langton (1986), Gale et al. (2002).
 */
class LangtonEngine {

    /**
     * @param {Object} ctx - Contexto inyectado por SpecialEngineManager
     *   ctx.grid       → automaton.grid (Uint8Array[])
     *   ctx.gridWidth  → ancho del grid en celdas
     *   ctx.gridHeight → alto del grid en celdas
     *   ctx.renderer   → GridRenderer activo
     *   ctx.wrapEdges  → boolean (usa el getter del coordinador)
     */
    constructor(ctx) {
        this._ctx = ctx;
        this.isActive = false;

        // Estado del autómata
        this.stateGrid = null;   // Uint8Array[gridWidth][gridHeight] — estado 0..N-1
        this.ants = [];          // [{x, y, dir}]  dir: 0=N 1=E 2=S 3=W
        this.generation = 0;
        this.presetAntCount = 0; // número del slider — para display en header

        // Regla
        this.ruleString = 'RL';
        this.ruleTable = [];     // char[] indexado por estado → 'L'|'R'|'N'|'U'
        this.numColors = 2;

        // Paleta de colores CSS por estado (índice 0 = muerta, no se usa)
        this.colorPalette = [];

        this._changedIndices = [];

        this._DIRS = [
            {dx: 0, dy: -1},  // N
            {dx: 1, dy: 0},   // E
            {dx: 0, dy: 1},   // S
            {dx: -1, dy: 0},  // W
        ];
    }

    // =========================================
    // CICLO DE VIDA
    // =========================================

    /**
     * Activa el motor con la configuración dada.
     * @param {Object} options
     * @param {string}   [options.rule='RL']     - Cadena L/R/N/U
     * @param {number}   [options.antCount=0]    - Número de hormigas predefinidas
     * @param {Array}    [options.ants]          - Posiciones manuales [{x,y,dir}]
     */
    activate(options = {}) {
        this.ruleString = ((options.rule) || 'RL').toUpperCase();
        this.numColors = this.ruleString.length;
        this._parseRule();
        this._buildColorPalette();

        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;

        // Inicializar stateGrid limpio con dimensiones reales del grid
        this.stateGrid = Array.from({length: gw}, () => new Uint8Array(gh));

        // Limpiar grid principal (el renderer lo usa para alive/dead)
        const grid = this._ctx.grid;
        for (let x = 0; x < gw; x++) grid[x].fill(0);

        // Colocar hormigas
        if (options.ants) {
            this.ants = options.ants.map(a => ({...a}));
            this.presetAntCount = this.ants.length;
        } else {
            const count = options.antCount ?? 0;
            this.presetAntCount = count;
            this.ants = this._buildDefaultAnts(gw, gh, count);
        }

        this.generation = 0;
        this._changedIndices = [];

        // Registrar proveedor de color en el renderer
        this._ctx.renderer.setColorProvider(this._colorProvider.bind(this));

        this._ctx.renderer.markAllDirty();
        this.isActive = true;

        console.debug(`🐜 Langton activado: regla="${this.ruleString}" colores=${this.numColors} hormigas=${this.ants.length}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this._ctx.renderer?.setColorProvider(null);
        console.debug('🐜 Langton desactivado');
    }

    /**
     * Coloca hormigas aleatoriamente según la densidad dada.
     * @param {number} density - Proporción de celdas con hormiga (0-1)
     * @returns {number} Cantidad de hormigas colocadas
     */
    randomize(density = 0.35) {
        if (!this.stateGrid) return 0;
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;

        // Limpiar estado previo completamente
        for (let x = 0; x < gw; x++) {
            this.stateGrid[x].fill(0);
            this._ctx.grid[x].fill(0);
        }
        this.ants = [];
        this._changedIndices = [];

        // Distribuir hormigas usando addAnt para mantener consistencia
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (Math.random() < density) {
                    this.addAnt(x, y, Math.floor(Math.random() * 4));
                }
            }
        }

        this.generation = 0;
        this._ctx.renderer.markAllDirty();
        return this.ants.length;
    }

    reset() {
        if (!this.isActive) return;
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;

        // Recrear stateGrid si las dimensiones cambiaron
        if (!this.stateGrid || this.stateGrid.length !== gw || this.stateGrid[0]?.length !== gh) {
            this.stateGrid = Array.from({length: gw}, () => new Uint8Array(gh));
        } else {
            for (let x = 0; x < gw; x++) this.stateGrid[x].fill(0);
        }

        for (let x = 0; x < gw; x++) this._ctx.grid[x].fill(0);

        // Vaciar hormigas — al limpiar se parte de cero, el usuario dibuja las suyas
        this.ants = [];
        this.generation = 0;
        this._changedIndices = [];
        this._ctx.renderer.markAllDirty();
    }

    // =========================================
    // PASO DE SIMULACIÓN
    // =========================================

    /**
     * Avanza una generación (mueve cada hormiga una vez).
     *
     * Índice plano: x * gridHeight + y (column-major, igual que GridRenderer).
     *
     * @returns {boolean} true siempre — la hormiga no se detiene.
     */
    step() {
        if (!this.isActive) return false;

        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        const grid = this._ctx.grid;
        const renderer = this._ctx.renderer;
        const wrap = this._ctx.wrapEdges;
        const dirs = this._DIRS;
        const changed = this._changedIndices;
        changed.length = 0;

        for (const ant of this.ants) {
            const {x, y} = ant;
            const state = this.stateGrid[x][y];
            const turn = this.ruleTable[state];

            // 1. Girar según la regla del estado actual
            ant.dir = this._rotate(ant.dir, turn);

            // 2. Cambiar estado de la celda al siguiente color
            const newState = (state + 1) % this.numColors;
            this.stateGrid[x][y] = newState;
            grid[x][y] = newState > 0 ? 1 : 0;

            // Índice plano column-major: x * gridHeight + y
            const idx = x * gh + y;
            changed.push(idx);
            renderer.markDirtyIndex(idx);

            // 3. Mover la hormiga en su nueva dirección
            const d = dirs[ant.dir];
            let nx = x + d.dx;
            let ny = y + d.dy;

            if (wrap) {
                nx = (nx + gw) % gw;
                ny = (ny + gh) % gh;
            } else {
                nx = Math.max(0, Math.min(gw - 1, nx));
                ny = Math.max(0, Math.min(gh - 1, ny));
            }

            ant.x = nx;
            ant.y = ny;
        }

        this.generation++;
        return true;
    }

    getChangedCells() {
        return this._changedIndices;
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

        // Desplazar también las hormigas ANTES de reconstruir el grid
        for (const ant of this.ants) {
            ant.x = ((ant.x + dx) % gw + gw) % gw;
            ant.y = ((ant.y + dy) % gh + gh) % gh;
        }

        // Reconstruir grid principal desde stateGrid + posiciones de hormigas
        // (las hormigas en celdas no visitadas tienen stateGrid=0 pero grid=1)
        const grid = this._ctx.grid;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                grid[x][y] = dst[x][y] > 0 ? 1 : 0;
            }
        }
        for (const ant of this.ants) {
            grid[ant.x][ant.y] = 1;
        }
    }

    // =========================================
    // MULTI-HORMIGA: agregar en tiempo de ejecución
    // =========================================

    addAnt(x, y, dir = 0) {
        // Evitar duplicados: si ya hay una hormiga en esta posición, no agregar otra.
        if (this.ants.some(a => a.x === x && a.y === y)) return;
        this.ants.push({x, y, dir});
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        if (x >= 0 && x < gw && y >= 0 && y < gh) {
            this._ctx.grid[x][y] = 1;
        }
    }

    removeLastAnt() {
        if (this.ants.length > 1) this.ants.pop();
    }

    /**
     * Borra la hormiga en (x,y) y limpia su celda.
     * Usado por el borrador Ctrl+clic en modo Langton.
     */
    eraseAt(x, y) {
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        if (x < 0 || x >= gw || y < 0 || y >= gh) return;

        // Eliminar cualquier hormiga en esa posición
        this.ants = this.ants.filter(a => !(a.x === x && a.y === y));

        // Limpiar stateGrid y grid en esa celda
        if (this.stateGrid) this.stateGrid[x][y] = 0;
        this._ctx.grid[x][y] = 0;
    }

    /**
     * Sincroniza ants[] con el estado actual de grid[][].
     * Llamado después de pegar un patrón o mover una selección:
     * - Celdas vivas con stateGrid=0 → posiciones de hormiga
     * - Celdas muertas → se eliminan del array
     * Preserva la dirección de hormigas que no se movieron.
     */
    syncFromGrid() {
        if (!this.stateGrid) return;
        const gw = this._ctx.gridWidth;
        const gh = this._ctx.gridHeight;
        const grid = this._ctx.grid;

        // Mapear direcciones de hormigas existentes por índice plano
        const dirMap = new Map(this.ants.map(a => [a.x * gh + a.y, a.dir]));

        const newAnts = [];
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y] === 1 && this.stateGrid[x][y] === 0) {
                    const dir = dirMap.get(x * gh + y) ?? 0;
                    newAnts.push({x, y, dir});
                }
            }
        }

        // Limpiar stateGrid donde grid=0 (celdas borradas en el move)
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
                if (grid[x][y] === 0 && this.stateGrid[x][y] > 0) {
                    this.stateGrid[x][y] = 0;
                }
            }
        }

        this.ants = newAnts;
    }

    // =========================================
    // INFO
    // =========================================

    getInfo() {
        return {
            rule: this.ruleString,
            numColors: this.numColors,
            antCount: this.presetAntCount,  // del slider, no el total dinámico
            totalAnts: this.ants.length,    // total real incluyendo dibujados
        };
    }

    // =========================================
    // PRIVADOS
    // =========================================

    _parseRule() {
        this.ruleTable = this.ruleString.split('');
    }

    /**
     * Paleta HSL para N estados.
     * Estado 0 = celda muerta (ignorado por el proveedor).
     * Estado 1 = verde estándar del autómata (#059669) para 2 colores.
     * Estado 1..N-1 = colores distribuidos uniformemente en el círculo HSL.
     */
    _buildColorPalette() {
        this.colorPalette = new Array(this.numColors);
        this.colorPalette[0] = null;  // muerta — el renderer usa su propio fondo

        if (this.numColors === 2) {
            // Clásico: usar el verde estándar del renderer (null = usar default)
            this.colorPalette[1] = null;
        } else {
            const aliveCount = this.numColors - 1;
            const hueStep = 360 / aliveCount;
            for (let i = 1; i < this.numColors; i++) {
                const hue = ((i - 1) * hueStep) | 0;
                this.colorPalette[i] = `hsl(${hue}, 80%, 55%)`;
            }
        }
    }

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
        return this.colorPalette[this.stateGrid[x][y]] ?? null;
    }

    /** Rotación de dirección según tipo de giro */
    _rotate(dir, turn) {
        switch (turn) {
            case 'R':
                return (dir + 1) % 4;
            case 'L':
                return (dir + 3) % 4;
            case 'U':
                return (dir + 2) % 4;
            case 'N':
                return dir;
            default:
                return dir;
        }
    }

    /**
     * Construye N hormigas distribuidas simétricamente alrededor del centro.
     * 1 hormiga → centro, mirando al Norte.
     * N > 1     → posicionadas en cruz o círculo, mirando hacia afuera.
     *
     * @param {number} gw  - gridWidth
     * @param {number} gh  - gridHeight
     * @param {number} count
     */
    _buildDefaultAnts(gw, gh, count) {
        if (count === 0) return [];

        const cx = (gw / 2) | 0;
        const cy = (gh / 2) | 0;
        const ants = [];

        if (count === 1) {
            ants.push({x: cx, y: cy, dir: 0});
        } else {
            // Radio proporcional a la dimensión menor para que quepan en grids rectangulares
            const spread = Math.max(2, (Math.min(gw, gh) / 10) | 0);
            const seen = new Set();
            for (let i = 0; i < count; i++) {
                const angle = (2 * Math.PI * i) / count;
                const x = Math.max(0, Math.min(gw - 1, cx + Math.round(Math.cos(angle) * spread)));
                const y = Math.max(0, Math.min(gh - 1, cy + Math.round(Math.sin(angle) * spread)));
                const key = x * gh + y;   // índice column-major como clave de deduplicación
                if (!seen.has(key)) {
                    seen.add(key);
                    ants.push({x, y, dir: i % 4});
                }
            }
        }

        // Activar el grid para que el renderer las pinte desde el inicio
        const grid = this._ctx.grid;
        for (const ant of ants) {
            grid[ant.x][ant.y] = 1;
        }

        return ants;
    }
}

window.LangtonEngine = LangtonEngine;