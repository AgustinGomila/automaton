/**
 * WolframEngine — Motor de Autómatas 1D de Wolfram.
 *
 * Estrategia: el autómata 1D evoluciona a lo largo de un eje (X o Y),
 * usando el otro eje como "tiempo visual". Cada fila/columna es una
 * generación del autómata 1D.
 *
 * ─── Modos y dimensiones ───────────────────────────────────────────────
 * Vertical   (↓): autómata 1D en X (ancho = gridWidth),
 *                 tiempo avanza hacia abajo (límite = gridHeight).
 * Horizontal (→): autómata 1D en Y (ancho = gridHeight),
 *                 tiempo avanza hacia la derecha (límite = gridWidth).
 *
 * ─── Convención de índice plano ────────────────────────────────────────
 * Column-major:  index = x * gridHeight + y
 * Consistente con GridRenderer y GridManager.
 *
 * ─── Grids rectangulares ───────────────────────────────────────────────
 * gridWidth y gridHeight se guardan como propiedades de instancia y se
 * re-sincronizan al inicio de step() para detectar resize en caliente.
 */
class WolframEngine {

    /**
     * @param {Object} automaton — instancia de CellularAutomaton.
     *   Expone: .grid, .gridWidth, .gridHeight, .renderer, .generation,
     *           ._markAllDirty()
     */
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.direction = 'vertical'; // 'vertical' (↓) o 'horizontal' (→)
        this.ruleNumber = 30;
        this.ruleTable = this._generateRuleTable(30);
        this.generation = 0;
        this.currentRow = 0;
        this.currentCol = 0;
        this.initialized = false;
        this._forceReinit = false;

        // Dimensiones snapshot — se sincronizan en step() para detectar resize
        this.gridWidth = 0;
        this.gridHeight = 0;

        // Índices planos (x * gridHeight + y) de las celdas pintadas en el último paso
        this._changedCells = [];
    }

    // =========================================
    // CICLO DE VIDA
    // =========================================

    /**
     * Activa el motor con la regla y dirección dadas.
     * @param {number} [ruleNumber=30]       — regla Wolfram (0-255)
     * @param {string} [direction='vertical'] — 'vertical' o 'horizontal'
     */
    activate(ruleNumber = 30, direction = 'vertical') {
        this.gridWidth = this.automaton?.gridWidth || 200;
        this.gridHeight = this.automaton?.gridHeight || 200;
        this.ruleNumber = Math.max(0, Math.min(255, ruleNumber));
        this.ruleTable = this._generateRuleTable(this.ruleNumber);
        this.direction = direction;
        this.isActive = true;
        this.initialized = false;
        this._forceReinit = false;
        this.generation = 0;
        this.currentRow = 0;
        this.currentCol = 0;
        this._changedCells = [];

        console.debug(`🎲 Wolfram activado: Regla ${this.ruleNumber}, dirección ${direction}, ${this.gridWidth}×${this.gridHeight}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.initialized = false;
        console.debug('🎲 Wolfram desactivado');
    }

    reset() {
        this.initialized = false;
        this._forceReinit = false;
        this.currentRow = 0;
        this.currentCol = 0;
        this.generation = 0;
        this._changedCells = [];
    }

    // =========================================
    // PASO DE SIMULACIÓN
    // =========================================

    /**
     * Pinta la siguiente fila (vertical) o columna (horizontal) del autómata 1D.
     * @returns {boolean} false cuando se alcanza el límite del eje temporal.
     */
    step() {
        if (!this.isActive || !this.automaton?.grid) return false;

        // Re-sincronizar dimensiones si el grid cambió de tamaño
        const curW = this.automaton.gridWidth || 200;
        const curH = this.automaton.gridHeight || 200;
        if (curW !== this.gridWidth || curH !== this.gridHeight) {
            this.gridWidth = curW;
            this.gridHeight = curH;
            this.initialized = false;
        }

        if (!this.initialized) {
            if (!this._checkUserSeed()) {
                this._initializeSeed();
            } else {
                // Semilla del usuario en fila/columna 0 → empezar desde 1
                this.direction === 'vertical'
                    ? (this.currentRow = 1)
                    : (this.currentCol = 1);
            }
            this.initialized = true;
            this.generation = 0;
        }

        // Comprobar límite del eje temporal antes de continuar
        if (this.direction === 'vertical' && this.currentRow >= this.gridHeight) return false;
        if (this.direction === 'horizontal' && this.currentCol >= this.gridWidth) return false;

        this._changedCells.length = 0;

        if (this.direction === 'vertical') {
            const y = this.currentRow;
            const gw = this.gridWidth;
            const gh = this.gridHeight;
            for (let x = 0; x < gw; x++) {
                const left = x > 0 ? this.automaton.grid[x - 1][y - 1] : 0;
                const center = this.automaton.grid[x][y - 1];
                const right = x < gw - 1 ? this.automaton.grid[x + 1][y - 1] : 0;
                const ns = this.ruleTable[(left << 2) | (center << 1) | right];
                if (ns) {
                    this.automaton.grid[x][y] = 1;
                    this.automaton.renderer.markDirty(x, y);
                    this._changedCells.push(x * gh + y);
                }
            }
            this.currentRow++;
        } else {
            const x = this.currentCol;
            const gh = this.gridHeight;
            const gw = this.gridWidth;
            for (let y = 0; y < gh; y++) {
                const top = y > 0 ? this.automaton.grid[x - 1][y - 1] : 0;
                const center = this.automaton.grid[x - 1][y];
                const bottom = y < gh - 1 ? this.automaton.grid[x - 1][y + 1] : 0;
                const ns = this.ruleTable[(top << 2) | (center << 1) | bottom];
                if (ns) {
                    this.automaton.grid[x][y] = 1;
                    this.automaton.renderer.markDirty(x, y);
                    this._changedCells.push(x * gh + y);
                }
            }
            this.currentCol++;
        }

        this.generation++;
        this.automaton.generation = this.generation;
        return true;
    }

    /** Índices planos (x * gridHeight + y) de las celdas pintadas en el último paso. */
    getChangedCells() {
        return this._changedCells;
    }

    /** Fuerza re-inicialización de la semilla en el próximo step(). */
    forceInitializeSeed() {
        this._forceReinit = true;
        this.initialized = false;
        this.currentRow = 0;
        this.currentCol = 0;
        this._initializeSeed();
    }

    // =========================================
    // INFO
    // =========================================

    getInfo() {
        return {
            active: this.isActive,
            rule: this.ruleNumber,
            direction: this.direction,
            progress: this.direction === 'vertical' ? this.currentRow : this.currentCol,
            // max: límite del eje temporal según dirección
            max: this.direction === 'vertical' ? this.gridHeight : this.gridWidth,
            generation: this.generation
        };
    }

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Genera la tabla de regla para el número Wolfram dado.
     * @param {number} number — regla (0-255)
     * @returns {Uint8Array} tabla[patrón 0..7] → 0|1
     */
    _generateRuleTable(number) {
        const table = new Uint8Array(8);
        for (let i = 0; i < 8; i++) table[i] = (number >> i) & 1;
        return table;
    }

    /**
     * Calcula el nuevo estado de una celda dado su vecindario (left, center, right).
     * No usado internamente (step() inlinea el cálculo), pero disponible como API.
     */
    _computeNextCell(left, center, right) {
        return this.ruleTable[(left << 2) | (center << 1) | right];
    }

    /**
     * Coloca la semilla inicial: una única celda viva en el centro del eje activo.
     * Vertical:   grid[cx][0] = 1  donde cx = ⌊gridWidth/2⌋
     * Horizontal: grid[0][cy] = 1  donde cy = ⌊gridHeight/2⌋
     */
    _initializeSeed() {
        if (!this.automaton?.grid) return;
        if (this.initialized && !this._forceReinit) return;

        const gw = this.gridWidth || this.automaton.gridWidth || 200;
        const gh = this.gridHeight || this.automaton.gridHeight || 200;

        if (this.direction === 'vertical') {
            for (let x = 0; x < gw; x++) {
                if (this.automaton.grid[x]) this.automaton.grid[x][0] = 0;
            }
            const cx = (gw / 2) | 0;
            if (this.automaton.grid[cx]) this.automaton.grid[cx][0] = 1;
            this.currentRow = 1;
        } else {
            if (!this.automaton.grid[0]) return;
            for (let y = 0; y < gh; y++) this.automaton.grid[0][y] = 0;
            this.automaton.grid[0][(gh / 2) | 0] = 1;
            this.currentCol = 1;
        }

        this.initialized = true;
        this._forceReinit = false;
        if (typeof this.automaton._markAllDirty === 'function') {
            this.automaton._markAllDirty();
        }
    }

    /**
     * Verifica si el usuario ha dibujado alguna semilla en la fila/columna inicial.
     * Vertical:   fila y=0 en todo el ancho
     * Horizontal: columna x=0 en todo el alto
     * @returns {boolean}
     */
    _checkUserSeed() {
        const gw = this.gridWidth || this.automaton.gridWidth || 200;
        const gh = this.gridHeight || this.automaton.gridHeight || 200;
        if (this.direction === 'vertical') {
            for (let x = 0; x < gw; x++) {
                if (this.automaton.grid[x]?.[0]) return true;
            }
        } else {
            for (let y = 0; y < gh; y++) {
                if (this.automaton.grid[0]?.[y]) return true;
            }
        }
        return false;
    }
}

export {WolframEngine};