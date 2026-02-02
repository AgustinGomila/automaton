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
        this.ruleNumber = 30;        // Regla por defecto
        this.ruleTable = this._generateRuleTable(30);
        this.currentRow = 0;         // Para dirección vertical
        this.currentCol = 0;         // Para dirección horizontal
        this.initialized = false;
    }

    /**
     * Genera la tabla de reglas a partir del número (0-255)
     * Cada bit representa la salida para un patrón de vecinos de 3 celdas
     */
    _generateRuleTable(number) {
        const table = new Uint8Array(8);
        for (let i = 0; i < 8; i++) {
            table[i] = (number >> i) & 1;
        }
        return table;
    }

    /**
     * Activa el modo Wolfram con configuración específica
     */
    activate(ruleNumber = 30, direction = 'vertical') {
        this.ruleNumber = Math.max(0, Math.min(255, ruleNumber));
        this.ruleTable = this._generateRuleTable(this.ruleNumber);
        this.direction = direction;
        this.isActive = true;
        this.initialized = false;
        this.currentRow = 0;
        this.currentCol = 0;

        console.debug(`🎲 Wolfram activado: Regla ${this.ruleNumber}, dirección ${direction}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.initialized = false;
        console.debug('🎲 Wolfram desactivado');
    }

    /**
     * Inicializa el estado semilla (una sola celda viva en el centro)
     * Llamado automáticamente en la primera generación
     */
    _initializeSeed() {
        const size = this.automaton.gridSize;

        if (this.direction === 'vertical') {
            // Semilla en la fila superior, centro
            const centerX = Math.floor(size / 2);
            this.automaton.setCell(centerX, 0, true, true);
            this.currentRow = 1;
        } else {
            // Semilla en la columna izquierda, centro
            const centerY = Math.floor(size / 2);
            this.automaton.setCell(0, centerY, true, true);
            this.currentCol = 1;
        }

        this.initialized = true;
    }

    /**
     * Calcula el siguiente estado de una celda basado en sus vecinos 1D
     * Patrones: 111, 110, 101, 100, 011, 010, 001, 000 -> índices 7-0
     */
    _computeNextCell(left, center, right) {
        const pattern = (left << 2) | (center << 1) | right;
        return this.ruleTable[pattern];
    }

    /**
     * Genera la siguiente "fila" del autómata 1D (evolución vertical)
     */
    _stepVertical() {
        const size = this.automaton.gridSize;
        const y = this.currentRow;

        if (y >= size) return false; // Límite alcanzado

        // Para cada celda en esta fila, calcular basado en la fila anterior
        for (let x = 0; x < size; x++) {
            const left = x > 0 ? this.automaton.grid[x - 1][y - 1] : 0;
            const center = this.automaton.grid[x][y - 1];
            const right = x < size - 1 ? this.automaton.grid[x + 1][y - 1] : 0;

            const nextState = this._computeNextCell(left, center, right);
            if (nextState) {
                this.automaton.setCell(x, y, true, true);
            }
        }

        this.currentRow++;
        return true;
    }

    /**
     * Genera la siguiente "columna" del autómata 1D (evolución horizontal)
     */
    _stepHorizontal() {
        const size = this.automaton.gridSize;
        const x = this.currentCol;

        if (x >= size) return false; // Límite alcanzado

        // Para cada celda en esta columna, calcular basado en la columna anterior
        for (let y = 0; y < size; y++) {
            const left = y > 0 ? this.automaton.grid[x - 1][y - 1] : 0;
            const center = this.automaton.grid[x - 1][y];
            const right = y < size - 1 ? this.automaton.grid[x - 1][y + 1] : 0;

            const nextState = this._computeNextCell(left, center, right);
            if (nextState) {
                this.automaton.setCell(x, y, true, true);
            }
        }

        this.currentCol++;
        return true;
    }

    /**
     * Paso de generación - llamado por el loop principal del autómata
     * Retorna true si debe continuar, false si terminó
     */
    step() {
        if (!this.isActive) return false;

        if (!this.initialized) {
            this._initializeSeed();
            return true;
        }

        if (this.direction === 'vertical') {
            return this._stepVertical();
        } else {
            return this._stepHorizontal();
        }
    }

    /**
     * Reset para reinicio
     */
    reset() {
        this.initialized = false;
        this.currentRow = 0;
        this.currentCol = 0;
    }

    /**
     * Obtiene información del estado actual
     */
    getInfo() {
        return {
            active: this.isActive,
            rule: this.ruleNumber,
            direction: this.direction,
            progress: this.direction === 'vertical' ? this.currentRow : this.currentCol,
            max: this.automaton.gridSize
        };
    }
}

// Exportar global
window.WolframEngine = WolframEngine;