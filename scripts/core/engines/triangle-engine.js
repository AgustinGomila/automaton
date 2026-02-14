/**
 * TriangleEngine - Motor ultra-optimizado de Autómatas Triangulares
 */
class TriangleEngine {
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.gridManager = null;
        this.generation = 0;
        this.ruleNumber = 50;
        this.neighborhoodMode = 'edge';
        this.wrapEdges = true;

        // Pre-allocar completo para evitar GC
        this._ruleTable = new Uint8Array(8);
        this._changedCells = [];
        this._newGrid = null;
        this._tempCol = null;

        // Cache de offsets de vecindad
        this._neighborOffsets = {
            edge: {
                up: [[-1, 0], [1, 0], [0, 1]],
                down: [[0, -1], [-1, 0], [1, 0]]
            },
            vertex: {
                up: [[-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [1, 1]],
                down: [[0, -1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, 1]]
            }
        };

        this.initialized = false;
    }

    activate(options = {}) {
        this.ruleNumber = options.rule ?? 50;
        this.neighborhoodMode = options.mode ?? 'edge';
        this.wrapEdges = options.wrap ?? true;

        const size = this.automaton.gridSize;
        const width = size * 2;
        const height = size;

        // Reutilizar grid si es posible
        if (!this.gridManager || this.gridManager.width !== width || this.gridManager.height !== height) {
            this.gridManager = new TriangleGridManager(width, height);
            // Pre-allocar newGrid
            this._newGrid = Array.from({length: width}, () => new Uint8Array(height));
            this._tempCol = new Uint8Array(height);
        } else {
            this.gridManager.clear();
        }

        this._buildRuleTable();
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;

        console.debug(`🔺 Triangle Engine: regla ${this.ruleNumber}, modo ${this.neighborhoodMode}`);
        return this;
    }

    _buildRuleTable() {
        const binary = (this.ruleNumber & 0xFF).toString(2).padStart(8, '0');
        for (let i = 0; i < 8; i++) {
            this._ruleTable[i] = binary[7 - i] === '1' ? 1 : 0;
        }
    }

    step() {
        if (!this.isActive || !this.gridManager) return false;

        if (!this.initialized) {
            this._initializeFromAutomaton();
            this.initialized = true;
            return true;
        }

        const width = this.gridManager.width;
        const height = this.gridManager.height;
        const currentGrid = this.gridManager.grid;
        const newGrid = this._newGrid;
        const offsets = this._neighborOffsets[this.neighborhoodMode];

        this._changedCells.length = 0;
        let changed = false;

        // Calcular siguiente generación
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const currentState = currentGrid[q][r];
                const orientation = ((q + r) & 1) === 0 ? 'up' : 'down';
                const config = this._computeConfigurationFast(q, r, currentState, orientation, offsets, currentGrid, width, height);
                const newState = this._ruleTable[config];

                newGrid[q][r] = newState;

                if (newState !== currentState) {
                    changed = true;
                    this._changedCells.push({x: q, y: r});
                }
            }
        }

        // Swap grids en lugar de copiar (mucho más rápido)
        for (let q = 0; q < width; q++) {
            // Intercambiar referencias de columnas
            const temp = currentGrid[q];
            currentGrid[q] = newGrid[q];
            newGrid[q] = temp;
        }

        this.generation++;
        this._syncToAutomatonOptimized();
        return changed;
    }

    // Versión inline y optimizada de _computeConfiguration
    _computeConfigurationFast(q, r, centerState, orientation, offsets, grid, width, height) {
        const neighborOffsets = offsets[orientation];
        let sumNeighbors = 0;

        // Unroll del loop para velocidad
        for (let i = 0; i < neighborOffsets.length; i++) {
            const [dq, dr] = neighborOffsets[i];
            const nq = q + dq;
            const nr = r + dr;

            // Bounds check inline
            if (nq >= 0 && nq < width && nr >= 0 && nr < height) {
                sumNeighbors += grid[nq][nr];
            }
        }

        return (centerState << 2) | sumNeighbors;
    }

    _initializeFromAutomaton() {
        const autoSize = this.automaton.gridSize;
        const centerQ = Math.floor(this.gridManager.width / 2);
        const centerR = Math.floor(this.gridManager.height / 2);
        const autoGrid = this.automaton.grid;

        // Usar enteros para cálculos
        const halfSize = autoSize >> 1;

        for (let x = 0; x < autoSize; x++) {
            for (let y = 0; y < autoSize; y++) {
                if (autoGrid[x][y]) {
                    const tq = (centerQ + x - halfSize) | 0;
                    const tr = (centerR + y - halfSize) | 0;
                    if (tq >= 0 && tq < this.gridManager.width &&
                        tr >= 0 && tr < this.gridManager.height) {
                        this.gridManager.grid[tq][tr] = 1;
                    }
                }
            }
        }

        this._syncToAutomatonOptimized();
    }

    // Versión optimizada: sampleo en lugar de copia completa
    _syncToAutomatonOptimized() {
        const autoSize = this.automaton.gridSize;
        const triGrid = this.gridManager.grid;
        const autoGrid = this.automaton.grid;

        // Factor de escala
        const scaleX = this.gridManager.width / autoSize;
        const scaleY = this.gridManager.height / autoSize;

        // Solo actualizar celdas que cambiaron
        for (let x = 0; x < autoSize; x++) {
            const tq = ((x * scaleX) | 0);
            const triCol = triGrid[tq];

            for (let y = 0; y < autoSize; y++) {
                const tr = ((y * scaleY) | 0);
                const isAlive = triCol[tr] === 1;

                if (autoGrid[x][y] !== (isAlive ? 1 : 0)) {
                    autoGrid[x][y] = isAlive ? 1 : 0;
                    this.automaton.renderer.markDirty(x, y);
                }
            }
        }
    }

    getChangedCells() {
        return this._changedCells;
    }

    getInfo() {
        return {
            active: this.isActive,
            generation: this.generation,
            rule: this.ruleNumber,
            mode: this.neighborhoodMode,
            population: this.gridManager?.countPopulation() ?? 0
        };
    }

    reset() {
        this.initialized = false;
        this.generation = 0;
        this._changedCells.length = 0;
        this.gridManager?.clear();
        // Forzar que se reinicialice en el próximo step
        console.debug('🔺 Triangle Engine reset');
    }

    clear() {
        if (!this.gridManager) return;

        // Limpiar todas las columnas
        for (let q = 0; q < this.gridManager.width; q++) {
            this.gridManager.grid[q].fill(0);
        }

        // Resetear estado
        this.generation = 0;
        this._changedCells = [];
        this.initialized = false;

        console.debug('🔺 TriangleEngine: Grid limpiado');
    }

    deactivate() {
        this.isActive = false;
        this.gridManager = null;
        this._newGrid = null;
        this._tempCol = null;
        console.debug('🔺 Triangle Engine desactivado');
    }
}

window.TriangleEngine = TriangleEngine;