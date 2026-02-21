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

        this.destroboscope = false;
        this._twinRuleTable = new Uint8Array(8);

        this._ruleTable = new Uint8Array(8);
        this._changedCells = [];
        this._newGrid = null;

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
        const width = this.automaton.gridSize * 2;
        const height = this.automaton.gridSize;

        this.ruleNumber = options.rule ?? 50;
        this.wrapEdges = options.wrap ?? true;

        // Solo recrear grid si no existe o cambiaron dimensiones
        if (!this.gridManager || this.gridManager.width !== width || this.gridManager.height !== height) {
            this.gridManager = new TriangleGridManager(width, height);
            this._newGrid = Array.from({length: width}, () => new Uint8Array(height));
            this.initialized = false;
            this.isActive = true;
        } else if (!this.isActive) {
            // Reactivando después de desactivar
            this.isActive = true;
            this.initialized = false;
        }

        this._buildRuleTable();
        this._buildTwinRuleTable();
        this.generation = 0;

        // Worker init solo si es necesario
        if (!this.worker && this.useWorker) {
            this._initWorker();
        }
        if (this.worker && !this._workerReady) {
            this._syncToWorker();
        }

        return this;
    }

    _buildRuleTable() {
        const binary = (this.ruleNumber & 0xFF).toString(2).padStart(8, '0');
        for (let i = 0; i < 8; i++) {
            this._ruleTable[i] = binary[7 - i] === '1' ? 1 : 0;
        }
    }

    _buildTwinRuleTable() {
        // 1. Invertir bits del número de regla
        const inverted = (~this.ruleNumber) & 0xFF;
        // 2. Invertir orden de bits (reversa de 8 bits)
        let reversed = 0;
        for (let i = 0; i < 8; i++) {
            reversed = (reversed << 1) | ((inverted >> i) & 1);
        }
        // 3. Construir tabla del twin
        const binary = (reversed & 0xFF).toString(2).padStart(8, '0');
        for (let i = 0; i < 8; i++) {
            this._twinRuleTable[i] = binary[7 - i] === '1' ? 1 : 0;
        }
        this._twinRuleNumber = reversed & 0xFF;
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

    // Warm-up del worker
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

            const population = this.gridManager?.countPopulation() ?? 0;
            const totalCells = this.gridManager.width * this.gridManager.height;
            const density = (population / totalCells * 100).toFixed(1);
            eventBus.emit('stats:updated', {
                generation: this.generation,
                population,
                density
            });
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

        // Elegir tabla según destroboscopia y paridad
        const ruleTable = (this.destroboscope && (this.generation & 1) === 1)
            ? this._twinRuleTable
            : this._ruleTable;

        // Cache bounds
        const w = width, h = height;
        const wrap = this.wrapEdges;

        this._changedCells.length = 0;
        let changedCount = 0;
        const CHANGED_CAP = 100000;

        if (wrap) {
            // VERSIÓN WRAP - Sin branches de bounds, aritmética modular
            for (let r = 0; r < h; r++) {
                const rUp = (r - 1 + h) % h;
                const rDown = (r + 1) % h;

                for (let q = 0; q < w; q++) {
                    const isUp = ((q + r) & 1) === 0;
                    const col = currentGrid[q];
                    const currentState = col[r];

                    let sum = 0;

                    if (isUp) {
                        // △: vecinos [-1,0], [1,0], [0,1]
                        const leftQ = (q - 1 + w) % w;
                        const rightQ = (q + 1) % w;

                        sum = currentGrid[leftQ][r] + currentGrid[rightQ][r] + col[rDown];
                    } else {
                        // ▽: vecinos [0,-1], [-1,0], [1,0]
                        const leftQ = (q - 1 + w) % w;
                        const rightQ = (q + 1) % w;

                        sum = col[rUp] + currentGrid[leftQ][r] + currentGrid[rightQ][r];
                    }

                    const config = (currentState << 2) | sum;
                    const newState = ruleTable[config];

                    newGrid[q][r] = newState;

                    if (newState !== currentState && changedCount < CHANGED_CAP) {
                        this._changedCells[changedCount++] = (q << 16) | r;
                    }
                }
            }
        } else {
            // VERSIÓN BOUNDED - Con checks de límites
            for (let r = 0; r < h; r++) {
                for (let q = 0; q < w; q++) {
                    const isUp = ((q + r) & 1) === 0;
                    const col = currentGrid[q];
                    const currentState = col[r];

                    let sum = 0;

                    if (isUp) {
                        // △: [-1,0], [1,0], [0,1]
                        if (q > 0) sum += currentGrid[q - 1][r];
                        if (q < w - 1) sum += currentGrid[q + 1][r];
                        if (r < h - 1) sum += col[r + 1];
                    } else {
                        // ▽: [0,-1], [-1,0], [1,0]
                        if (r > 0) sum += col[r - 1];
                        if (q > 0) sum += currentGrid[q - 1][r];
                        if (q < w - 1) sum += currentGrid[q + 1][r];
                    }

                    const config = (currentState << 2) | sum;
                    const newState = ruleTable[config];

                    newGrid[q][r] = newState;

                    if (newState !== currentState && changedCount < CHANGED_CAP) {
                        this._changedCells[changedCount++] = (q << 16) | r;
                    }
                }
            }
        }

        // Swap grid references
        for (let q = 0; q < w; q++) {
            const temp = currentGrid[q];
            currentGrid[q] = newGrid[q];
            newGrid[q] = temp;
        }

        this._changedCells.length = changedCount;
        this.generation++;

        this._syncChangedToAutomaton();

        return changedCount > 0;
    }

    _syncChangedToAutomaton() {
        const autoSize = this.automaton.gridSize;
        const triWidth = this.gridManager.width;
        const triHeight = this.gridManager.height;
        const autoGrid = this.automaton.grid;
        const triGrid = this.gridManager.grid;

        // Scale factors
        const scaleX = triWidth / autoSize;
        const scaleY = triHeight / autoSize;

        // Track which auto cells were modified to avoid redundant marks
        const modifiedAutoCells = new Uint8Array(autoSize * autoSize);
        let modifiedCount = 0;

        for (let i = 0; i < this._changedCells.length; i++) {
            const packed = this._changedCells[i];
            const q = packed >>> 16;
            const r = packed & 0xFFFF;

            // Mapeo inverso: triangular -> automaton
            const autoX = Math.floor(q / scaleX);
            const autoY = Math.floor(r / scaleY);

            if (autoX >= 0 && autoX < autoSize && autoY >= 0 && autoY < autoSize) {
                const autoIdx = autoX * autoSize + autoY;

                if (!modifiedAutoCells[autoIdx]) {
                    modifiedAutoCells[autoIdx] = 1;
                    modifiedCount++;

                    // Samplear área del triángulo para determinar estado
                    const qStart = Math.floor(autoX * scaleX);
                    const qEnd = Math.min(Math.floor((autoX + 1) * scaleX), triWidth);
                    const rStart = Math.floor(autoY * scaleY);
                    const rEnd = Math.min(Math.floor((autoY + 1) * scaleY), triHeight);

                    let aliveCount = 0;
                    let totalCount = 0;

                    for (let tq = qStart; tq < qEnd; tq++) {
                        const triCol = triGrid[tq];
                        for (let tr = rStart; tr < rEnd; tr++) {
                            if (triCol[tr]) aliveCount++;
                            totalCount++;
                        }
                    }

                    // Mayoría determina estado
                    const newState = aliveCount > (totalCount >> 1) ? 1 : 0;

                    if (autoGrid[autoX][autoY] !== newState) {
                        autoGrid[autoX][autoY] = newState;
                        this.automaton.renderer.markDirty(autoX, autoY);
                    }
                }
            }
        }

        return modifiedCount;
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
            destroboscope: this.destroboscope,
            population: this.gridManager?.countPopulation() ?? 0,
            useWorker: this.useWorker,
            workerReady: this._workerReady
        };
    }

    /**
     * @param {boolean} clearGrid - Si true, limpia el grid. Default false para cambios de config.
     */
    reset(clearGrid = false) {
        this.initialized = false;
        this.generation = 0;
        this._changedCells.length = 0;

        if (clearGrid && this.gridManager) {
            this.gridManager.clear();
        }

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