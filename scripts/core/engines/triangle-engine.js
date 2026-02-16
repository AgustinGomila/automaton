/**
 * TriangleEngine - Motor de Autómatas Triangulares Elementales (ETA)
 * Versión con soporte de Web Worker para rendimiento
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

        // Worker support
        this.worker = null;
        this.useWorker = false;
        this.workerThreshold = 100;
        this.isWorkerProcessing = false;
        this._pendingStep = false;
        this._workerReady = false;
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
        this._workerReady = false;

        this.useWorker = size >= this.workerThreshold && typeof Worker !== 'undefined';
        if (this.useWorker) {
            this._initWorker();
        }

        console.debug(`🔺 Triangle Engine (ETA): regla ${this.ruleNumber}, worker: ${this.useWorker}`);
        return this;
    }

    _buildRuleTable() {
        const binary = (this.ruleNumber & 0xFF).toString(2).padStart(8, '0');
        for (let i = 0; i < 8; i++) {
            this._ruleTable[i] = binary[7 - i] === '1' ? 1 : 0;
        }
    }

    /**
     * Redimensiona el grid triangular (llamado por el autómata principal)
     * @param {number} newSize - Nuevo tamaño del grid cuadrado
     */
    resize(newSize) {
        if (!this.isActive || !this.gridManager) return;

        const newWidth = newSize * 2;
        const newHeight = newSize;

        if (this.gridManager.width === newWidth && this.gridManager.height === newHeight) {
            return;
        }

        console.debug(`🔺 Triangle Engine resize: ${this.gridManager.width}x${this.gridManager.height} → ${newWidth}x${newHeight}`);

        // Guardar y migrar datos
        const oldGrid = this.gridManager.grid;
        const oldWidth = this.gridManager.width;
        const oldHeight = this.gridManager.height;

        this.gridManager = new TriangleGridManager(newWidth, newHeight);
        this._newGrid = Array.from({length: newWidth}, () => new Uint8Array(newHeight));

        // Sampleo para preservar patrón
        const scaleX = oldWidth / newWidth;
        const scaleY = oldHeight / newHeight;

        for (let q = 0; q < newWidth; q++) {
            for (let r = 0; r < newHeight; r++) {
                const oldQ = Math.floor(q * scaleX);
                const oldR = Math.floor(r * scaleY);
                if (oldQ < oldWidth && oldR < oldHeight) {
                    this.gridManager.grid[q][r] = oldGrid[oldQ][oldR];
                }
            }
        }

        // Sincronizar renderer del triángulo
        if (this.automaton?.renderer?.setGridManager) {
            this.automaton.renderer.setGridManager(this.gridManager);
            this.automaton.renderer.resize(newSize, this.automaton.cellSize);
        }

        // Sincronizar worker
        if (this.useWorker && this.worker && this._workerReady) {
            this._syncToWorker();
        }

        // Sincronizar con grid principal
        this._syncToAutomaton();
    }

    // ========== WORKER SUPPORT METHODS ==========

    _initWorker() {
        if (this.worker) {
            this.worker.terminate();
        }

        this._workerReady = false;

        try {
            this.worker = new Worker('scripts/infrastructure/workers/triangle-worker.js');

            this.worker.onmessage = (e) => {
                const {type, result, gridBuffer, changedCells, isInitialized} = e.data;

                if (type === 'ready') {
                    console.debug('🔺 Worker: ready received');
                    return;
                }

                if (type === 'pong') {
                    this._workerReady = isInitialized || false;
                    return;
                }

                if (type === 'init') {
                    this._workerReady = true;
                    console.debug('🔺 Worker: initialized');
                    return;
                }

                if (type === 'step') {
                    this._handleWorkerStep(result, gridBuffer, changedCells);
                } else if (type === 'error') {
                    console.error('Triangle Worker error:', e.data.error);
                    this.useWorker = false;
                    this.isWorkerProcessing = false;
                }
            };

            this.worker.onerror = (err) => {
                console.error('Worker error:', err);
                this.useWorker = false;
                this.isWorkerProcessing = false;
                this._workerReady = false;
            };

        } catch (err) {
            console.warn('Failed to init triangle worker:', err);
            this.useWorker = false;
            this._workerReady = false;
        }
    }

    // Método para warm-up del worker
    async _warmupWorker() {
        if (!this.worker || !this.useWorker) return false;

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.warn('🔺 Worker warm-up timeout');
                resolve(false);
            }, 5000); // 5 segundos máximo

            const checkReady = () => {
                if (this._workerReady) {
                    clearTimeout(timeout);
                    resolve(true);
                    return;
                }

                // Enviar ping para verificar estado
                if (this.worker) {
                    this.worker.postMessage({type: 'ping'});
                }

                setTimeout(checkReady, 50);
            };

            checkReady();
        });
    }

    _syncToWorker() {
        if (!this.worker || !this.useWorker) return;

        const width = this.gridManager.width;
        const height = this.gridManager.height;
        const flatSize = width * height;
        const gridBuffer = new ArrayBuffer(flatSize);
        const flatGrid = new Uint8Array(gridBuffer);

        for (let q = 0; q < width; q++) {
            for (let r = 0; r < height; r++) {
                flatGrid[q * height + r] = this.gridManager.grid[q][r];
            }
        }

        this.worker.postMessage({
            type: 'init',
            data: {
                width,
                height,
                ruleNumber: this.ruleNumber,
                wrapEdges: this.wrapEdges,
                gridBuffer
            }
        }, [gridBuffer]);
    }

    _handleWorkerStep(result, gridBuffer, changedCellsBuffer) {
        this.isWorkerProcessing = false;
        if (!this.isActive) return;

        if (gridBuffer) {
            const flatGrid = new Uint8Array(gridBuffer);
            const width = this.gridManager.width;
            const height = this.gridManager.height;

            for (let q = 0; q < width; q++) {
                for (let r = 0; r < height; r++) {
                    this.gridManager.grid[q][r] = flatGrid[q * height + r];
                }
            }
        }

        this._changedCells.length = 0;
        if (changedCellsBuffer && result.changedCount > 0) {
            const changedArray = new Int32Array(changedCellsBuffer);
            for (let i = 0; i < result.changedCount; i++) {
                this._changedCells.push({
                    x: changedArray[i * 2],
                    y: changedArray[i * 2 + 1]
                });
            }
        }

        this.generation = result.generation;
        this._syncToAutomaton();

        if (this.automaton) {
            this.automaton.renderer.updateActivityAges(this._changedCells);
            this.automaton.render();
            this.automaton.updateStats(this.gridManager.countPopulation());
        }

        if (this._pendingStep) {
            this._pendingStep = false;
            this.step();
        }
    }

    async step() {
        if (!this.isActive || !this.gridManager) return false;

        if (this.useWorker && this.isWorkerProcessing) {
            this._pendingStep = true;
            return true;
        }

        if (!this.initialized) {
            this._initializeFromAutomaton();
            this.initialized = true;

            // Warm-up del worker antes de usarlo
            if (this.useWorker) {
                this._syncToWorker();
                const warmedUp = await this._warmupWorker();
                if (!warmedUp) {
                    console.warn('🔺 Worker warm-up failed, falling back to sync');
                    this.useWorker = false;
                }
            }

            return true;
        }

        if (this.useWorker && this.worker && this._workerReady) {
            this.isWorkerProcessing = true;
            this.worker.postMessage({type: 'step'});
            return true;
        }

        return this._stepSync();
    }

    _stepSync() {
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

    _computeConfigurationWrapped(q, r, centerState, orientation, grid, width, height) {
        const neighborOffsets = this._neighborOffsets[orientation];
        let sumNeighbors = 0;

        for (let i = 0; i < 3; i++) {
            const [dq, dr] = neighborOffsets[i];
            let nq = q + dq;
            let nr = r + dr;

            if (nq < 0) nq += width;
            else if (nq >= width) nq -= width;

            if (nr < 0) nr += height;
            else if (nr >= height) nr -= height;

            sumNeighbors += grid[nq][nr];
        }

        return (centerState << 2) | sumNeighbors;
    }

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
            population: this.gridManager?.countPopulation() ?? 0,
            useWorker: this.useWorker,
            workerReady: this._workerReady
        };
    }

    reset() {
        this.initialized = false;
        this.generation = 0;
        this._changedCells.length = 0;
        this.gridManager?.clear();

        if (this.useWorker && this.worker && this._workerReady) {
            this._syncToWorker();
        }

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

        if (this.useWorker && this.worker && this._workerReady) {
            this._syncToWorker();
        }

        console.debug('🔺 TriangleEngine: Grid limpiado');
    }

    deactivate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.isWorkerProcessing = false;
        this._pendingStep = false;
        this._workerReady = false;

        this.isActive = false;
        this.gridManager = null;
        this._newGrid = null;
        console.debug('🔺 Triangle Engine desactivado');
    }
}

window.TriangleEngine = TriangleEngine;