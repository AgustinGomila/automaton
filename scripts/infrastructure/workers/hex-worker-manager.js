/**
 * HexWorkerManager — Gestiona el ciclo de vida del Web Worker del autómata hexagonal.
 *
 * Protocolo idéntico al de TriangleWorkerManager — solo difiere en:
 *   - La ruta del worker (hex-worker.js)
 *   - El payload de sync(): birthSet/survivalSet en lugar de ruleNumber
 *
 * Protocolo del worker:
 *   → {type:'init', data:{width,height,birthSet,survivalSet,wrapEdges,gridBuffer}}
 *   → {type:'step'}
 *   → {type:'ping'}
 *   ← {type:'ready'}
 *   ← {type:'pong', isInitialized}
 *   ← {type:'init', result}
 *   ← {type:'step', result, gridBuffer, changedCells}  (Transferable)
 *   ← {type:'error', error}
 */
class HexWorkerManager {
    /**
     * @param {Object}   options
     * @param {string}   options.workerPath
     * @param {Function} options.onResult  — ({result, gridBuffer, changedCellsBuffer}) => void
     * @param {Function} [options.onReady]
     * @param {Function} [options.onError]
     */
    constructor({workerPath, onResult, onReady, onError}) {
        this._workerPath = workerPath;
        this._onResult = onResult;
        this._onReady = onReady ?? (() => {
        });
        this._onError = onError ?? (() => {
        });

        this._worker = null;
        this._isReady = false;
        this.isProcessing = false;
    }

    // ─── Getters ─────────────────────────────────────────────────────────────

    get isAvailable() {
        return !!this._worker && this._isReady && !this.isProcessing;
    }

    get isReady() {
        return this._isReady;
    }

    // ─── Ciclo de vida ────────────────────────────────────────────────────────

    init() {
        this._terminate();
        this._isReady = false;
        if (!window.Worker) return;

        try {
            this._worker = new Worker(this._workerPath);
            this._worker.onmessage = (e) => this._handleMessage(e);
            this._worker.onerror = (err) => {
                console.error('HexWorkerManager: worker error', err);
                this._isReady = false;
                this.isProcessing = false;
                this._onError();
            };
        } catch (err) {
            console.warn('HexWorkerManager: no se pudo crear worker', err);
            this._worker = null;
        }
    }

    /**
     * Envía el estado inicial al worker.
     * @param {HexGridManager} gridManager
     * @param {number[]}       birthSet     — vecinos que hacen nacer (0–6)
     * @param {number[]}       survivalSet  — vecinos que hacen sobrevivir (0–6)
     * @param {boolean}        wrapEdges
     */
    sync(gridManager, birthSet, survivalSet, wrapEdges) {
        if (!this._worker) return;
        this._isReady = false;

        const {width, height} = gridManager;
        const gridBuffer = new ArrayBuffer(width * height);
        const flat = new Uint8Array(gridBuffer);

        for (let c = 0; c < width; c++) {
            const col = gridManager.grid[c];
            const offset = c * height;
            for (let r = 0; r < height; r++) {
                flat[offset + r] = col[r];
            }
        }

        this._worker.postMessage(
            {type: 'init', data: {width, height, birthSet, survivalSet, wrapEdges, gridBuffer}},
            [gridBuffer]
        );
    }

    /**
     * Espera confirmación de inicialización del worker.
     * @param {number} [timeoutMs=5000]
     * @returns {Promise<boolean>}
     */
    warmup(timeoutMs = 5000) {
        if (!this._worker) return Promise.resolve(false);
        if (this._isReady) return Promise.resolve(true);

        return new Promise((resolve) => {
            const deadline = setTimeout(() => {
                console.warn('HexWorkerManager: warm-up timeout');
                resolve(false);
            }, timeoutMs);

            const poll = () => {
                if (this._isReady) {
                    clearTimeout(deadline);
                    resolve(true);
                    return;
                }
                this._worker?.postMessage({type: 'ping'});
                setTimeout(poll, 50);
            };
            poll();
        });
    }

    /**
     * Solicita el siguiente paso al worker.
     * @returns {boolean}
     */
    step() {
        if (!this.isAvailable) return false;
        this.isProcessing = true;
        this._worker.postMessage({type: 'step'});
        return true;
    }

    cleanup() {
        this._terminate();
    }

    destroy() {
        this._terminate();
        this._onResult = null;
        this._onReady = null;
        this._onError = null;
    }

    // ─── Privado ──────────────────────────────────────────────────────────────

    _handleMessage(e) {
        const {type, result, gridBuffer, changedCells, isInitialized} = e.data;

        switch (type) {
            case 'ready':
                break;

            case 'pong':
                if (isInitialized) {
                    this._isReady = true;
                    this._onReady();
                }
                break;

            case 'init':
                this._isReady = true;
                this._onReady();
                break;

            case 'step':
                this.isProcessing = false;
                this._onResult?.({result, gridBuffer, changedCellsBuffer: changedCells});
                break;

            case 'error':
                console.error('HexWorkerManager: error del worker', e.data.error);
                this.isProcessing = false;
                this._isReady = false;
                this._onError?.();
                break;
        }
    }

    _terminate() {
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
            this._isReady = false;
            this.isProcessing = false;
        }
    }
}

export {HexWorkerManager};