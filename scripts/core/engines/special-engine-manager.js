/**
 * SpecialEngineManager - Gestiona los motores especiales de simulación.
 *
 * Responsabilidad: ciclo de vida (activación, desactivación, swap de renderer)
 * de WolframEngine, RD2DEngine y TriangleEngine.
 *
 * No conoce el bucle de animación ni la lógica de límites.
 */
class SpecialEngineManager {
    /**
     * @param {Object} options
     * @param {Function} options.getRenderer  - () => renderer actual del automaton
     * @param {Function} options.setRenderer  - (r) => asigna nuevo renderer al automaton
     * @param {Function} options.getCore      - () => core actual del automaton
     * @param {Function} options.setCore      - (c) => asigna core al automaton (restauración)
     * @param {Function} options.getGridSize  - () => gridSize actual
     * @param {Function} options.getCellSize  - () => cellSize actual
     */
    constructor({getRenderer, setRenderer, getCore, setCore, getGridSize, getCellSize, getAutomaton}) {
        this._getRenderer = getRenderer;
        this._setRenderer = setRenderer;
        this._getCore = getCore;
        this._setCore = setCore;
        this._getGridSize = getGridSize;
        this._getCellSize = getCellSize;
        this._getAutomaton = getAutomaton;

        this.specialMode = null;
        this._specialEngineLoaded = false;

        this.wolframEngine = null;
        this.rd2dEngine = null;
        this.triangleEngine = null;

        this._originalRenderer = null;
        this._originalCore = null;
    }

    /**
     * Activa un motor especial, desactivando el anterior si lo hubiera.
     * @param {'wolfram'|'rd2d'|'triangle'} engineName
     */
    async activate(engineName) {
        if (this.specialMode === engineName && this._specialEngineLoaded) {
            return;
        }

        this.wolframEngine?.deactivate?.();
        this.rd2dEngine?.deactivate?.();
        this.triangleEngine?.deactivate?.();
        this._restoreOriginals();

        if (engineName === 'rd2d') {
            if (typeof RD2DEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/rd2d-engine.js');
            }
            this.rd2dEngine = new RD2DEngine(this._getAutomaton());
            this.specialMode = 'rd2d';

        } else if (engineName === 'wolfram') {
            if (typeof WolframEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/wolfram-engine.js');
            }
            this.wolframEngine = new WolframEngine(this._getAutomaton());
            this.specialMode = 'wolfram';

        } else if (engineName === 'triangle') {
            if (typeof TriangleGridManager === 'undefined') {
                await this._loadScript('scripts/core/engines/triangle-grid-manager.js');
            }
            if (typeof TriangleEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/triangle-engine.js');
            }
            if (typeof TriangleRenderer === 'undefined') {
                await this._loadScript('scripts/rendering/triangle-renderer.js');
            }
            if (typeof TriangleWebGL2Renderer === 'undefined') {
                await this._loadScript('scripts/rendering/triangle-webgl2-renderer.js');
            }

            this._originalRenderer = this._getRenderer();
            this._originalCore = this._getCore();

            this.triangleEngine = new TriangleEngine(this._getAutomaton());

            const canvas = document.getElementById('canvas');
            const container = document.getElementById('canvas-container');
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

            const useWebGL2 = this._detectWebGL2Support();
            const rendererOptions = {
                canvas,
                container,
                cellSize: Math.max(3, Math.min(6, this._getCellSize())),
                showGrid: this._originalRenderer?.getConfig('showGrid') ?? true,
                colorAlive: '#ec4899',
                colorDead: '#0f172a',
                colorGrid: 'rgba(255,255,255,0.1)'
            };

            const newRenderer = useWebGL2
                ? new TriangleWebGL2Renderer(rendererOptions)
                : new TriangleRenderer(rendererOptions);

            this._setRenderer(newRenderer);
            this.specialMode = 'triangle';
        }

        this._specialEngineLoaded = true;
    }

    /**
     * Restaura el renderer y core originales (salir de modo triangle).
     */
    restoreStandardMode() {
        this._restoreOriginals();
        this.specialMode = null;
    }

    /**
     * Desactiva todos los motores y libera recursos.
     */
    destroy() {
        this.wolframEngine?.deactivate?.();
        this.rd2dEngine?.deactivate?.();
        this.triangleEngine?.deactivate?.();
        this.wolframEngine = null;
        this.rd2dEngine = null;
        this.triangleEngine = null;
        this._originalRenderer = null;
        this._originalCore = null;
        this._getRenderer = null;
        this._setRenderer = null;
        this._getCore = null;
        this._setCore = null;
    }

    // ─── Privados ───────────────────────────────────────────────

    _restoreOriginals() {
        if (this._originalRenderer) {
            this._setRenderer(this._originalRenderer);
            this._originalRenderer = null;
        }
        if (this._originalCore) {
            this._setCore(this._originalCore);
            this._originalCore = null;
        }
    }

    _detectWebGL2Support() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            if (!gl) return false;
            return typeof gl.createVertexArray === 'function' &&
                typeof gl.drawArraysInstanced === 'function';
        } catch (e) {
            return false;
        }
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

window.SpecialEngineManager = SpecialEngineManager;