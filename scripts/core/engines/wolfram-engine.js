/**
 * Motor de Autómatas 1D de Wolfram
 *
 * Estrategia: El autómata 1D evoluciona a lo largo de un eje (X o Y),
 * usando el otro eje como "tiempo visual". Cada fila/columna es una
 * generación del autómata 1D.
 */

class WolframEngine {
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.direction = 'vertical'; // 'vertical' (evoluciona ↓) o 'horizontal' (evoluciona →)
        this.ruleNumber = 30;
        this.ruleTable = this._generateRuleTable(30);
        this.generation = 0;
        this.currentRow = 0;
        this.currentCol = 0;
        this.initialized = false;

        // Índices planos (x*size + y) de las celdas dibujadas en el último paso.
        // Permite que SpecialEngineManager.stepActive() devuelva un descriptor
        // estándar con getChangedCells(), igual que el resto de los motores.
        this._changedCells = [];
    }

    _generateRuleTable(number) {
        const table = new Uint8Array(8);
        for (let i = 0; i < 8; i++) {
            table[i] = (number >> i) & 1;
        }
        return table;
    }

    activate(ruleNumber = 30, direction = 'vertical') {
        this.gridSize = this.automaton?.gridSize || 200;
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

        console.debug(`🎲 Wolfram activado: Regla ${this.ruleNumber}, dirección ${direction}, tamaño ${this.gridSize}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.initialized = false;
        console.debug('🎲 Wolfram desactivado');
    }

    _initializeSeed() {
        if (!this.automaton || !this.automaton.grid) {
            console.error('❌ WolframEngine: Autómata o grid no disponible');
            return;
        }

        if (this.initialized && !this._forceReinit) return;

        const size = this.gridSize || this.automaton.gridSize;

        if (!size || size <= 0) {
            console.error('❌ WolframEngine: Tamaño de grid inválido');
            return;
        }

        if (this.direction === 'vertical') {
            for (let x = 0; x < size; x++) {
                if (!this.automaton.grid[x]) continue;
                this.automaton.grid[x][0] = 0;
            }
            const centerX = Math.floor(size / 2);
            if (this.automaton.grid[centerX]) {
                this.automaton.grid[centerX][0] = 1;
            }
            this.currentRow = 1;
        } else {
            if (!this.automaton.grid[0]) {
                console.error('❌ Columna 0 no existe en el grid');
                return;
            }
            for (let y = 0; y < size; y++) {
                this.automaton.grid[0][y] = 0;
            }
            const centerY = Math.floor(size / 2);
            this.automaton.grid[0][centerY] = 1;
            this.currentCol = 1;
        }

        this.initialized = true;
        this._forceReinit = false;

        if (typeof this.automaton._markAllDirty === 'function') {
            this.automaton._markAllDirty();
        }
    }

    forceInitializeSeed() {
        this._forceReinit = true;
        this.initialized = false;
        this.currentRow = 0;
        this.currentCol = 0;
        this._initializeSeed();
    }

    _computeNextCell(left, center, right) {
        const pattern = (left << 2) | (center << 1) | right;
        return this.ruleTable[pattern];
    }

    step() {
        if (!this.isActive) return false;

        if (!this.automaton || !this.automaton.grid) {
            console.error('❌ WolframEngine: Autómata no disponible en step()');
            return false;
        }

        if (this.automaton.gridSize !== this.gridSize) {
            this.gridSize = this.automaton.gridSize;
            this.initialized = false;
        }

        if (!this.initialized) {
            const hasUserSeed = this._checkUserSeed();
            if (hasUserSeed) {
                this.direction === 'vertical'
                    ? (this.currentRow = 1)
                    : (this.currentCol = 1);
            } else {
                this._initializeSeed();
            }
            this.initialized = true;
            this.generation = 0;
        }

        const size = this.gridSize;

        if (this.direction === 'vertical' && this.currentRow >= size) return false;
        if (this.direction === 'horizontal' && this.currentCol >= size) return false;

        // Resetear changed cells para este paso
        this._changedCells.length = 0;

        if (this.direction === 'vertical') {
            const y = this.currentRow;
            for (let x = 0; x < size; x++) {
                const left = (x > 0) ? this.automaton.grid[x - 1][y - 1] : 0;
                const center = this.automaton.grid[x][y - 1];
                const right = (x < size - 1) ? this.automaton.grid[x + 1][y - 1] : 0;

                const pattern = (left << 2) | (center << 1) | right;
                const newState = this.ruleTable[pattern];

                if (newState) {
                    this.automaton.grid[x][y] = 1;
                    this.automaton.renderer.markDirty(x, y);
                    this._changedCells.push(x * size + y);
                }
            }
            this.currentRow++;
        } else {
            const x = this.currentCol;
            for (let y = 0; y < size; y++) {
                const top = (y > 0) ? this.automaton.grid[x - 1][y - 1] : 0;
                const center = this.automaton.grid[x - 1][y];
                const bottom = (y < size - 1) ? this.automaton.grid[x - 1][y + 1] : 0;

                const pattern = (top << 2) | (center << 1) | bottom;
                const newState = this.ruleTable[pattern];

                if (newState) {
                    this.automaton.grid[x][y] = 1;
                    this.automaton.renderer.markDirty(x, y);
                    this._changedCells.push(x * size + y);
                }
            }
            this.currentCol++;
        }

        this.generation++;
        this.automaton.generation = this.generation;

        return true;
    }

    /** Devuelve los índices planos de las celdas dibujadas en el último paso. */
    getChangedCells() {
        return this._changedCells;
    }

    _checkUserSeed() {
        const size = this.gridSize;
        if (this.direction === 'vertical') {
            for (let x = 0; x < size; x++) {
                if (this.automaton.grid[x][0]) return true;
            }
        } else {
            for (let y = 0; y < size; y++) {
                if (this.automaton.grid[0][y]) return true;
            }
        }
        return false;
    }

    reset() {
        this.initialized = false;
        this._forceReinit = false;
        this.currentRow = 0;
        this.currentCol = 0;
        this.generation = 0;
        this._changedCells = [];
    }

    getInfo() {
        return {
            active: this.isActive,
            rule: this.ruleNumber,
            direction: this.direction,
            progress: this.direction === 'vertical' ? this.currentRow : this.currentCol,
            max: this.gridSize,
            generation: this.generation
        };
    }
}

window.WolframEngine = WolframEngine;