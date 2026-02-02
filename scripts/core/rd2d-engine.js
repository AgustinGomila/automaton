/**
 * Motor de Distinción Recursiva 2D (RD-2D)
 *
 * Basado en el trabajo de Louis Kauffman sobre Distinción Recursiva.
 * 16 estados representados por 4 bits: [N, S, E, W] (Norte, Sur, Este, Oeste)
 * Cada bit indica si la frontera correspondiente está "abierta" (1) o "cerrada" (0)
 *
 * Estados (0-15):
 * 0: 0000 (vacío)    4: 0100 (S)       8: 1000 (N)      12: 1100 (NS)
 * 1: 0001 (E)        5: 0101 (SE)      9: 1001 (NE)     13: 1101 (NSE)
 * 2: 0010 (W)        6: 0110 (SW)     10: 1010 (NW)     14: 1110 (NSW)
 * 3: 0011 (EW)       7: 0111 (SEW)    11: 1011 (NEW)    15: 1111 (NSEW)
 *
 * Regla de evolución: XOR de los estados de los 4 vecinos
 * nuevo_estado[x][y] = vecino_N ^ vecino_S ^ vecino_E ^ vecino_W
 */

class RD2DEngine {
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.gridSize = 0;
        this.stateGrid = null; // Grid de estados 0-15, separado del grid binario del automaton
        this.generation = 0;
    }

    /**
     * Convierte un estado numérico a representación de fronteras
     */
    static stateToBorders(state) {
        return {
            N: (state >> 3) & 1,
            S: (state >> 2) & 1,
            E: (state >> 1) & 1,
            W: state & 1
        };
    }

    /**
     * Convierte bordes a estado numérico
     */
    static bordersToState(n, s, e, w) {
        return (n << 3) | (s << 2) | (e << 1) | w;
    }

    /**
     * Obtiene nombre/icono del estado
     */
    static getStateName(state) {
        const names = [
            '∅', 'E', 'W', 'EW', 'S', 'SE', 'SW', 'SEW',
            'N', 'NE', 'NW', 'NEW', 'NS', 'NSE', 'NSW', 'NSEW'
        ];
        return names[state] || '∅';
    }

    activate() {
        this.gridSize = this.automaton.gridSize;
        this.isActive = true;
        this.generation = 0;

        // Inicializar grid de estados
        this._initStateGrid();

        // Inicializar con patrón semilla (cruz en el centro con estado 15)
        this._initializeSeed();

        console.debug('🔲 RD-2D activado: 16 estados [N,S,E,W]');
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.stateGrid = null;
        console.debug('🔲 RD-2D desactivado');
    }

    /**
     * Inicializa el grid de estados
     */
    _initStateGrid() {
        this.stateGrid = new Array(this.gridSize);
        for (let x = 0; x < this.gridSize; x++) {
            this.stateGrid[x] = new Uint8Array(this.gridSize);
        }
    }

    /**
     * Patrón semilla: cruz central con estado completo (15)
     */
    _initializeSeed() {
        const center = Math.floor(this.gridSize / 2);
        const size = this.gridSize;

        // Cruz central
        for (let i = -2; i <= 2; i++) {
            // Vertical
            const vy = center + i;
            if (vy >= 0 && vy < size) {
                this.stateGrid[center][vy] = 15; // NSEW completo
                this._updateAutomatonCell(center, vy, 15);
            }
            // Horizontal
            const hx = center + i;
            if (hx >= 0 && hx < size) {
                this.stateGrid[hx][center] = 15;
                this._updateAutomatonCell(hx, center, 15);
            }
        }

        this.generation = 0;
    }

    /**
     * Sincroniza el estado RD con el grid binario del automaton
     * Solo muestra celdas con estado != 0
     */
    _updateAutomatonCell(x, y, state) {
        const isAlive = state !== 0;
        // No usar setCell para evitar overhead de undo/saveState masivo
        this.automaton.grid[x][y] = isAlive ? 1 : 0;
        if (isAlive) {
            this.automaton.dirtyCells.add(x * this.gridSize + y);
        }
    }

    /**
     * Obtiene el estado de una celda con wrap (toroidal)
     */
    _getState(x, y) {
        const wx = (x + this.gridSize) % this.gridSize;
        const wy = (y + this.gridSize) % this.gridSize;
        return this.stateGrid[wx][wy];
    }

    /**
     * Calcula la siguiente generación RD-2D
     * Regla: XOR de los 4 vecinos cardinales
     */
    step() {
        if (!this.isActive) return false;

        const size = this.gridSize;
        const newStateGrid = new Array(size);
        for (let x = 0; x < size; x++) {
            newStateGrid[x] = new Uint8Array(size);
        }

        let changed = false;

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                // XOR de los 4 vecinos cardinales
                const north = this._getState(x, y - 1);
                const south = this._getState(x, y + 1);
                const east = this._getState(x + 1, y);
                const west = this._getState(x - 1, y);

                const newState = north ^ south ^ east ^ west;
                newStateGrid[x][y] = newState;

                if (newState !== this.stateGrid[x][y]) {
                    changed = true;
                    this._updateAutomatonCell(x, y, newState);
                }
            }
        }

        this.stateGrid = newStateGrid;
        this.generation++;

        // Si no hay cambios, detener
        if (!changed) {
            console.debug('🔲 RD-2D: Estado estable alcanzado');
            return false;
        }

        return true;
    }

    getInfo() {
        const aliveCells = this.stateGrid ?
            this.stateGrid.flat().filter(s => s !== 0).length : 0;

        return {
            active: this.isActive,
            generation: this.generation,
            aliveCells,
            gridSize: this.gridSize,
            states: 16,
            rule: 'XOR(N,S,E,W)'
        };
    }

    reset() {
        if (this.isActive) {
            this._initStateGrid();
            this._initializeSeed();
        }
    }
}

// Exportar global
window.RD2DEngine = RD2DEngine;