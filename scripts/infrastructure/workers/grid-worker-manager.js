import {AppConfig} from '../../utils/config.js';

/**
 * GridWorkerManager — Worker stateful con doble buffer.
 *
 * Usa getGridWidth y getGridHeight para grids rectangulares.
 * La serialización/deserialización emplea el índice plano x * height + y (column-major).
 */
class GridWorkerManager {
    /**
     * @param {Object}   options
     * @param {string}   options.workerPath
     * @param {number}   options.threshold     — máx(width,height) mínimo para activar worker
     * @param {Function} options.getGridWidth  — () => number
     * @param {Function} options.getGridHeight — () => number
     * @param {Function} options.getCore       — () => CellularAutomatonCore
     * @param {Function} options.onResult
     * @param {Function} options.onError
     */
    constructor({workerPath, threshold, getGridWidth, getGridHeight, getCore, onResult, onError}) {
        this._workerPath = workerPath;
        this.threshold = threshold ?? AppConfig.WORKER.THRESHOLD;
        this._getCore = getCore;
        this._onResult = onResult;
        this._onError = onError;

        this._getGridWidth = getGridWidth || (() => AppConfig.GRID.DEFAULT_WIDTH);
        this._getGridHeight = getGridHeight || (() => AppConfig.GRID.DEFAULT_HEIGHT);

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

    init() {
        this._terminate();

        const w = this._getGridWidth();
        const h = this._getGridHeight();
        if (Math.max(w, h) < this.threshold || !window.Worker) return;

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
                    this._applyResult(e.data);
                    this._onResult({
                        generation: e.data.generation,
                        population: e.data.population,
                        changedCells: new Uint32Array(e.data.changedCells),
                        changedCount: e.data.changedCount,
                        width: this._getGridWidth(),
                        height: this._getGridHeight()
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

            this._sendInit();

        } catch (err) {
            console.warn('No se pudo crear worker:', err);
            this._terminate();
        }
    }

    /**
     * Solicita N pasos al worker.
     * El worker los ejecuta internamente antes de responder, acumulando
     * los índices de celdas cambiadas en un único mensaje de retorno.
     * @param {number} [count=1]
     * @returns {boolean} true si el mensaje fue enviado
     */
    requestNextGeneration(count = 1) {
        if (!this.isAvailable) return false;
        this.isProcessing = true;
        this._worker.postMessage({type: 'step', data: {count}});
        return true;
    }

    syncGrid() {
        if (!this._worker || !this._isReady) return;
        const gridFlat = this._serializeGrid();
        this._worker.postMessage({type: 'sync', data: {gridFlat}}, [gridFlat.buffer]);
    }

    /**
     * Actualiza parámetros de simulación en el worker sin reinicializarlo.
     * Solo se envía si el worker existe, está listo y no está procesando un
     * paso — el worker es idle entre mensajes, por lo que el cambio se aplica
     * antes del siguiente 'step'.
     *
     * @param {Object} config
     * @param {boolean} [config.wrapEdges] — activa/desactiva modo toroidal
     */
    updateConfig(config) {
        if (!this._worker || !this._isReady) return;
        this._worker.postMessage({type: 'config', data: config});
    }

    cleanup() {
        this._terminate();
    }

    destroy() {
        this._terminate();
        this._onResult = null;
        this._onError = null;
        this._getCore = null;
        this._getGridWidth = null;
        this._getGridHeight = null;
    }

    // ── Privado ────────────────────────────────────────────────────────────────

    _sendInit() {
        const core = this._getCore();
        const w = this._getGridWidth();
        const h = this._getGridHeight();
        const gridFlat = this._serializeGrid();

        this._worker.postMessage({
            type: 'init',
            data: {
                gridFlat,
                width: w,
                height: h,
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
     * Serializa el grid column-major en un Uint8Array plano transferible.
     * Índice plano: x * height + y
     */
    _serializeGrid() {
        const w = this._getGridWidth();
        const h = this._getGridHeight();
        const grid = this._getCore().gridManager.grid;
        const flat = new Uint8Array(w * h);
        for (let x = 0; x < w; x++) {
            const col = grid[x];
            const base = x * h;
            for (let y = 0; y < h; y++) {
                flat[base + y] = col[y];
            }
        }
        return flat;
    }

    /**
     * Aplica el resultado del paso al grid del core usando los índices
     * de celdas cambiadas — sin recibir el grid completo.
     * Índice plano: x * height + y
     */
    _applyResult(data) {
        const h = this._getGridHeight();
        const grid = this._getCore().gridManager.grid;
        const changed = new Uint32Array(data.changedCells);
        const count = data.changedCount;

        for (let i = 0; i < count; i++) {
            const idx = changed[i];
            const x = (idx / h) | 0;
            const y = idx % h;
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

export {GridWorkerManager};