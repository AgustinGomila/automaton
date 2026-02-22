/**
 * AnimationLoop - Gestiona el bucle de animación RAF de la simulación.
 *
 * Responsabilidad: timing, velocidad y disparo del callback de paso.
 * No conoce nada de grids, motores ni renderer.
 */
class AnimationLoop {
    /**
     * @param {Object} options
     * @param {Function} options.onStep - Llamado con (stepsPerFrame) cuando corresponde avanzar.
     */
    constructor({onStep}) {
        this._onStep = onStep;
        this.updateInterval = 100;
        this.stepsPerFrame = 1;
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
     * @returns {{interval: number, stepsPerFrame: number}}
     */
    setSpeed(level) {
        //                     1    2    3   4   5   6  7  8  9  10
        const intervalMap = [500, 250, 125, 60, 30, 16, 16, 16, 16, 16];
        const stepsMap = [1, 1, 1, 1, 1, 1, 2, 4, 8, 16];

        const idx = Math.min(Math.max(level - 1, 0), 9);
        this.updateInterval = intervalMap[idx];
        this.stepsPerFrame = stepsMap[idx];

        if (this._running) {
            this.stop();
            this.start();
        }
        return {interval: this.updateInterval, stepsPerFrame: this.stepsPerFrame};
    }

    _tick(currentTime) {
        if (!this._running) return;
        const deltaTime = currentTime - this._lastFrameTime;
        if (deltaTime >= this.updateInterval) {
            this._lastFrameTime = currentTime - (deltaTime % this.updateInterval);
            this._onStep(this.stepsPerFrame);
        }
        if (this._running) {
            this._rafId = requestAnimationFrame(t => this._tick(t));
        }
    }

    destroy() {
        this.stop();
        this._onStep = null;
    }
}

window.AnimationLoop = AnimationLoop;