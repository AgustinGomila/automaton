/**
 * SpecialEngineManager - Gestiona los motores especiales de simulación.
 *
 * Responsabilidad: ciclo de vida (activación, desactivación, swap de renderer)
 * de WolframEngine, RD2DEngine, TriangleEngine y UlamWarburtonEngine.
 *
 * Cada engine recibe un EngineContext mínimo en lugar del automaton completo,
 * aplicando DI fina: el engine solo puede acceder a las dependencias que necesita.
 *
 * Superficies de cada engine:
 *   WolframEngine   → grid, gridSize, generation (set), renderer.markDirty, _markAllDirty, setCell
 *   RD2DEngine      → grid, gridSize, renderer.markDirty
 *   TriangleEngine  → grid, gridSize, cellSize, render(), renderer.*
 *   UWEngine        → grid, gridSize, renderer.markDirty, _markAllDirty
 */
class SpecialEngineManager {

    // =========================================
    // CONSTANTES DE MODO
    // =========================================

    /** Identificadores canónicos de cada motor especial. */
    static MODES = Object.freeze({
        STANDARD: 'standard',
        WOLFRAM: 'wolfram',
        RD2D: 'rd2d',
        TRIANGLE: 'triangle',
        ULAM_WARBURTON: 'ulam-warburton',
        LANGTON: 'langton',
        WIREWORLD: 'wireworld'
    });

    /**
     * @param {Object} options
     * @param {Function} options.getRenderer  - () => renderer actual del automaton
     * @param {Function} options.setRenderer  - (r) => asigna nuevo renderer al automaton
     * @param {Function} options.getCore      - () => core actual del automaton
     * @param {Function} options.setCore      - (c) => asigna core al automaton (restauración)
     * @param {Function} options.getGridSize  - () => gridSize actual
     * @param {Function} options.getCellSize  - () => cellSize actual
     * @param {Function} options.getAutomaton - () => instancia completa (solo para TriangleEngine que llama render())
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
        this.uwEngine = null;
        this.langtonEngine = null;
        this.wireworldEngine = null;

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
        this.uwEngine?.deactivate?.();
        this.langtonEngine?.deactivate?.();
        this.wireworldEngine?.deactivate?.();
        this._restoreOriginals();

        if (engineName === SpecialEngineManager.MODES.RD2D) {
            if (typeof RD2DEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/rd2d-engine.js');
            }
            this.rd2dEngine = new RD2DEngine(this._buildRD2DContext());
            this.specialMode = SpecialEngineManager.MODES.RD2D;

        } else if (engineName === SpecialEngineManager.MODES.WOLFRAM) {
            if (typeof WolframEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/wolfram-engine.js');
            }
            this.wolframEngine = new WolframEngine(this._buildWolframContext());
            this.specialMode = SpecialEngineManager.MODES.WOLFRAM;

        } else if (engineName === SpecialEngineManager.MODES.ULAM_WARBURTON) {
            if (typeof UlamWarburtonEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/ulam-warburton-engine.js');
            }
            this.uwEngine = new UlamWarburtonEngine(this._buildUWContext());
            this.specialMode = SpecialEngineManager.MODES.ULAM_WARBURTON;

        } else if (engineName === SpecialEngineManager.MODES.LANGTON) {
            if (typeof LangtonEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/langton-engine.js');
            }
            this.langtonEngine = new LangtonEngine(this._buildLangtonContext());
            this.specialMode = SpecialEngineManager.MODES.LANGTON;

        } else if (engineName === SpecialEngineManager.MODES.WIREWORLD) {
            if (typeof WireWorldEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/wireworld-engine.js');
            }
            this.wireworldEngine = new WireWorldEngine(this._buildWireworldContext());
            this.specialMode = SpecialEngineManager.MODES.WIREWORLD;

        } else if (engineName === SpecialEngineManager.MODES.TRIANGLE) {
            if (typeof TriangleGridManager === 'undefined') {
                await this._loadScript('scripts/core/triangle-grid-manager.js');
            }
            if (typeof TriangleWorkerManager === 'undefined') {
                await this._loadScript('scripts/infrastructure/workers/triangle-worker-manager.js');
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

            this.triangleEngine = new TriangleEngine(this._buildTriangleContext());

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
            this.specialMode = SpecialEngineManager.MODES.TRIANGLE;
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
        this.uwEngine?.deactivate?.();
        this.langtonEngine?.deactivate?.();
        this.wireworldEngine?.deactivate?.();

        this.wolframEngine = null;
        this.rd2dEngine = null;
        this.triangleEngine = null;
        this.uwEngine = null;
        this.langtonEngine = null;
        this.wireworldEngine = null;

        this._originalRenderer = null;
        this._originalCore = null;
        this._getRenderer = null;
        this._setRenderer = null;
        this._getCore = null;
        this._setCore = null;
    }

    // ─── Privados ───────────────────────────────────────────────

    /**
     * Contexto mínimo para WolframEngine.
     * Expone: grid, gridSize (live), generation (set), renderer.markDirty,
     *         _markAllDirty, setCell.
     */
    _buildWolframContext() {
        const self = this;
        const automaton = self._getAutomaton();
        return {
            get grid() {
                return automaton.grid;
            },
            get gridSize() {
                return self._getGridSize();
            },
            get generation() {
                return automaton.generation;
            },
            set generation(v) {
                automaton.generation = v;
            },
            get renderer() {
                return self._getRenderer();
            },
            _markAllDirty() {
                automaton._markAllDirty();
            },
            setCell(x, y, state, markDirty) {
                return automaton.setCell(x, y, state, markDirty);
            }
        };
    }

    /**
     * Contexto mínimo para RD2DEngine.
     * Expone: grid, gridSize (live), renderer.markDirty.
     */
    _buildRD2DContext() {
        const self = this;
        const automaton = self._getAutomaton();
        return {
            get grid() {
                return automaton.grid;
            },
            get gridSize() {
                return self._getGridSize();
            },
            get renderer() {
                return self._getRenderer();
            }
        };
    }

    /**
     * Contexto mínimo para TriangleEngine.
     * TriangleEngine llama automaton.render() directamente, por lo que necesita
     * la referencia completa; sin embargo la envolvemos para poder interceptar
     * o sustituir en el futuro sin tocar el engine.
     * Expone: grid, gridSize, cellSize, render(), renderer.*.
     */
    _buildTriangleContext() {
        const self = this;
        const automaton = self._getAutomaton();
        return {
            get grid() {
                return automaton.grid;
            },
            get gridSize() {
                return self._getGridSize();
            },
            get cellSize() {
                return self._getCellSize();
            },
            render() {
                return automaton.render();
            },
            get renderer() {
                return self._getRenderer();
            }
        };
    }

    /**
     * Contexto mínimo para UlamWarburtonEngine.
     * Expone: grid, gridSize (live), renderer.markDirty, _markAllDirty.
     */
    _buildUWContext() {
        const self = this;
        const automaton = self._getAutomaton();
        return {
            get grid() {
                return automaton.grid;
            },
            get gridSize() {
                return self._getGridSize();
            },
            get renderer() {
                return self._getRenderer();
            },
            _markAllDirty() {
                automaton._markAllDirty();
            }
        };
    }

    /**
     * Limpia el motor especial activo.
     * Retorna true si un motor especial fue limpiado, false si el modo es
     * estándar (sin motor especial). En ese caso, el coordinador es
     * responsable de limpiar el stateManager.
     * @returns {boolean}
     */
    clearActiveEngine() {
        switch (this.specialMode) {
            case SpecialEngineManager.MODES.WOLFRAM:
                this.wolframEngine?.reset();
                this.wolframEngine?._initializeSeed?.();
                return true;

            case SpecialEngineManager.MODES.RD2D:
                this.rd2dEngine?.reset();
                return true;

            case SpecialEngineManager.MODES.TRIANGLE:
                if (this.triangleEngine?.gridManager) {
                    for (let q = 0; q < this.triangleEngine.gridManager.width; q++) {
                        this.triangleEngine.gridManager.grid[q].fill(0);
                    }
                }
                this.triangleEngine?.reset?.();
                return true;

            case SpecialEngineManager.MODES.LANGTON:
                this.langtonEngine?.reset();
                return true;

            case SpecialEngineManager.MODES.WIREWORLD:
                this.wireworldEngine?.reset();
                return true;

            default:
                return false;
        }
    }

    /**
     * Aleatoriza el grid del motor especial activo.
     * Retorna { handled: true, population, resetLimit } si un motor especial
     * lo gestionó, o { handled: false } si el modo estándar debe encargarse.
     * - population: número de celdas vivas tras randomizar, o null para recalcular
     * - resetLimit: true si el motor requiere limpiar isLimitReached
     * @param {number} density
     * @returns {{ handled: boolean, population?: number|null, resetLimit?: boolean }}
     */
    randomizeActiveEngine(density) {
        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.gridManager) {
            const {width, height} = this.triangleEngine.gridManager;
            for (let q = 0; q < width; q++) {
                for (let r = 0; r < height; r++) {
                    this.triangleEngine.gridManager.setCell(q, r, Math.random() < density ? 1 : 0);
                }
            }
            return {
                handled: true,
                population: this.triangleEngine.gridManager.countPopulation(),
                resetLimit: false
            };
        }

        if (this.specialMode === SpecialEngineManager.MODES.ULAM_WARBURTON && this.uwEngine?.isActive) {
            this.uwEngine.randomize(density);
            return {handled: true, population: null, resetLimit: true};
        }

        if (this.specialMode === SpecialEngineManager.MODES.LANGTON && this.langtonEngine?.isActive) {
            const population = this.langtonEngine.randomize(density);
            return {handled: true, population, resetLimit: false};
        }

        if (this.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.wireworldEngine?.isActive) {
            this.wireworldEngine.randomize(density);
            return {handled: true, population: null, resetLimit: false};
        }

        return {handled: false};
    }

    /**
     * Resetea todos los motores especiales.
     * Se usa cuando el grid base es randomizado/limpiado en modo estándar,
     * para sincronizar cualquier motor que estuviera activo.
     */
    resetAllEngines() {
        this.wolframEngine?.reset?.();
        this.rd2dEngine?.reset?.();
        this.uwEngine?.reset?.();
        this.langtonEngine?.reset?.();
        this.wireworldEngine?.reset?.();
    }

    /**
     * Resetea el motor especial activo al estado inicial de su grid.
     * Se usa al deshacer/rehacer, cuando el grid base fue restaurado
     * y el motor especial debe sincronizarse con él.
     * Solo aplica a Wolfram y RD-2D; Triangle y Ulam-Warburton
     * no tienen estado derivado que deba resetearse en undo/redo.
     */
    resetActiveEngine() {
        switch (this.specialMode) {
            case SpecialEngineManager.MODES.WOLFRAM:
                this.wolframEngine?.reset?.();
                break;
            case SpecialEngineManager.MODES.RD2D:
                this.rd2dEngine?.reset?.();
                break;
        }
    }

    /**
     * Contexto mínimo para LangtonEngine.
     * Expone: grid, gridSize, renderer, wrapEdges.
     */
    _buildLangtonContext() {
        const self = this;
        const automaton = self._getAutomaton();
        return {
            get grid() {
                return automaton.grid;
            },
            get gridSize() {
                return self._getGridSize();
            },
            get renderer() {
                return self._getRenderer();
            },
            get wrapEdges() {
                return automaton.wrapEdges;
            }
        };
    }

    /**
     * Contexto mínimo para WireWorldEngine.
     * Expone: grid, gridSize, renderer, wrapEdges.
     */
    _buildWireworldContext() {
        const self = this;
        const automaton = self._getAutomaton();
        return {
            get grid() {
                return automaton.grid;
            },
            get gridSize() {
                return self._getGridSize();
            },
            get renderer() {
                return self._getRenderer();
            },
            get wrapEdges() {
                return automaton.wrapEdges;
            }
        };
    }

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