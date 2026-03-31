/**
 * TriangleWorkerManager - Gestiona el ciclo de vida del Web Worker del autómata triangular.
 *
 * Responsabilidad exclusiva: ciclo de vida del worker (spawn, init, ping/pong warmup,
 * serialización del grid, recepción de resultados) para el protocolo stateful de ETA.
 *
 * Protocolo del worker:
 *   → {type:'init', data:{width,height,ruleNumber,wrapEdges,gridBuffer}}  (Transferable)
 *   → {type:'step'}
 *   → {type:'ping'}
 *   ← {type:'init'}          worker inicializado
 *   ← {type:'pong', isInitialized}
 *   ← {type:'step', result, gridBuffer, changedCells}  (Transferable)
 *   ← {type:'error', error}
 *
 * A diferencia de GridWorkerManager (stateless, fire-and-forget), este worker
 * mantiene su propio estado entre mensajes para evitar re-enviar el grid completo
 * en cada paso.
 */
class TriangleWorkerManager {
    /**
     * @param {Object}   options
     * @param {string}   options.workerPath  - Ruta al script del worker
     * @param {Function} options.onResult    - ({result, gridBuffer, changedCellsBuffer}) => void
     * @param {Function} [options.onReady]   - () => void  — llamado cuando el worker está listo
     * @param {Function} [options.onError]   - () => void  — llamado en error irrecuperable
     */
    constructor({workerPath, onResult, onReady, onError}) {
        this._workerPath = workerPath;
        this._onResult = onResult;
        this._onReady = onReady ?? (() => {
        });
        this._onError = onError ?? (() => {
        });

        this._worker = null;
        this._isReady = false;   // true tras recibir {type:'init'} del worker
        this.isProcessing = false;
    }

    // ─── Getters públicos ────────────────────────────────────────

    /** true si el worker existe, está inicializado y no hay un paso en vuelo */
    get isAvailable() {
        return !!this._worker && this._isReady && !this.isProcessing;
    }

    get isReady() {
        return this._isReady;
    }

    // ─── Ciclo de vida ───────────────────────────────────────────

    /**
     * Crea el worker y configura los handlers.
     * No envía datos todavía — llamar a sync() después.
     * Si ya existía un worker, lo termina primero.
     */
    init() {
        this._terminate();
        this._isReady = false;

        if (!window.Worker) return;

        try {
            this._worker = new Worker(this._workerPath);

            this._worker.onmessage = (e) => this._handleMessage(e);

            this._worker.onerror = (err) => {
                console.error('TriangleWorkerManager: worker error', err);
                this._isReady = false;
                this.isProcessing = false;
                this._onError();
            };

        } catch (err) {
            console.warn('TriangleWorkerManager: no se pudo crear worker', err);
            this._worker = null;
        }
    }

    /**
     * Envía el estado inicial al worker (protocolo init con Transferable).
     * Debe llamarse después de init() y antes del primer step().
     *
     * @param {TriangleGridManager} gridManager
     * @param {number}              ruleNumber
     * @param {boolean}             wrapEdges
     */
    sync(gridManager, ruleNumber, wrapEdges, destroboscope = false) {
        if (!this._worker) return;

        this._isReady = false;

        const {width, height} = gridManager;
        const flatSize = width * height;
        const gridBuffer = new ArrayBuffer(flatSize);
        const flatGrid = new Uint8Array(gridBuffer);

        for (let q = 0; q < width; q++) {
            const col = gridManager.grid[q];
            const offset = q * height;
            for (let r = 0; r < height; r++) {
                flatGrid[offset + r] = col[r];
            }
        }

        this._worker.postMessage({
            type: 'init',
            data: {width, height, ruleNumber, wrapEdges, destroboscope, gridBuffer}
        }, [gridBuffer]);
    }

    /**
     * Espera hasta que el worker confirme estar inicializado (ping/pong).
     * @param {number} [timeoutMs=5000]
     * @returns {Promise<boolean>}
     */
    warmup(timeoutMs = 5000) {
        if (!this._worker) return Promise.resolve(false);
        if (this._isReady) return Promise.resolve(true);

        return new Promise((resolve) => {
            const deadline = setTimeout(() => {
                console.warn('TriangleWorkerManager: warm-up timeout');
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
     * @returns {boolean} true si el mensaje fue enviado, false si no está disponible
     */
    step() {
        if (!this.isAvailable) return false;

        this.isProcessing = true;
        this._worker.postMessage({type: 'step'});
        return true;
    }

    /**
     * Termina el worker y libera recursos.
     * Después de llamar esto el manager puede reutilizarse con init().
     */
    cleanup() {
        this._terminate();
    }

    /**
     * Limpia todo y anula los callbacks. No reutilizable después.
     */
    destroy() {
        this._terminate();
        this._onResult = null;
        this._onReady = null;
        this._onError = null;
    }

    // ─── Privado ─────────────────────────────────────────────────

    _handleMessage(e) {
        const {type, result, gridBuffer, changedCells, isInitialized} = e.data;

        switch (type) {
            case 'ready':
                // El worker está cargado pero aún no inicializado con datos
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
                console.error('TriangleWorkerManager: error del worker', e.data.error);
                this.isProcessing = false;
                this._isReady = false;
                this._onError?.();
                break;

            default:
                // Mensajes desconocidos ignorados silenciosamente
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

window.TriangleWorkerManager = TriangleWorkerManager;