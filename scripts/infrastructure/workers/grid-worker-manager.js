/**
 * GridWorkerManager — Worker stateful con doble buffer.
 *
 * Protocolo (ver automaton-worker.js):
 *   init  → worker construye grid interno, responde 'ready'
 *   step  → worker calcula un paso, responde 'result' con changedCells transferible
 *   sync  → sincroniza el grid interno tras una edición manual en el hilo principal
 *
 * La diferencia clave respecto al worker anterior es que el grid NO viaja
 * de vuelta en cada respuesta: solo los índices de celdas cambiadas (array pequeño).
 * Esto elimina la serialización O(n²) en cada paso.
 */
class GridWorkerManager {
    /**
     * @param {Object}   options
     * @param {string}   options.workerPath
     * @param {number}   options.threshold    — tamaño mínimo de grid para activar worker
     * @param {Function} options.getGridSize  — () => number
     * @param {Function} options.getCore      — () => CellularAutomatonCore
     * @param {Function} options.onResult     — ({generation, population, changedCells, changedCount}) => void
     * @param {Function} options.onError      — () => void
     */
    constructor({workerPath, threshold, getGridSize, getCore, onResult, onError}) {
        this._workerPath = workerPath;
        this.threshold = threshold ?? 600;
        this._getGridSize = getGridSize;
        this._getCore = getCore;
        this._onResult = onResult;
        this._onError = onError;

        this._worker = null;
        this._handlerId = null;
        this.isProcessing = false;
        this._isReady = false;
    }

    // ── Getters ────────────────────────────────────────────────────────────────

    get isAvailable() {
        return !!this._worker && this._isReady && !this.isProcessing;
    }

    // ── Ciclo de vida ──────────────────────────────────────────────────────────

    /**
     * Crea el worker y lo inicializa con el estado actual del grid.
     * Si ya existía uno, lo termina primero.
     */
    init() {
        this._terminate();

        const size = this._getGridSize();
        if (size < this.threshold || !window.Worker) return;

        try {
            this._worker = new Worker(this._workerPath);
            this._isReady = false;
            const handlerId = `wh_${Date.now()}`;
            this._handlerId = handlerId;

            this._worker.onmessage = (e) => {
                if (this._handlerId !== handlerId) return;
                const {type} = e.data;

                if (type === 'ready') {
                    this._isReady = true;
                    return;
                }

                if (type === 'result') {
                    this.isProcessing = false;
                    // Sincronizar grid del core con el resultado del worker
                    this._applyResult(e.data);
                    this._onResult({
                        generation: e.data.generation,
                        population: e.data.population,
                        changedCells: new Uint32Array(e.data.changedCells),
                        changedCount: e.data.changedCount,
                        size: this._getGridSize()
                    });
                    return;
                }

                if (type === 'error') {
                    console.error('Worker error:', e.data.message);
                    this.isProcessing = false;
                    this._terminate();
                    this._onError();
                }
            };

            this._worker.onerror = (err) => {
                if (this._handlerId !== handlerId) return;
                console.error('Worker onerror:', err);
                this.isProcessing = false;
                this._terminate();
                this._onError();
            };

            // Enviar estado inicial al worker
            this._sendInit();

        } catch (err) {
            console.warn('No se pudo crear worker:', err);
            this._terminate();
        }
    }

    /**
     * Solicita un paso al worker.
     * @returns {boolean} true si el mensaje fue enviado
     */
    requestNextGeneration() {
        if (!this.isAvailable) return false;
        this.isProcessing = true;
        this._worker.postMessage({type: 'step'});
        return true;
    }

    /**
     * Sincroniza el grid interno del worker tras una edición manual
     * (clear, randomize, paste, undo, etc.).
     * Llamar siempre que el hilo principal modifique el grid mientras
     * el worker está activo.
     */
    syncGrid() {
        if (!this._worker || !this._isReady) return;
        const gridFlat = this._serializeGrid();
        this._worker.postMessage({type: 'sync', data: {gridFlat}}, [gridFlat.buffer]);
    }

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

    // ── Privado ────────────────────────────────────────────────────────────────

    _sendInit() {
        const core = this._getCore();
        const size = this._getGridSize();
        const gridFlat = this._serializeGrid();

        this._worker.postMessage({
            type: 'init',
            data: {
                gridFlat,
                size,
                rule: {
                    birth: core.ruleEngine.birth,
                    survival: core.ruleEngine.survival
                },
                wrapEdges: core.neighborhood.wrapEdges,
                neighborOffsets: core.neighborhood._offsets,
                generation: 0
            }
        }, [gridFlat.buffer]);
    }

    /**
     * Serializa el grid column-major actual en un Uint8Array plano transferible.
     * row-major (x * size + y) para compatibilidad con el worker.
     */
    _serializeGrid() {
        const size = this._getGridSize();
        const grid = this._getCore().gridManager.grid;
        const flat = new Uint8Array(size * size);
        for (let x = 0; x < size; x++) {
            const col = grid[x];
            const base = x * size;
            for (let y = 0; y < size; y++) {
                flat[base + y] = col[y];
            }
        }
        return flat;
    }

    /**
     * Aplica el resultado del paso al grid del core usando los índices
     * de celdas cambiadas — sin recibir el grid completo.
     * El worker y el core comparten la misma función de paso, así que
     * basta con invertir el estado en las posiciones indicadas.
     */
    _applyResult(data) {
        const size = this._getGridSize();
        const grid = this._getCore().gridManager.grid;
        const changed = new Uint32Array(data.changedCells);
        const count = data.changedCount;

        for (let i = 0; i < count; i++) {
            const idx = changed[i];
            const x = (idx / size) | 0;
            const y = idx % size;
            // El worker ya aplicó el paso: simplemente invertir el estado.
            grid[x][y] = grid[x][y] ? 0 : 1;
        }
    }

    _terminate() {
        if (this._worker) {
            this._handlerId = null;
            this._worker.terminate();
            this._worker = null;
            this._isReady = false;
            this.isProcessing = false;
        }
    }
}

window.GridWorkerManager = GridWorkerManager;