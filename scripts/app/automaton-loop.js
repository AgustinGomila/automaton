/**
 * AnimationLoop - Gestiona el bucle de animación RAF de la simulación.
 *
 * Responsabilidad: timing, velocidad y disparo del callback de paso.
 * No conoce nada de grids, motores ni renderer.
 */
class AnimationLoop {
    /**
     * @param {Object} options
     * @param {Function} options.onStep - Llamado cuando corresponde avanzar un paso.
     */
    constructor({onStep}) {
        this._onStep = onStep;
        this.updateInterval = 100;
        this._rafId = null;
        this._lastFrameTime = 0;
        this._running = false;
    }

    get isRunning() {
        return this._running;
    }

    start() {
        if (this._rafId) return;
        this._running = true;
        this._lastFrameTime = performance.now();
        this._rafId = requestAnimationFrame(t => this._tick(t));
    }

    stop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._running = false;
    }

    /**
     * @param {number} level - Nivel de velocidad 1-10
     * @returns {number} Intervalo en ms resultante
     */
    setSpeed(level) {
        const speedMap = [500, 250, 125, 60, 30, 16, 16, 16, 16, 16];
        this.updateInterval = speedMap[Math.min(level - 1, 9)] || 16;
        if (this._running) {
            this.stop();
            this.start();
        }
        return this.updateInterval;
    }

    _tick(currentTime) {
        if (!this._running) return;
        const deltaTime = currentTime - this._lastFrameTime;
        if (deltaTime >= this.updateInterval) {
            this._lastFrameTime = currentTime - (deltaTime % this.updateInterval);
            this._onStep();
        }
        this._rafId = requestAnimationFrame(t => this._tick(t));
    }

    destroy() {
        this.stop();
        this._onStep = null;
    }
}

window.AnimationLoop = AnimationLoop;