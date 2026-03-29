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

        // Worker: gestionado por TriangleWorkerManager (composición)
        this._workerManager = null;
        this.useWorker = false;
        this.workerThreshold = AppConfig.WORKER.TRIANGLE_THRESHOLD;
        this._pendingStep = false;
    }

    activate(options = {}) {
        // Preservar las proporciones del grid rectangular:
        //   triWidth  = gridWidth  * 2  (cada celda rectangular mapea a 2 triángulos en X)
        //   triHeight = gridHeight      (1:1 en Y)
        // Para grids cuadrados esto equivale al comportamiento anterior (size*2 / size).
        const width = this.automaton.gridWidth * 2;
        const height = this.automaton.gridHeight;

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

        // Crear/sincronizar el worker manager si corresponde
        const shouldUseWorker = this.useWorker &&
            (this.gridManager.width * this.gridManager.height >= this.workerThreshold * this.workerThreshold);

        if (shouldUseWorker) {
            if (!this._workerManager) {
                this._workerManager = new TriangleWorkerManager({
                    workerPath: 'scripts/infrastructure/workers/triangle-worker.js',
                    onResult: (raw) => this._onWorkerResult(raw),
                    onReady: () => console.debug('🔺 TriangleWorkerManager: listo'),
                    onError: () => {
                        console.warn('🔺 TriangleWorkerManager: error — usando modo síncrono');
                        this.useWorker = false;
                        this._workerManager?.destroy();
                        this._workerManager = null;
                    }
                });
                this._workerManager.init();
            }
            this._workerManager.sync(this.gridManager, this.ruleNumber, this.wrapEdges);
        } else if (this._workerManager) {
            // Ya no supera el umbral: liberar worker
            this._workerManager.destroy();
            this._workerManager = null;
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
     * Redimensiona el grid triangular.
     *
     * La relación geométrica es fija: cada celda rectangular mapea a 2 triángulos
     * en X, y a 1 en Y.  Por eso:
     *   triWidth  = rectWidth  * 2
     *   triHeight = rectHeight
     *
     * @param {number} rectWidth  — ancho del grid rectangular de referencia
     * @param {number} [rectHeight=rectWidth] — alto del grid rectangular (cuadrado si se omite)
     */
    resize(rectWidth, rectHeight = rectWidth) {
        if (!this.isActive || !this.gridManager) return;

        const newWidth = rectWidth * 2;
        const newHeight = rectHeight;

        if (this.gridManager.width === newWidth && this.gridManager.height === newHeight) {
            return;
        }

        console.debug(`🔺 Triangle Engine resize: ${this.gridManager.width}×${this.gridManager.height} → ${newWidth}×${newHeight}`);

        // Copia anclada en la esquina superior izquierda.
        // Las celdas que caben en el nuevo tamaño se preservan exactamente;
        // las que quedan fuera se pierden. No se escala ni se desplaza el dibujo.
        const oldGrid = this.gridManager.grid;
        const oldWidth = this.gridManager.width;
        const oldHeight = this.gridManager.height;
        const copyW = Math.min(oldWidth, newWidth);
        const copyH = Math.min(oldHeight, newHeight);

        this.gridManager = new TriangleGridManager(newWidth, newHeight);
        this._newGrid = Array.from({length: newWidth}, () => new Uint8Array(newHeight));

        for (let q = 0; q < copyW; q++) {
            const srcCol = oldGrid[q];
            const dstCol = this.gridManager.grid[q];
            for (let r = 0; r < copyH; r++) {
                dstCol[r] = srcCol[r];
            }
        }

        // Notificar al renderer del nuevo gridManager.
        // NO se pasa cellSize: el renderer mantiene el suyo propio.
        // Cambiar zoom es responsabilidad exclusiva de setCellSize(), no de resize().
        if (this.automaton?.renderer?.setGridManager) {
            this.automaton.renderer.setGridManager(this.gridManager);
            this.automaton.renderer.resize(rectWidth);
        }

        // Sincronizar worker con nuevas dimensiones
        if (this._workerManager?.isReady) {
            this._workerManager.sync(this.gridManager, this.ruleNumber, this.wrapEdges);
        }

        // Sincronizar con grid principal
        this._syncToAutomaton();
    }

    // ========== WORKER RESULT HANDLER ==========

    /**
     * Callback invocado por TriangleWorkerManager cuando el worker completa un paso.
     * Deserializa los buffers, sincroniza el grid y dispara el render.
     *
     * @param {Object} raw
     * @param {Object}      raw.result               - {generation, hasChanges, changedCount}
     * @param {ArrayBuffer} raw.gridBuffer            - Grid plano serializado (Transferable)
     * @param {ArrayBuffer} raw.changedCellsBuffer    - Pares [q,r] de celdas modificadas
     */
    _onWorkerResult({result, gridBuffer, changedCellsBuffer}) {
        if (!this.isActive) return;

        // Deserializar grid
        if (gridBuffer) {
            const flatGrid = new Uint8Array(gridBuffer);
            const width = this.gridManager.width;
            const height = this.gridManager.height;

            for (let q = 0; q < width; q++) {
                const col = this.gridManager.grid[q];
                const offset = q * height;
                for (let r = 0; r < height; r++) {
                    col[r] = flatGrid[offset + r];
                }
            }
        }

        // Deserializar celdas modificadas
        this._changedCells.length = 0;
        if (changedCellsBuffer && result.changedCount > 0) {
            const arr = new Int32Array(changedCellsBuffer);
            for (let i = 0; i < result.changedCount; i++) {
                this._changedCells.push({x: arr[i * 2], y: arr[i * 2 + 1]});
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
            eventBus.emit('stats:updated', {generation: this.generation, population, density});
        }

        // Si hubo un paso pendiente mientras el worker estaba ocupado, ejecutarlo ahora
        if (this._pendingStep) {
            this._pendingStep = false;
            this.step();
        }
    }

    async step() {
        if (!this.isActive || !this.gridManager) return false;

        // Si el worker está procesando, encolar un paso pendiente
        if (this._workerManager?.isProcessing) {
            this._pendingStep = true;
            return true;
        }

        if (!this.initialized) {
            this._initializeFromAutomaton();
            this.initialized = true;

            // Warm-up del worker antes del primer paso offloaded
            if (this._workerManager) {
                const warmedUp = await this._workerManager.warmup();
                if (!warmedUp) {
                    console.warn('🔺 TriangleWorkerManager: warm-up fallido — modo síncrono');
                    this._workerManager.destroy();
                    this._workerManager = null;
                    this.useWorker = false;
                }
            }

            return true;
        }

        // Intentar offload al worker
        if (this._workerManager?.step()) {
            return true;
        }

        // Fallback: cálculo síncrono en el hilo principal
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
                const hasUp = r > 0;
                const hasDown = r < h - 1;

                for (let q = 0; q < w; q++) {
                    const isUp = ((q + r) & 1) === 0;
                    const col = currentGrid[q];
                    const currentState = col[r];

                    let sum = 0;

                    if (isUp) {
                        // △: [-1,0], [1,0], [0,1]
                        if (q > 0) sum += currentGrid[q - 1][r];
                        if (q < w - 1) sum += currentGrid[q + 1][r];
                        if (hasDown) sum += col[r + 1];
                    } else {
                        // ▽: [0,-1], [-1,0], [1,0]
                        if (hasUp) sum += col[r - 1];
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
        const autoW = this.automaton.gridWidth;
        const autoH = this.automaton.gridHeight;
        const triWidth = this.gridManager.width;
        const triHeight = this.gridManager.height;
        const autoGrid = this.automaton.grid;
        const triGrid = this.gridManager.grid;

        // Factores de escala (con grid rectangular: scaleX=2, scaleY=1)
        const scaleX = triWidth / autoW;
        const scaleY = triHeight / autoH;

        // Bitmap de deduplicación: índice column-major x * autoH + y
        const modifiedAutoCells = new Uint8Array(autoW * autoH);
        let modifiedCount = 0;

        for (let i = 0; i < this._changedCells.length; i++) {
            const packed = this._changedCells[i];
            const q = packed >>> 16;
            const r = packed & 0xFFFF;

            // Mapeo inverso: triangular → automaton
            const autoX = Math.floor(q / scaleX);
            const autoY = Math.floor(r / scaleY);

            if (autoX >= 0 && autoX < autoW && autoY >= 0 && autoY < autoH) {
                const autoIdx = autoX * autoH + autoY;   // column-major

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
        const autoW = this.automaton.gridWidth;
        const autoH = this.automaton.gridHeight;
        const centerQ = Math.floor(this.gridManager.width / 2);
        const centerR = Math.floor(this.gridManager.height / 2);
        const autoGrid = this.automaton.grid;

        // Offset para centrar el grid rectangular en el triangular
        const halfW = autoW >> 1;
        const halfH = autoH >> 1;

        for (let x = 0; x < autoW; x++) {
            for (let y = 0; y < autoH; y++) {
                if (autoGrid[x][y]) {
                    const tq = centerQ + x - halfW;
                    const tr = centerR + y - halfH;
                    if (this.gridManager.isValid(tq, tr)) {
                        this.gridManager.grid[tq][tr] = 1;
                    }
                }
            }
        }

        this._syncToAutomaton();
    }

    _syncToAutomaton() {
        // Mapeo: samplear el grid triangular al rectangular
        const autoW = this.automaton.gridWidth;
        const autoH = this.automaton.gridHeight;
        const triGrid = this.gridManager.grid;
        const autoGrid = this.automaton.grid;

        const scaleX = this.gridManager.width / autoW;
        const scaleY = this.gridManager.height / autoH;

        for (let x = 0; x < autoW; x++) {
            const tq = Math.floor(x * scaleX);
            if (tq >= this.gridManager.width) continue;

            const triCol = triGrid[tq];

            for (let y = 0; y < autoH; y++) {
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
            workerReady: this._workerManager?.isReady ?? false
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

        if (this._workerManager?.isReady) {
            this._workerManager.sync(this.gridManager, this.ruleNumber, this.wrapEdges);
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

        if (this._workerManager?.isReady) {
            this._workerManager.sync(this.gridManager, this.ruleNumber, this.wrapEdges);
        }

        console.debug('🔺 TriangleEngine: Grid limpiado');
    }

    deactivate() {
        this._workerManager?.destroy();
        this._workerManager = null;
        this._pendingStep = false;

        this.isActive = false;
        this.gridManager = null;
        this._newGrid = null;
        console.debug('🔺 Triangle Engine desactivado');
    }
}

window.TriangleEngine = TriangleEngine;