/**
 * GenerationsEngine — Motor de autómatas celulares tipo "Generaciones" (B/S/C).
 *
 * Extiende el modelo Life-like binario añadiendo C estados (C ≥ 2):
 *   - Estado 0: muerto (vacío)
 *   - Estado 1: vivo activo — aplica reglas B y S
 *   - Estados 2..C-1: moribundo — decrementan 1 por generación hasta llegar a 0
 *
 * Solo el estado 1 cuenta como vecino vivo para las reglas B/S.
 * El envejecimiento (2→3→…→0) es determinista y no depende de vecinos.
 *
 * Notación Golly: S/B/C  (ej. "25/03467/6" o "03467/25/6" según variante)
 * Notación canónica usada internamente: B.../S.../C
 *
 * Referencia: Dewdney (1988), Bays (1987), MCell documentation.
 */
class GenerationsEngine {
    /**
     * @param {Object} ctx  Contexto inyectado por SpecialEngineManager
     *   ctx.grid      → automaton.grid (Uint8Array[]) — fuente de verdad binaria
     *   ctx.gridSize  → número de celdas por lado
     *   ctx.renderer  → GridRenderer activo
     *   ctx.wrapEdges → boolean
     */
    constructor(ctx) {
        this._ctx = ctx;
        this.isActive = false;

        // Regla
        this.birth = [3];        // vecinos para nacer
        this.survival = [2, 3];     // vecinos para sobrevivir
        this.numStates = 2;         // C — número total de estados (mín 2)

        // Grid de estados 0..C-1 (columna-mayor, igual que ctx.grid)
        this.stateGrid = null;
        this._backGrid = null;

        this.generation = 0;
        this._changedCells = [];    // índices planos x*size+y

        // colorProvider registrado en renderer
        this._palette = [];    // palette[state] → string CSS | null
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
     * @param {number}   options.numStates  — C, mínimo 2
     */
    activate({birth, survival, numStates} = {}) {
        this.birth = birth ?? [3];
        this.survival = survival ?? [2, 3];
        this.numStates = Math.max(2, Math.min(numStates ?? 2, 256));

        const size = this._ctx.gridSize;
        this.stateGrid = this._allocGrid(size);
        this._backGrid = this._allocGrid(size);

        // Importar grid binario actual → estado 1
        const src = this._ctx.grid;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                this.stateGrid[x][y] = src[x][y] ? 1 : 0;
            }
        }

        this._buildPalette();
        this._ctx.renderer.setColorProvider(this._colorProvider.bind(this));
        this._ctx.renderer.markAllDirty();

        this.generation = 0;
        this._changedCells = [];
        this.isActive = true;

        console.debug(`🌀 Generations activado: B${this.birth.join('')}/S${this.survival.join('')}/C${this.numStates}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this._ctx.renderer?.setColorProvider(null);
        this.stateGrid = null;
        this._backGrid = null;
        console.debug('🌀 Generations desactivado');
    }

    reset() {
        this.generation = 0;
        this._changedCells = [];
        if (!this.stateGrid) return;
        const size = this._ctx.gridSize;
        for (let x = 0; x < size; x++) this.stateGrid[x].fill(0);
        // Re-importar grid binario actual
        const src = this._ctx.grid;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                this.stateGrid[x][y] = src[x][y] ? 1 : 0;
            }
        }
        this._ctx.renderer.markAllDirty();
    }

    randomize(density = 0.35) {
        if (!this.stateGrid) return;
        const size = this._ctx.gridSize;
        const grid = this._ctx.grid;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                // Solo estado 0 o 1 al randomizar — los estados intermedios emergen solos
                const s = Math.random() < density ? 1 : 0;
                this.stateGrid[x][y] = s;
                grid[x][y] = s ? 1 : 0;
            }
        }
        this.generation = 0;
        this._changedCells = [];
        this._ctx.renderer.markAllDirty();
    }

    // =========================================
    // PASO DE SIMULACIÓN
    // =========================================

    step() {
        if (!this.isActive || !this.stateGrid) return false;

        const size = this._ctx.gridSize;
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

        for (let x = 0; x < size; x++) {
            const xm = wrap ? (x === 0 ? size - 1 : x - 1) : x - 1;
            const xp = wrap ? (x === size - 1 ? 0 : x + 1) : x + 1;

            for (let y = 0; y < size; y++) {
                const ym = wrap ? (y === 0 ? size - 1 : y - 1) : y - 1;
                const yp = wrap ? (y === size - 1 ? 0 : y + 1) : y + 1;

                const cur = sg[x][y];
                let next;

                if (cur === 0) {
                    // Muerto: cuenta vecinos en estado 1 (solo vivos activos)
                    let n = 0;
                    if (xm >= 0 && xm < size) {
                        if (ym >= 0 && ym < size && sg[xm][ym] === 1) n++;
                        if (sg[xm][y] === 1) n++;
                        if (yp >= 0 && yp < size && sg[xm][yp] === 1) n++;
                    }
                    if (ym >= 0 && ym < size && sg[x][ym] === 1) n++;
                    if (yp >= 0 && yp < size && sg[x][yp] === 1) n++;
                    if (xp >= 0 && xp < size) {
                        if (ym >= 0 && ym < size && sg[xp][ym] === 1) n++;
                        if (sg[xp][y] === 1) n++;
                        if (yp >= 0 && yp < size && sg[xp][yp] === 1) n++;
                    }
                    next = bSet.has(n) ? 1 : 0;

                } else if (cur === 1) {
                    // Vivo: cuenta vecinos en estado 1
                    let n = 0;
                    if (xm >= 0 && xm < size) {
                        if (ym >= 0 && ym < size && sg[xm][ym] === 1) n++;
                        if (sg[xm][y] === 1) n++;
                        if (yp >= 0 && yp < size && sg[xm][yp] === 1) n++;
                    }
                    if (ym >= 0 && ym < size && sg[x][ym] === 1) n++;
                    if (yp >= 0 && yp < size && sg[x][yp] === 1) n++;
                    if (xp >= 0 && xp < size) {
                        if (ym >= 0 && ym < size && sg[xp][ym] === 1) n++;
                        if (sg[xp][y] === 1) n++;
                        if (yp >= 0 && yp < size && sg[xp][yp] === 1) n++;
                    }
                    next = sSet.has(n) ? 1 : (C > 2 ? 2 : 0);

                } else {
                    // Moribundo: avanzar al siguiente estado de envejecimiento
                    next = (cur + 1) % C;
                }

                back[x][y] = next;

                if (next !== cur) {
                    changed = true;
                    const idx = x * size + y;
                    this._changedCells.push(idx);
                    // Sincronizar grid binario: solo estado 1 es "vivo" para el resto del sistema
                    grid[x][y] = next === 1 ? 1 : 0;
                    renderer.markDirtyIndex(idx);
                }
            }
        }

        // Swap de buffers — sin allocaciones
        this._backGrid = sg;
        this.stateGrid = back;
        this.generation++;

        return true; // Generaciones no tiene estado estable detectado automáticamente
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
        const size = this._ctx.gridSize;
        const grid = this._ctx.grid;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
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

    _allocGrid(size) {
        const g = new Array(size);
        for (let x = 0; x < size; x++) g[x] = new Uint8Array(size);
        return g;
    }

    /**
     * Construye la paleta de colores para C estados.
     * Estado 0  → null (fondo del renderer)
     * Estado 1  → verde vivo (#059669)
     * Estados 2..C-1 → rampa continua verde→amarillo→naranja→rojo
     *   El primer estado moribundo (2) es el más "reciente" → más cálido,
     *   el último (C-1) es el más antiguo → más frío hacia negro.
     */
    _buildPalette() {
        this._palette = new Array(this.numStates);
        this._palette[0] = null; // muerto — renderer usa fondo

        if (this.numStates === 2) {
            this._palette[1] = null; // usa color alive estándar del renderer
            return;
        }

        this._palette[1] = '#059669'; // verde vivo estándar

        // Estados moribundos: rampa HSL desde amarillo (60°) hasta rojo (0°)
        // con luminosidad decreciente para acercarse al negro al final.
        const dying = this.numStates - 2; // cantidad de estados moribundos
        for (let i = 0; i < dying; i++) {
            const t = dying === 1 ? 0 : i / (dying - 1); // 0=recién muerto, 1=casi negro
            const hue = Math.round(60 * (1 - t));           // 60°→0° (amarillo→rojo)
            const lit = Math.round(50 * (1 - t * 0.8));     // 50%→10%
            this._palette[2 + i] = `hsl(${hue}, 90%, ${lit}%)`;
        }
    }

    _colorProvider(cellIndex) {
        if (!this.stateGrid) return null;
        const size = this._ctx.gridSize;
        const x = (cellIndex / size) | 0;
        const y = cellIndex % size;
        return this._palette[this.stateGrid[x][y]] ?? null;
    }
}

window.GenerationsEngine = GenerationsEngine;