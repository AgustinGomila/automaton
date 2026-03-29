/**
 * SpecialEngineManager - Gestiona los motores especiales de simulación.
 *
 * Cambios para grids rectangulares:
 *   • Todos los contextos exponen gridWidth y gridHeight además de gridSize
 *     (que se mantiene como Math.max(w,h) para compatibilidad).
 *   • stepActive() usa height para recalcular índices planos en Triangle.
 */
class SpecialEngineManager {

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

    constructor({
                    getRenderer, setRenderer, getCore, setCore,
                    getGridWidth, getGridHeight, getCellSize, getAutomaton
                }) {
        this._getRenderer = getRenderer;
        this._setRenderer = setRenderer;
        this._getCore = getCore;
        this._setCore = setCore;
        this._getGridWidth = getGridWidth || (() => AppConfig.GRID.DEFAULT_WIDTH);
        this._getGridHeight = getGridHeight || (() => AppConfig.GRID.DEFAULT_HEIGHT);
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
    // DISPATCH DE PASO
    // =========================================

    stepActive() {
        switch (this.specialMode) {
            case SpecialEngineManager.MODES.RD2D:
                return this._describeStep(this.rd2dEngine, {
                    label: 'RD-2D', stopMessage: 'RD-2D: Simulación detenida (estable)'
                });
            case SpecialEngineManager.MODES.WOLFRAM:
                return this._describeStep(this.wolframEngine, {
                    label: 'Wolfram', stopMessage: 'Wolfram: Límite alcanzado'
                });
            case SpecialEngineManager.MODES.ULAM_WARBURTON:
                return this._describeStep(this.uwEngine, {
                    label: 'Ulam-Warburton', stopMessage: 'Ulam-Warburton: patrón estable'
                });
            case SpecialEngineManager.MODES.LANGTON:
                return this._describeStep(this.langtonEngine, {label: 'Langton'});
            case SpecialEngineManager.MODES.WIREWORLD:
                return this._describeStep(this.wireworldEngine, {label: 'WireWorld'});
            case SpecialEngineManager.MODES.GENERATIONS:
                return this._describeStep(this.generationsEngine, {
                    label: 'Generations', skipActivity: true
                });
            case SpecialEngineManager.MODES.TRIANGLE:
                return this._describeTriangleStep();
            default:
                return null;
        }
    }

    _describeStep(engine, {label, stopMessage = null, skipActivity = false}) {
        const continued = engine.step();
        return {
            continued, label, stopMessage,
            generation: engine.generation,
            changedCells: engine.getChangedCells(),
            population: null,
            markDirtyFromCells: false,
            skipActivity
        };
    }

    _describeTriangleStep() {
        if (!this.triangleEngine?.gridManager) return null;
        this.triangleEngine.step();
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
    // INFO DEL MOTOR ACTIVO
    // =========================================

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
        if (this.specialMode === engineName && this._specialEngineLoaded) return;

        this.wolframEngine?.deactivate?.();
        this.rd2dEngine?.deactivate?.();
        this.triangleEngine?.deactivate?.();
        this.uwEngine?.deactivate?.();
        this.langtonEngine?.deactivate?.();
        this.wireworldEngine?.deactivate?.();
        this.generationsEngine?.deactivate?.();
        this._restoreOriginals();

        if (engineName === SpecialEngineManager.MODES.RD2D) {
            if (typeof RD2DEngine === 'undefined') await this._loadScript('scripts/core/engines/rd2d-engine.js');
            this.rd2dEngine = new RD2DEngine(this._buildRD2DContext());
            this.specialMode = SpecialEngineManager.MODES.RD2D;

        } else if (engineName === SpecialEngineManager.MODES.WOLFRAM) {
            if (typeof WolframEngine === 'undefined') await this._loadScript('scripts/core/engines/wolfram-engine.js');
            this.wolframEngine = new WolframEngine(this._buildWolframContext());
            this.specialMode = SpecialEngineManager.MODES.WOLFRAM;

        } else if (engineName === SpecialEngineManager.MODES.ULAM_WARBURTON) {
            if (typeof UlamWarburtonEngine === 'undefined') await this._loadScript('scripts/core/engines/ulam-warburton-engine.js');
            this.uwEngine = new UlamWarburtonEngine(this._buildUWContext());
            this.specialMode = SpecialEngineManager.MODES.ULAM_WARBURTON;

        } else if (engineName === SpecialEngineManager.MODES.LANGTON) {
            if (typeof LangtonEngine === 'undefined') await this._loadScript('scripts/core/engines/langton-engine.js');
            this.langtonEngine = new LangtonEngine(this._buildLangtonContext());
            this.specialMode = SpecialEngineManager.MODES.LANGTON;

        } else if (engineName === SpecialEngineManager.MODES.WIREWORLD) {
            if (typeof WireWorldEngine === 'undefined') await this._loadScript('scripts/core/engines/wireworld-engine.js');
            this.wireworldEngine = new WireWorldEngine(this._buildWireworldContext());
            this.specialMode = SpecialEngineManager.MODES.WIREWORLD;

        } else if (engineName === SpecialEngineManager.MODES.GENERATIONS) {
            if (typeof GenerationsEngine === 'undefined') await this._loadScript('scripts/core/engines/generations-engine.js');
            this.generationsEngine = new GenerationsEngine(this._buildGenerationsContext());
            this.specialMode = SpecialEngineManager.MODES.GENERATIONS;

        } else if (engineName === SpecialEngineManager.MODES.TRIANGLE) {
            if (typeof TriangleGridManager === 'undefined') await this._loadScript('scripts/core/triangle-grid-manager.js');
            if (typeof TriangleWorkerManager === 'undefined') await this._loadScript('scripts/infrastructure/workers/triangle-worker-manager.js');
            if (typeof TriangleEngine === 'undefined') await this._loadScript('scripts/core/engines/triangle-engine.js');
            if (typeof TriangleRenderer === 'undefined') await this._loadScript('scripts/rendering/triangle-renderer.js');
            if (typeof TriangleWebGL2Renderer === 'undefined') await this._loadScript('scripts/rendering/triangle-webgl2-renderer.js');

            // Destruir el overlay DOM del GridRenderer ANTES del swap de renderer.
            // El GridRenderer puede tener un canvas overlay de grilla rectangular
            // insertado en el DOM; si no se retira aquí, permanece visible debajo
            // del overlay triangular y produce una superposición de ambas grillas.
            // El GridRenderer recreará su overlay automáticamente al ser restaurado
            // y se llame a _buildGridCache() con showGrid activo.
            const currentRenderer = this._getRenderer();
            currentRenderer?._destroyGridOverlay?.();

            this._originalRenderer = currentRenderer;
            this._originalCore = this._getCore();

            this.triangleEngine = new TriangleEngine(this._buildTriangleContext());

            const canvas = document.getElementById('canvas');
            const container = document.getElementById('canvas-container');
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

            const useWebGL2 = this._detectWebGL2Support();

            // Calcular el cellSize que preserva las proporciones del canvas original.
            //
            // Geometría del canvas triangular (igual en TriangleRenderer y WebGL2):
            //   canvasWidth  = ceil((gridWidth  + 0.5) × cs)
            //   canvasHeight = ceil( gridHeight × √3/2  × cs)
            //
            // Con triWidth = gridWidth×2 y triHeight = gridHeight, despejamos cs:
            //   csFromWidth  = origW / (gridWidth  + 0.5)   ≈ origCellSize
            //   csFromHeight = origH / (gridHeight × √3/2)  ≈ origCellSize × 1.155
            //
            // Math.round en lugar de Math.floor: floor(2.99)=2 pierde un entero completo
            // y genera un canvas mucho más pequeño que el original. round(2.99)=3 mantiene
            // cs=origCellSize en todos los casos habituales, con un desborde de 1-4 px en
            // ancho (inferior al padding del contenedor y completamente imperceptible).
            //
            // El cssHeight lo calcula el renderer internamente como bitmapH × 2/√3,
            // lo que produce triángulos equiláteros correctos sin importar el historial
            // de cambios de cellSize. No se necesita targetHeight externo.
            const origW = canvas.width;
            const origH = canvas.height;
            const gw = this._getGridWidth();
            const gh = this._getGridHeight();
            const csFromWidth = origW / (gw + 0.5);
            const csFromHeight = origH / (gh * (Math.sqrt(3) / 2));

            // Respetar el cellSize actual del usuario: solo ajustar si geométricamente
            // no cabe (el canvas triangular sería mayor que el espacio disponible).
            // Math.max(1,…) en lugar de Math.max(2,…): cellSize=1 es válido con ImageData.
            const currentCs = this._getCellSize();
            const maxFit = Math.floor(Math.min(csFromWidth, csFromHeight));
            const fittedCellSize = Math.max(AppConfig.GRID.MIN_CELL_SIZE, Math.min(AppConfig.GRID.MAX_CELL_SIZE, currentCs <= maxFit ? currentCs : maxFit));

            const rendererOptions = {
                canvas, container,
                cellSize: fittedCellSize,
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

            // Sincronizar automaton.cellSize con el cellSize real del renderer.
            // fittedCellSize puede diferir de automaton.cellSize (calculado para que el
            // canvas triangular ocupe el mismo espacio que el rectangular original).
            // Sin esta sincronización, autoSizeGrid y setCellSize operan con valores
            // distintos, produciendo grids sobredimensionados o distorsión de triángulos.
            const automaton = this._getAutomaton();
            automaton.cellSize = fittedCellSize;
            // Actualizar el slider y su display para reflejar el zoom real.
            const cellSizeSlider = document.getElementById('cellSize');
            if (cellSizeSlider) {
                cellSizeSlider.value = fittedCellSize;
                // Actualizar el display asociado si existe
                const cellSizeDisplay = document.getElementById('cellSizeValue');
                if (cellSizeDisplay) cellSizeDisplay.textContent = `${fittedCellSize}px`;
            }
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
    // OPERACIONES BATCH
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
    // CONTEXTOS — incluyen gridWidth y gridHeight
    // =========================================

    /** Construye un contexto base con propiedades compartidas por todos los engines. */
    _buildBaseContext(automaton) {
        const self = this;
        return {
            get grid() {
                return automaton.grid;
            },
            get gridWidth() {
                return self._getGridWidth();
            },
            get gridHeight() {
                return self._getGridHeight();
            },
            get renderer() {
                return self._getRenderer();
            },
            get wrapEdges() {
                return automaton.wrapEdges;
            }
        };
    }

    _buildWolframContext() {
        const self = this;
        const automaton = self._getAutomaton();
        const base = this._buildBaseContext(automaton);
        return Object.assign(Object.create(base), {
            get generation() {
                return automaton.generation;
            },
            set generation(v) {
                automaton.generation = v;
            },
            _markAllDirty() {
                automaton._markAllDirty();
            },
            setCell(x, y, s, m) {
                return automaton.setCell(x, y, s, m);
            }
        });
    }

    _buildRD2DContext() {
        const automaton = this._getAutomaton();
        return this._buildBaseContext(automaton);
    }

    _buildTriangleContext() {
        const self = this;
        const automaton = self._getAutomaton();
        const base = this._buildBaseContext(automaton);
        return Object.assign(Object.create(base), {
            get cellSize() {
                return self._getCellSize();
            },
            render() {
                return automaton.render();
            }
        });
    }

    _buildUWContext() {
        const automaton = this._getAutomaton();
        const base = this._buildBaseContext(automaton);
        return Object.assign(Object.create(base), {
            _markAllDirty() {
                automaton._markAllDirty();
            }
        });
    }

    _buildLangtonContext() {
        const automaton = this._getAutomaton();
        return this._buildBaseContext(automaton);
    }

    _buildWireworldContext() {
        const automaton = this._getAutomaton();
        return this._buildBaseContext(automaton);
    }

    _buildGenerationsContext() {
        const automaton = this._getAutomaton();
        return this._buildBaseContext(automaton);
    }

    // =========================================
    // UTILIDADES PRIVADAS
    // =========================================

    /**
     * Desactiva el engine triangular y restaura el renderer/core originales.
     *
     * Centraliza la lógica que antes vivía en SpecialModeController._deactivateTriangleEngine(),
     * eliminando el acceso directo desde el controlador UI a las propiedades internas
     * del autómata (triangleEngine, _originalRenderer, _originalCore).
     *
     * Pasos:
     *  1. Limpiar y desactivar el triangleEngine
     *  2. Restaurar el renderer original y destruir el triangular
     *  3. Restaurar el core original
     *  4. Redimensionar el renderer estándar a las dimensiones actuales del grid
     */
    deactivateTriangle() {
        if (this.triangleEngine) {
            this.triangleEngine.clear?.();
            this.triangleEngine.deactivate();
            this.triangleEngine = null;
        }

        if (this._originalRenderer) {
            const oldRenderer = this._getRenderer();
            this._setRenderer(this._originalRenderer);
            this._originalRenderer = null;
            oldRenderer?.destroy?.();

            // Redimensionar el renderer estándar con las dimensiones actuales del grid.
            // Sin argumentos _resizeRenderer usa automaton.gridWidth/gridHeight/cellSize.
            this._getAutomaton()._resizeRenderer();
        }

        if (this._originalCore) {
            this._setCore(this._originalCore);
            this._originalCore = null;
        }
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
            script.onload = () => resolve();
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

window.SpecialEngineManager = SpecialEngineManager;