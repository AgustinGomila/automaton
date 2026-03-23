/**
 * SpecialEngineManager - Gestiona los motores especiales de simulación.
 *
 * Responsabilidad: ciclo de vida (activación, desactivación, swap de renderer)
 * de WolframEngine, RD2DEngine, TriangleEngine, UlamWarburtonEngine, LangtonEngine
 * y WireWorldEngine.
 *
 * Cada engine recibe un EngineContext mínimo en lugar del automaton completo,
 * aplicando DI fina: el engine solo puede acceder a las dependencias que necesita.
 *
 * stepActive() centraliza el dispatch de paso de simulación: devuelve un descriptor
 * normalizado que CellularAutomaton.nextGeneration() consume sin necesidad de
 * ramificación por modo.
 */
class SpecialEngineManager {

    // =========================================
    // CONSTANTES DE MODO
    // =========================================

    static MODES = Object.freeze({
        STANDARD: 'standard',
        WOLFRAM: 'wolfram',
        RD2D: 'rd2d',
        TRIANGLE: 'triangle',
        ULAM_WARBURTON: 'ulam-warburton',
        LANGTON: 'langton',
        WIREWORLD: 'wireworld',
        GENERATIONS: 'generations'
    });

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
        this.generationsEngine = null;

        this._originalRenderer = null;
        this._originalCore = null;
    }

    // =========================================
    // DISPATCH DE PASO — API PÚBLICA
    // =========================================

    /**
     * Ejecuta un paso del motor especial activo y devuelve un descriptor normalizado.
     *
     * @typedef  {Object}        EngineStepDescriptor
     * @property {boolean}       continued          — false = motor terminó, detener simulación
     * @property {string}        label              — etiqueta para _debugTiming
     * @property {string|null}   stopMessage        — mensaje de log cuando continued=false
     * @property {number}        generation         — generación tras el paso
     * @property {Array}         changedCells       — índices o packed coords (según markDirtyFromCells)
     * @property {number|null}   population         — null = calcular desde grid
     * @property {boolean}       markDirtyFromCells — si true, changedCells contiene packed (q<<16|r)
     *
     * @returns {EngineStepDescriptor|null} null si no hay motor especial activo
     */
    stepActive() {
        switch (this.specialMode) {
            case SpecialEngineManager.MODES.RD2D:
                return this._describeStep(this.rd2dEngine, {
                    label: 'RD-2D',
                    stopMessage: 'RD-2D: Simulación detenida (estable)'
                });
            case SpecialEngineManager.MODES.WOLFRAM:
                return this._describeStep(this.wolframEngine, {
                    label: 'Wolfram',
                    stopMessage: 'Wolfram: Límite alcanzado'
                });
            case SpecialEngineManager.MODES.ULAM_WARBURTON:
                return this._describeStep(this.uwEngine, {
                    label: 'Ulam-Warburton',
                    stopMessage: 'Ulam-Warburton: patrón estable'
                });
            case SpecialEngineManager.MODES.LANGTON:
                return this._describeStep(this.langtonEngine, {label: 'Langton'});
            case SpecialEngineManager.MODES.WIREWORLD:
                return this._describeStep(this.wireworldEngine, {label: 'WireWorld'});
            case SpecialEngineManager.MODES.GENERATIONS:
                return this._describeStep(this.generationsEngine, {
                    label: 'Generations',
                    skipActivity: true
                });
            case SpecialEngineManager.MODES.TRIANGLE:
                return this._describeTriangleStep();
            default:
                return null;
        }
    }

    /**
     * Descriptor genérico para motores con interfaz estándar: step() + getChangedCells().
     * @param {Object} engine
     * @param {string} label
     * @param {string|null} [stopMessage]
     * @returns {EngineStepDescriptor}
     */
    _describeStep(engine, {label, stopMessage = null, skipActivity = false}) {
        const continued = engine.step();
        return {
            continued,
            label,
            stopMessage,
            generation: engine.generation,
            changedCells: engine.getChangedCells(),
            population: null,
            markDirtyFromCells: false,
            skipActivity
        };
    }

    /**
     * Descriptor para TriangleEngine: paso asíncrono / worker-based.
     *
     * step() se llama sin await: cuando usa worker, el resultado llega vía
     * _onWorkerResult (que llama a render internamente y emite stats:updated
     * con el conteo correcto del grid triangular). Para el path síncrono,
     * changedCells contiene las celdas del paso actual; para el worker, son las
     * del paso anterior (stale), pero _onWorkerResult sobreescribe con las correctas.
     *
     * population: null evita countPopulation() sobre el grid 2× (potencialmente
     * 2 M de celdas). CellularAutomaton.updateStats() usa el grid base mapeado,
     * y _onWorkerResult emite los stats finales con el valor preciso.
     *
     * skipActivity: true — TriangleRenderer maneja su propio visual; el efecto
     * de actividad amarillo del GridRenderer no aplica a este modo.
     * @returns {EngineStepDescriptor}
     */
    _describeTriangleStep() {
        if (!this.triangleEngine?.gridManager) return null;
        this.triangleEngine.step(); // fire-and-forget; resultado via _onWorkerResult
        return {
            continued: true,
            label: 'Triangle',
            stopMessage: null,
            generation: this.triangleEngine.generation,
            changedCells: this.triangleEngine.getChangedCells(),
            population: null,
            markDirtyFromCells: true,
            skipActivity: true
        };
    }

    // =========================================
    // INFO DEL MOTOR ACTIVO — para DisplayController
    // =========================================

    /**
     * Retorna el modo activo y la info del engine correspondiente.
     * Centraliza el dispatch que antes se repetía en DisplayController.
     *
     * @returns {{ mode: string, info: Object|null }}
     *   mode — SpecialEngineManager.MODES.*
     *   info — engine.getInfo() si el modo lo expone; null si no aplica
     */
    getActiveInfo() {
        const mode = this.specialMode || SpecialEngineManager.MODES.STANDARD;
        switch (mode) {
            case SpecialEngineManager.MODES.WOLFRAM:
                return {mode, info: this.wolframEngine?.getInfo() ?? null};
            case SpecialEngineManager.MODES.TRIANGLE:
                return {mode, info: this.triangleEngine?.getInfo() ?? null};
            case SpecialEngineManager.MODES.LANGTON:
                return {mode, info: this.langtonEngine?.getInfo() ?? null};
            case SpecialEngineManager.MODES.GENERATIONS:
                return {mode, info: this.generationsEngine?.getInfo() ?? null};
            default:
                return {mode, info: null};
        }
    }

    // =========================================
    // ACTIVACIÓN / DESACTIVACIÓN
    // =========================================

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
        this.generationsEngine?.deactivate?.();
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

        } else if (engineName === SpecialEngineManager.MODES.GENERATIONS) {
            if (typeof GenerationsEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/generations-engine.js');
            }
            // Las opciones (birth/survival/numStates) se pasan vía activate()
            // desde SpecialModeController después de construir el engine.
            this.generationsEngine = new GenerationsEngine(this._buildGenerationsContext());
            this.specialMode = SpecialEngineManager.MODES.GENERATIONS;

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

    destroy() {
        this.wolframEngine?.deactivate?.();
        this.rd2dEngine?.deactivate?.();
        this.triangleEngine?.deactivate?.();
        this.uwEngine?.deactivate?.();
        this.langtonEngine?.deactivate?.();
        this.wireworldEngine?.deactivate?.();
        this.generationsEngine?.deactivate?.();

        this.wolframEngine = null;
        this.rd2dEngine = null;
        this.triangleEngine = null;
        this.uwEngine = null;
        this.langtonEngine = null;
        this.wireworldEngine = null;
        this.generationsEngine = null;

        this._originalRenderer = null;
        this._originalCore = null;
        this._getRenderer = null;
        this._setRenderer = null;
        this._getCore = null;
        this._setCore = null;
    }

    // =========================================
    // OPERACIONES BATCH — usadas por EditCoordinator / CellularAutomaton
    // =========================================

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

            case SpecialEngineManager.MODES.GENERATIONS:
                this.generationsEngine?.reset();
                return true;

            default:
                return false;
        }
    }

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

        if (this.specialMode === SpecialEngineManager.MODES.GENERATIONS && this.generationsEngine?.isActive) {
            this.generationsEngine.randomize(density);
            return {handled: true, population: null, resetLimit: false};
        }

        return {handled: false};
    }

    resetAllEngines() {
        this.wolframEngine?.reset?.();
        this.rd2dEngine?.reset?.();
        this.uwEngine?.reset?.();
        this.langtonEngine?.reset?.();
        this.wireworldEngine?.reset?.();
        this.generationsEngine?.reset?.();
    }

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

    // =========================================
    // CONTEXTOS POR ENGINE
    // =========================================

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

    _buildGenerationsContext() {
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

    // =========================================
    // UTILIDADES PRIVADAS
    // =========================================

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
            return typeof gl.createVertexArray === 'function'
                && typeof gl.drawArraysInstanced === 'function';
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