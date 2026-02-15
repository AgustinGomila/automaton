/**
 * TriangleEngine - Motor de Autómatas Triangulares Elementales (ETA)
 *
 * Basado en la investigación de Paul Cousin:
 * "Triangular Automata: The 256 Elementary Cellular Automata of the 2D Plane" (2024)
 *
 * Vecindad: Siempre 3 vecinos (celdas que comparten arista) - ETA estándar
 */
class TriangleEngine {
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.gridManager = null;
        this.generation = 0;
        this.ruleNumber = 50;
        this.wrapEdges = true;

        this._ruleTable = new Uint8Array(8);
        this._changedCells = [];
        this._newGrid = null;

        // ETA estándar: vecindad de arista (3 vecinos)
        // Orientación "up" (△): vecinos NW, NE, S
        // Orientación "down" (▽): vecinos N, SW, SE
        this._neighborOffsets = {
            up: [[-1, 0], [1, 0], [0, 1]],
            down: [[0, -1], [-1, 0], [1, 0]]
        };

        this.initialized = false;
    }

    activate(options = {}) {
        this.ruleNumber = options.rule ?? 50;
        this.wrapEdges = options.wrap ?? true;

        const size = this.automaton.gridSize;
        // Grid triangular: el doble de ancho para mantener proporción
        const width = size * 2;
        const height = size;

        if (!this.gridManager || this.gridManager.width !== width || this.gridManager.height !== height) {
            this.gridManager = new TriangleGridManager(width, height);
            this._newGrid = Array.from({length: width}, () => new Uint8Array(height));
        } else {
            this.gridManager.clear();
        }

        this._buildRuleTable();
        this.isActive = true;
        this.generation = 0;
        this.initialized = false;

        console.debug(`🔺 Triangle Engine (ETA): regla ${this.ruleNumber}`);
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

        this._changedCells.length = 0;
        let changed = false;

        // Elegir función de computación según modo
        const computeFn = this.wrapEdges
            ? this._computeConfigurationWrapped.bind(this)
            : this._computeConfigurationBounded.bind(this);

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const currentState = currentGrid[q][r];
                const orientation = ((q + r) & 1) === 0 ? 'up' : 'down';
                const config = computeFn(q, r, currentState, orientation, currentGrid, width, height);
                const newState = this._ruleTable[config];

                newGrid[q][r] = newState;

                if (newState !== currentState) {
                    changed = true;
                    this._changedCells.push({x: q, y: r});
                }
            }
        }

        // Swap grids
        for (let q = 0; q < width; q++) {
            const temp = currentGrid[q];
            currentGrid[q] = newGrid[q];
            newGrid[q] = temp;
        }

        this.generation++;
        this._syncToAutomaton();
        return changed;
    }

    _computeConfiguration(q, r, centerState, grid, width, height) {
        const isUp = ((q + r) & 1) === 0;

        // Vecinos según orientación
        const offsets = isUp
            ? [[-1, 0], [1, 0], [0, 1]]   // UP: NW, NE, S
            : [[0, -1], [-1, 0], [1, 0]];  // DOWN: N, SW, SE

        let sumNeighbors = 0;

        for (let i = 0; i < 3; i++) {
            const [dq, dr] = offsets[i];
            let nq = q + dq;
            let nr = r + dr;

            if (this.wrapEdges) {
                nq = ((nq % width) + width) % width;
                nr = ((nr % height) + height) % height;
            } else {
                if (nq < 0 || nq >= width || nr < 0 || nr >= height) continue;
            }

            sumNeighbors += grid[nq][nr];
        }

        return (centerState << 2) | sumNeighbors;
    }

    // Versión con muros duros (wrapEdges=false)
    _computeConfigurationBounded(q, r, centerState, orientation, grid, width, height) {
        const neighborOffsets = this._neighborOffsets[orientation];
        let sumNeighbors = 0;

        for (let i = 0; i < 3; i++) {
            const [dq, dr] = neighborOffsets[i];
            const nq = q + dq;
            const nr = r + dr;

            if (nq >= 0 && nq < width && nr >= 0 && nr < height) {
                sumNeighbors += grid[nq][nr];
            }
        }

        return (centerState << 2) | sumNeighbors;
    }

    // Versión toroidal (wrapEdges=true)
    _computeConfigurationWrapped(q, r, centerState, orientation, grid, width, height) {
        const neighborOffsets = this._neighborOffsets[orientation];
        let sumNeighbors = 0;

        for (let i = 0; i < 3; i++) {
            const [dq, dr] = neighborOffsets[i];
            // Wrap-around con manejo de negativos
            const nq = ((q + dq) % width + width) % width;
            const nr = ((r + dr) % height + height) % height;

            sumNeighbors += grid[nq][nr]; // Siempre válido en modo toroidal
        }

        return (centerState << 2) | sumNeighbors;
    }

    _initializeFromAutomaton() {
        const autoSize = this.automaton.gridSize;
        const centerQ = Math.floor(this.gridManager.width / 2);
        const centerR = Math.floor(this.gridManager.height / 2);
        const autoGrid = this.automaton.grid;

        const halfSize = autoSize >> 1;

        for (let x = 0; x < autoSize; x++) {
            for (let y = 0; y < autoSize; y++) {
                if (autoGrid[x][y]) {
                    const tq = centerQ + x - halfSize;
                    const tr = centerR + y - halfSize;
                    if (this.gridManager.isValid(tq, tr)) {
                        this.gridManager.grid[tq][tr] = 1;
                    }
                }
            }
        }

        this._syncToAutomaton();
    }

    _syncToAutomaton() {
        // Mapeo simple: samplear el grid triangular al cuadrado
        const autoSize = this.automaton.gridSize;
        const triGrid = this.gridManager.grid;
        const autoGrid = this.automaton.grid;

        const scaleX = this.gridManager.width / autoSize;
        const scaleY = this.gridManager.height / autoSize;

        for (let x = 0; x < autoSize; x++) {
            const tq = Math.floor(x * scaleX);
            if (tq >= this.gridManager.width) continue;

            const triCol = triGrid[tq];

            for (let y = 0; y < autoSize; y++) {
                const tr = Math.floor(y * scaleY);
                if (tr >= this.gridManager.height) continue;

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
            population: this.gridManager?.countPopulation() ?? 0
        };
    }

    reset() {
        this.initialized = false;
        this.generation = 0;
        this._changedCells.length = 0;
        this.gridManager?.clear();
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
        console.debug('🔺 Triangle Engine desactivado');
    }
}

window.TriangleEngine = TriangleEngine;