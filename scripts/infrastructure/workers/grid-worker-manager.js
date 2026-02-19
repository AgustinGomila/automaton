/**
 * GridWorkerManager - Gestiona el Web Worker del grid estándar.
 *
 * Responsabilidad: ciclo de vida del worker (init, cleanup),
 * serialización del grid para envío, y recepción de resultados.
 *
 * No conoce renderizado, stats, ni motores especiales.
 */
class GridWorkerManager {
    /**
     * @param {Object} options
     * @param {string}   options.workerPath  - Ruta al script del worker
     * @param {number}   options.threshold   - Tamaño mínimo de grid para usar worker
     * @param {Function} options.getGridSize - () => number
     * @param {Function} options.getCore     - () => CellularAutomatonCore
     * @param {Function} options.onResult    - ({ generation, population, changedCells, size }) => void
     * @param {Function} options.onError     - () => void
     */
    constructor({workerPath, threshold, getGridSize, getCore, onResult, onError}) {
        this._workerPath = workerPath;
        this.threshold = threshold ?? 100;
        this._getGridSize = getGridSize;
        this._getCore = getCore;
        this._onResult = onResult;
        this._onError = onError;

        this._worker = null;
        this._currentHandlerId = null;
        this.isProcessing = false;
    }

    get isAvailable() {
        return !!this._worker && !this.isProcessing;
    }

    /**
     * Inicializa el worker si el tamaño de grid supera el umbral.
     * Si ya existía uno, lo termina primero.
     */
    init() {
        this._terminate();

        const size = this._getGridSize();
        if (size < this.threshold || !window.Worker) return;

        try {
            this._worker = new Worker(this._workerPath);
            const handlerId = `worker_handler_${Date.now()}`;
            this._currentHandlerId = handlerId;

            this._worker.onmessage = (e) => {
                if (this._currentHandlerId !== handlerId) return;

                const {newGrid, changedCells, population, generation, error} = e.data;

                if (error) {
                    console.error('Error en worker:', error);
                    this.isProcessing = false;
                    this._terminate();
                    return;
                }

                if (!this._worker || this._currentHandlerId !== handlerId) return;

                if (!newGrid || !Array.isArray(newGrid)) {
                    console.error('Grid inválido desde worker:', newGrid);
                    this.isProcessing = false;
                    return;
                }

                // Escribir resultado en el grid del core
                const gridSize = this._getGridSize();
                const coreGrid = this._getCore().gridManager.grid;
                for (let x = 0; x < gridSize; x++) {
                    const col = newGrid[x];
                    if (col instanceof Uint8Array && col.length === gridSize) {
                        coreGrid[x].set(col);
                    } else if (Array.isArray(col) || ArrayBuffer.isView(col)) {
                        for (let y = 0; y < gridSize && y < col.length; y++) {
                            coreGrid[x][y] = col[y] ? 1 : 0;
                        }
                    }
                }

                this.isProcessing = false;
                this._onResult({generation, population, changedCells, size: gridSize});
            };

            this._worker.onerror = (error) => {
                if (this._currentHandlerId !== handlerId) return;
                console.error('Worker error:', error);
                this.isProcessing = false;
                this._terminate();
                this._onError();
            };

        } catch (error) {
            console.warn('No se pudo crear worker:', error);
            this._terminate();
        }
    }

    /**
     * Envía el grid actual al worker para calcular la siguiente generación.
     * @returns {boolean} true si el envío se realizó, false si el worker no está disponible
     */
    requestNextGeneration(generation = 0) {
        if (this.isProcessing || !this._worker) return false;

        this.isProcessing = true;

        const size = this._getGridSize();
        const core = this._getCore();
        const grid = core.gridManager.grid;
        const flatGrid = new Uint8Array(size * size);

        for (let x = 0; x < size; x++) {
            const col = grid[x];
            const baseIdx = x * size;
            for (let y = 0; y < size; y++) {
                flatGrid[baseIdx + y] = col[y] ? 1 : 0;
            }
        }

        const messageData = {
            grid: flatGrid,
            gridSize: size,
            rule: {birth: core.ruleEngine.birth, survival: core.ruleEngine.survival},
            wrapEdges: core.neighborhood.wrapEdges,
            neighborhoodType: core.neighborhood.type,
            neighborhoodRadius: core.neighborhood.radius,
            neighborOffsets: core.neighborhood._offsets,
            generation: generation
        };

        try {
            this._worker.postMessage(messageData, [flatGrid.buffer]);
        } catch (e) {
            this._worker.postMessage(messageData);
        }

        return true;
    }

    /**
     * Termina el worker inmediatamente y limpia el estado.
     */
    cleanup() {
        this._terminate();
    }

    destroy() {
        this._terminate();
        this._onResult = null;
        this._onError = null;
        this._getCore = null;
        this._getGridSize = null;
    }

    // ─── Privado ─────────────────────────────────────────────────

    _terminate() {
        if (this._worker) {
            this._currentHandlerId = null;
            this._worker.terminate();
            this._worker = null;
            this.isProcessing = false;
        }
    }
}

window.GridWorkerManager = GridWorkerManager;