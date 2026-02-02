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
        this.generation = 0
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
        // Sincronizar tamaño con el autómata
        this.gridSize = this.automaton?.gridSize || 200;
        this.ruleNumber = Math.max(0, Math.min(255, ruleNumber));
        this.ruleTable = this._generateRuleTable(this.ruleNumber);
        this.direction = direction;
        this.isActive = true;
        this.initialized = false;
        this.generation = 0
        this.currentRow = 0;
        this.currentCol = 0;
        this._forceReinit = false;

        console.debug(`🎲 Wolfram activado: Regla ${this.ruleNumber}, dirección ${direction}, tamaño ${this.gridSize}`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.initialized = false;
        console.debug('🎲 Wolfram desactivado');
    }

    /**
     * Inicializa el estado semilla (una sola celda viva en el centro)
     * Solo se ejecuta UNA VEZ, a menos que se fuerce manualmente
     */
    _initializeSeed() {
        // Verificar que el autómata y su grid existen
        if (!this.automaton || !this.automaton.grid) {
            console.error('❌ WolframEngine: Autómata o grid no disponible');
            return;
        }

        // Si ya está inicializado y no estamos forzando, no hacer nada
        if (this.initialized && !this._forceReinit) return;

        const size = this.gridSize || this.automaton.gridSize;

        // Asegurar que tenemos el tamaño correcto
        if (!size || size <= 0) {
            console.error('❌ WolframEngine: Tamaño de grid inválido');
            return;
        }

        // Limpiar primero cualquier estado previo en la primera fila/columna
        if (this.direction === 'vertical') {
            // Verificar que la columna existe antes de acceder
            for (let x = 0; x < size; x++) {
                if (!this.automaton.grid[x]) {
                    console.warn(`Columna ${x} no existe, saltando`);
                    continue;
                }
                this.automaton.grid[x][0] = 0;
            }
            // Semilla en el centro
            const centerX = Math.floor(size / 2);
            if (this.automaton.grid[centerX]) {
                this.automaton.grid[centerX][0] = 1;
            }
            this.currentRow = 1;
        } else {
            // Verificar que la columna 0 existe
            if (!this.automaton.grid[0]) {
                console.error('❌ Columna 0 no existe en el grid');
                return;
            }
            // Limpiar toda la primera columna (x=0)
            for (let y = 0; y < size; y++) {
                this.automaton.grid[0][y] = 0;
            }
            // Semilla en el centro
            const centerY = Math.floor(size / 2);
            this.automaton.grid[0][centerY] = 1;
            this.currentCol = 1;
        }

        this.initialized = true;
        this._forceReinit = false;

        // Marcar dirty para renderizado
        if (typeof this.automaton._markAllDirty === 'function') {
            this.automaton._markAllDirty();
        }
    }

    /**
     * Fuerza la reinicialización de la semilla (para uso manual)
     */
    forceInitializeSeed() {
        this._forceReinit = true;
        this.initialized = false;
        this.currentRow = 0;
        this.currentCol = 0;
        this._initializeSeed();
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

        // Verificar estado del autómata
        if (!this.automaton || !this.automaton.grid) {
            console.error('❌ WolframEngine: Autómata no disponible en step()');
            return false;
        }

        // Sincronizar tamaño si cambió
        if (this.automaton.gridSize !== this.gridSize) {
            console.debug(`🎲 Wolfram: Actualizando tamaño ${this.gridSize} → ${this.automaton.gridSize}`);
            this.gridSize = this.automaton.gridSize;
            this.initialized = false;
        }

        // PRIMERA VEZ: detectar semilla del usuario o inicializar por defecto
        if (!this.initialized) {
            const hasUserSeed = this._checkUserSeed();

            if (hasUserSeed) {
                console.debug('🎲 Wolfram: Detectada semilla del usuario');
                // Configurar índices pero no sobrescribir la semilla del usuario
                if (this.direction === 'vertical') {
                    this.currentRow = 1;
                } else {
                    this.currentCol = 1;
                }
            } else {
                console.debug('🎲 Wolfram: Inicializando semilla por defecto');
                this._initializeSeed();
            }

            this.initialized = true;
            this.generation = 0; // Empezar en 0, se incrementará al final
        }

        const size = this.gridSize;

        // Verificar límites
        if (this.direction === 'vertical' && this.currentRow >= size) {
            console.debug('🎲 Wolfram: Límite vertical alcanzado');
            return false;
        }
        if (this.direction === 'horizontal' && this.currentCol >= size) {
            console.debug('🎲 Wolfram: Límite horizontal alcanzado');
            return false;
        }

        // Calcular siguiente fila/columna
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
                    this.automaton.dirtyCells.add(x * size + y);
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
                    this.automaton.dirtyCells.add(x * size + y);
                }
            }

            this.currentCol++;
        }

        // Incrementar generación después de calcular
        this.generation++;

        // Sincronizar con el autómata para que las estadísticas muestren la generación correcta
        this.automaton.generation = this.generation;

        console.debug(`🎲 Wolfram: Generación ${this.generation}, Progreso: ${this.direction === 'vertical' ? this.currentRow : this.currentCol}/${size}`);

        return true;
    }

    /**
     * Verifica si el usuario dibujó algo en la posición de inicio
     */
    _checkUserSeed() {
        const size = this.gridSize;

        if (this.direction === 'vertical') {
            // Verificar si hay celdas vivas en y=0
            for (let x = 0; x < size; x++) {
                if (this.automaton.grid[x][0]) return true;
            }
        } else {
            // Verificar si hay celdas vivas en x=0
            for (let y = 0; y < size; y++) {
                if (this.automaton.grid[0][y]) return true;
            }
        }
        return false;
    }

    /**
     * Reset para reinicio controlado
     */
    reset() {
        this.initialized = false;
        this._forceReinit = false;
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
            max: this.gridSize,
            generation: this.generation
        };
    }
}

// Exportar global
window.WolframEngine = WolframEngine;