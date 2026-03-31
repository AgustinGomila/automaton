/**
 * scripts/core/engines/special-engine-manager.js
 *
 * Gestiona los motores especiales de simulación.
 *
 * Los motores de carga diferida (rd2d, wolfram, triangle, hex, etc.) se cargan
 * con `import()` dinámico la primera vez que se activan. El navegador cachea el
 * módulo, por lo que activaciones subsiguientes del mismo modo no producen
 * ninguna petición de red adicional.
 *
 * Cambios respecto a la versión global:
 *   - `_loadScript()` eliminado; reemplazado por `import()` en cada rama.
 *   - `typeof X === 'undefined'` eliminado; la asignación destructurada del
 *     módulo actúa como guard implícita.
 *   - Sin `window.SpecialEngineManager`.
 */

import {AppConfig} from '../../utils/config.js';

class SpecialEngineManager {

    static MODES = Object.freeze({
        STANDARD: 'standard',
        WOLFRAM: 'wolfram',
        RD2D: 'rd2d',
        TRIANGLE: 'triangle',
        HEXAGONAL: 'hexagonal',
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
        this.hexEngine = null;
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
            case SpecialEngineManager.MODES.HEXAGONAL:
                return this._describeHexStep();
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
        const engine = this.triangleEngine;
        engine.step();
        return {
            continued: true,
            label: 'Triangle',
            stopMessage: null,
            generation: engine.generation,
            changedCells: engine.getChangedCells(),
            population: null,
            markDirtyFromCells: true,
            skipActivity: true
        };
    }

    _describeHexStep() {
        if (!this.hexEngine?.gridManager) return null;
        const engine = this.hexEngine;
        engine._stepSync();
        engine.automaton.renderer.updateActivityAges?.(engine._changedCells);
        const population = engine.gridManager.countPopulation();
        return {
            continued: true,
            label: 'Hexagonal',
            stopMessage: null,
            generation: engine.generation,
            changedCells: [],
            population,
            markDirtyFromCells: false,
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
            case SpecialEngineManager.MODES.HEXAGONAL:
                return {mode, info: this.hexEngine?.getInfo() ?? null};
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

        // Desactivar el motor anterior
        this.wolframEngine?.deactivate?.();
        this.rd2dEngine?.deactivate?.();
        this.triangleEngine?.deactivate?.();
        this.hexEngine?.deactivate?.();
        this.uwEngine?.deactivate?.();
        this.langtonEngine?.deactivate?.();
        this.wireworldEngine?.deactivate?.();
        this.generationsEngine?.deactivate?.();
        this._restoreOriginals();

        if (engineName === SpecialEngineManager.MODES.RD2D) {
            const {RD2DEngine} = await import('./rd2d-engine.js');
            this.rd2dEngine = new RD2DEngine(this._buildRD2DContext());
            this.specialMode = SpecialEngineManager.MODES.RD2D;

        } else if (engineName === SpecialEngineManager.MODES.WOLFRAM) {
            const {WolframEngine} = await import('./wolfram-engine.js');
            this.wolframEngine = new WolframEngine(this._buildWolframContext());
            this.specialMode = SpecialEngineManager.MODES.WOLFRAM;

        } else if (engineName === SpecialEngineManager.MODES.ULAM_WARBURTON) {
            const {UlamWarburtonEngine} = await import('./ulam-warburton-engine.js');
            this.uwEngine = new UlamWarburtonEngine(this._buildUWContext());
            this.specialMode = SpecialEngineManager.MODES.ULAM_WARBURTON;

        } else if (engineName === SpecialEngineManager.MODES.LANGTON) {
            const {LangtonEngine} = await import('./langton-engine.js');
            this.langtonEngine = new LangtonEngine(this._buildLangtonContext());
            this.specialMode = SpecialEngineManager.MODES.LANGTON;

        } else if (engineName === SpecialEngineManager.MODES.WIREWORLD) {
            const {WireWorldEngine} = await import('./wireworld-engine.js');
            this.wireworldEngine = new WireWorldEngine(this._buildWireworldContext());
            this.specialMode = SpecialEngineManager.MODES.WIREWORLD;

        } else if (engineName === SpecialEngineManager.MODES.GENERATIONS) {
            const {GenerationsEngine} = await import('./generations-engine.js');
            this.generationsEngine = new GenerationsEngine(this._buildGenerationsContext());
            this.specialMode = SpecialEngineManager.MODES.GENERATIONS;

        } else if (engineName === SpecialEngineManager.MODES.TRIANGLE) {
            const [
                {TriangleGridManager},
                {TriangleWorkerManager},
                {TriangleEngine},
                {TriangleRenderer},
                {TriangleWebGL2Renderer}
            ] = await Promise.all([
                import('../triangle-grid-manager.js'),
                import('../../infrastructure/workers/triangle-worker-manager.js'),
                import('../engines/triangle-engine.js'),
                import('../../rendering/triangle-renderer.js'),
                import('../../rendering/triangle-webgl2-renderer.js')
            ]);

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

            const currentCs = this._getCellSize();
            const fittedCellSize = Math.max(
                AppConfig.GRID.MIN_CELL_SIZE,
                Math.min(AppConfig.GRID.MAX_CELL_SIZE, currentCs)
            );

            const prevRenderer = this._getRenderer();
            const showActivityEffect = prevRenderer?.getConfig('showActivityEffect') ?? true;
            const colorAlive = document.getElementById('colorAlive')?.value ?? AppConfig.RENDER.COLOR_ALIVE;
            const colorBorn = document.getElementById('colorBorn')?.value ?? AppConfig.RENDER.COLOR_BORN;
            const colorDying = document.getElementById('colorDying')?.value ?? AppConfig.RENDER.COLOR_DYING;

            const rendererOptions = {
                canvas, container,
                cellSize: fittedCellSize,
                showGrid: prevRenderer?.getConfig('showGrid') ?? false,
                showActivityEffect,
                colorAlive,
                colorDead: '#0f172a',
                colorGrid: 'rgba(255,255,255,0.1)',
                colorBorn,
                colorDying
            };

            const newRenderer = useWebGL2
                ? new TriangleWebGL2Renderer(rendererOptions)
                : new TriangleRenderer(rendererOptions);

            this._setRenderer(newRenderer);
            this.specialMode = SpecialEngineManager.MODES.TRIANGLE;

            const automaton = this._getAutomaton();
            automaton.cellSize = fittedCellSize;
            const cellSizeSlider = document.getElementById('cellSize');
            if (cellSizeSlider) {
                cellSizeSlider.value = fittedCellSize;
                const cellSizeDisplay = document.getElementById('cellSizeValue');
                if (cellSizeDisplay) cellSizeDisplay.textContent = `${fittedCellSize}px`;
            }

        } else if (engineName === SpecialEngineManager.MODES.HEXAGONAL) {
            const [
                {HexGridManager},
                {HexWorkerManager},
                {HexEngine},
                {HexRenderer}
            ] = await Promise.all([
                import('../hex-grid-manager.js'),
                import('../../infrastructure/workers/hex-worker-manager.js'),
                import('../engines/hex-engine.js'),
                import('../../rendering/hex-renderer.js')
            ]);

            const currentRenderer = this._getRenderer();
            currentRenderer?._destroyGridOverlay?.();
            this._originalRenderer = currentRenderer;
            this._originalCore = this._getCore();

            const canvas = document.getElementById('canvas');
            const container = document.getElementById('canvas-container');
            const ctx2d = canvas.getContext('2d');
            if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);

            const currentCs = this._getCellSize();
            const cs = Math.max(
                AppConfig.GRID.MIN_CELL_SIZE,
                Math.min(AppConfig.GRID.MAX_CELL_SIZE, currentCs)
            );

            const prevRenderer = this._getRenderer();
            const showActivityEffect = prevRenderer?.getConfig('showActivityEffect') ?? true;
            const colorAlive = document.getElementById('colorAlive')?.value ?? AppConfig.RENDER.COLOR_ALIVE;
            const colorBorn = document.getElementById('colorBorn')?.value ?? AppConfig.RENDER.COLOR_BORN;
            const colorDying = document.getElementById('colorDying')?.value ?? AppConfig.RENDER.COLOR_DYING;

            const hexRenderer = new HexRenderer({
                canvas, container,
                cellSize: cs,
                showGrid: prevRenderer?.getConfig('showGrid') ?? false,
                showActivityEffect,
                colorAlive,
                colorDead: '#0f172a',
                colorGrid: 'rgba(255,255,255,0.1)',
                colorBorn,
                colorDying
            });

            this._setRenderer(hexRenderer);
            this.specialMode = SpecialEngineManager.MODES.HEXAGONAL;
            this.hexEngine = new HexEngine(this._buildHexContext());

            const automaton2 = this._getAutomaton();
            automaton2.cellSize = cs;
            const cellSizeSlider2 = document.getElementById('cellSize');
            if (cellSizeSlider2) {
                cellSizeSlider2.value = cs;
                const cellSizeDisplay2 = document.getElementById('cellSizeValue');
                if (cellSizeDisplay2) cellSizeDisplay2.textContent = `${cs}px`;
            }
        }

        this._specialEngineLoaded = true;
    }

    // =========================================
    // DISPATCH DE GEOMETRÍA
    // Centraliza la lógica engine-específica que antes vivía en automaton.js,
    // de modo que agregar un motor con geometría propia no requiera tocar el
    // coordinador principal.
    // =========================================

    /**
     * Delega el resize al motor con geometría propia y sincroniza el estado
     * interno de cualquier motor que dependa de las dimensiones del grid.
     *
     * Debe llamarse DESPUÉS de actualizar automaton.gridWidth/gridHeight con los
     * valores reales del core, para que w y h sean las dimensiones definitivas.
     *
     * @param {number} w — ancho real post-resize
     * @param {number} h — alto real post-resize
     * @returns {{ handledRenderer: boolean }}
     *   handledRenderer: true si el motor ya ajustó su propio renderer
     *   (caller no debe llamar renderer.resize()).
     */
    onResize(w, h) {
        const M = SpecialEngineManager.MODES;
        let handledRenderer = false;

        if (this.specialMode === M.TRIANGLE && this.triangleEngine?.isActive) {
            this.triangleEngine.resize(w, h);
            handledRenderer = true;

        } else if (this.specialMode === M.HEXAGONAL && this.hexEngine?.isActive) {
            this.hexEngine.gridManager?.resize(w, h);
            this.hexEngine._newGrid = Array.from(
                {length: this.hexEngine.gridManager.width},
                () => new Uint8Array(this.hexEngine.gridManager.height)
            );
            // Notificar al HexRenderer las nuevas dimensiones del gridManager
            this._getRenderer().setGridManager?.(this.hexEngine.gridManager);
            handledRenderer = true;
        }

        // RD2D no tiene renderer propio pero necesita sincronizar sus dimensiones
        // internas independientemente de qué otro modo esté activo.
        if (this.specialMode === M.RD2D && this.rd2dEngine?.isActive) {
            this.rd2dEngine.gridWidth = w;
            this.rd2dEngine.gridHeight = h;
            this.rd2dEngine._initStateGrid();
            this.rd2dEngine.initialized = false;
        }

        return {handledRenderer};
    }

    /**
     * Retorna true si el modo activo usa su propio mecanismo de worker y el
     * worker estándar no debe activarse.
     * @returns {boolean}
     */
    usesOwnWorker() {
        return this.specialMode === SpecialEngineManager.MODES.TRIANGLE ||
            this.specialMode === SpecialEngineManager.MODES.HEXAGONAL;
    }

    /**
     * Delega el cambio de tamaño de celda al motor con firma de renderer propia.
     * Triangle usa renderer.resize(gridWidth, newSize) en lugar de la firma
     * estándar de tres argumentos (gridWidth, gridHeight, newSize).
     *
     * @param {number} gridWidth
     * @param {number} gridHeight
     * @param {number} newSize
     * @returns {{ handled: boolean }}
     */
    onCellSizeChange(gridWidth, gridHeight, newSize) {
        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.isActive) {
            this._getRenderer().resize(gridWidth, newSize);
            return {handled: true};
        }
        return {handled: false};
    }

    /**
     * Traduce coordenadas de mouse a coordenadas de celda para motores con
     * geometría propia. Retorna null si el modo activo no requiere tratamiento
     * especial (el caller debe usar el path estándar).
     *
     * Triangle y Hex pasan clientX/clientY directamente al renderer en lugar
     * de envolver en un objeto tipo Event.
     *
     * @param {number} clientX
     * @param {number} clientY
     * @returns {Object|null} coords si handled, null si usar path estándar
     */
    getCellCoords(clientX, clientY) {
        const M = SpecialEngineManager.MODES;
        if (this.specialMode === M.TRIANGLE && this.triangleEngine?.isActive) {
            return this._getRenderer().getCellFromMouse(clientX, clientY);
        }
        if (this.specialMode === M.HEXAGONAL && this.hexEngine?.isActive) {
            return this._getRenderer().getCellFromMouse(clientX, clientY);
        }
        return null;
    }

    /**
     * Dibuja una celda en motores con geometría propia (Triangle, Hex).
     * Retorna handled: false si el modo activo usa el grid estándar.
     *
     * @param {Object} coords  — { q, r } para Triangle; { col, row } para Hex
     * @param {number} state
     * @returns {{ handled: boolean, changed: boolean, dirtyX: number, dirtyY: number, population: number|null }}
     */
    onDrawCell(coords, state) {
        const M = SpecialEngineManager.MODES;
        if (this.specialMode === M.TRIANGLE && this.triangleEngine?.isActive) {
            const changed = this.triangleEngine.gridManager.setCell(coords.q, coords.r, state);
            return {
                handled: true,
                changed: !!changed,
                dirtyX: coords.q,
                dirtyY: coords.r,
                population: changed ? this.triangleEngine.gridManager.countPopulation() : null
            };
        }
        if (this.specialMode === M.HEXAGONAL && this.hexEngine?.isActive) {
            const changed = this.hexEngine.gridManager.setCell(coords.col, coords.row, state);
            return {
                handled: true,
                changed: !!changed,
                dirtyX: coords.col,
                dirtyY: coords.row,
                population: changed ? this.hexEngine.gridManager.countPopulation() : null
            };
        }
        return {handled: false, changed: false, dirtyX: 0, dirtyY: 0, population: null};
    }

    destroy() {
        this.wolframEngine?.deactivate?.();
        this.rd2dEngine?.deactivate?.();
        this.triangleEngine?.deactivate?.();
        this.hexEngine?.deactivate?.();
        this.uwEngine?.deactivate?.();
        this.langtonEngine?.deactivate?.();
        this.wireworldEngine?.deactivate?.();
        this.generationsEngine?.deactivate?.();

        this.wolframEngine = null;
        this.rd2dEngine = null;
        this.triangleEngine = null;
        this.hexEngine = null;
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
            case SpecialEngineManager.MODES.HEXAGONAL:
                this.hexEngine?.gridManager?.clear();
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
                    this.triangleEngine.gridManager.grid[q][r] = Math.random() < density ? 1 : 0;
                }
            }
            return {
                handled: true,
                population: this.triangleEngine.gridManager.countPopulation(),
                resetLimit: false
            };
        }
        if (this.specialMode === SpecialEngineManager.MODES.HEXAGONAL && this.hexEngine?.gridManager) {
            const {width, height} = this.hexEngine.gridManager;
            const grid = this.hexEngine.gridManager.grid;
            for (let c = 0; c < width; c++) {
                for (let r = 0; r < height; r++) {
                    grid[c][r] = Math.random() < density ? 1 : 0;
                }
            }
            return {
                handled: true,
                population: this.hexEngine.gridManager.countPopulation(),
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
    // CONTEXTOS
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
        const automaton = this._getAutomaton();
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
        return this._buildBaseContext(this._getAutomaton());
    }

    _buildTriangleContext() {
        const self = this;
        const automaton = this._getAutomaton();
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
        return this._buildBaseContext(this._getAutomaton());
    }

    _buildWireworldContext() {
        return this._buildBaseContext(this._getAutomaton());
    }

    _buildGenerationsContext() {
        return this._buildBaseContext(this._getAutomaton());
    }

    _buildHexContext() {
        const self = this;
        const automaton = this._getAutomaton();
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

    // =========================================
    // DESACTIVACIÓN DE MODOS CON RENDERER PROPIO
    // =========================================

    /**
     * Desactiva el modo triangular y restaura renderer/core originales.
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
            this._getAutomaton()._resizeRenderer();
        }
        if (this._originalCore) {
            this._setCore(this._originalCore);
            this._originalCore = null;
        }
    }

    /**
     * Desactiva el modo hexagonal y restaura renderer/core originales.
     */
    deactivateHex() {
        if (this.hexEngine) {
            this.hexEngine.deactivate();
            this.hexEngine = null;
        }
        if (this._originalRenderer) {
            const oldRenderer = this._getRenderer();
            this._setRenderer(this._originalRenderer);
            this._originalRenderer = null;
            oldRenderer?.destroy?.();
            this._getAutomaton()._resizeRenderer();
        }
        if (this._originalCore) {
            this._setCore(this._originalCore);
            this._originalCore = null;
        }
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
            return typeof gl.createVertexArray === 'function' &&
                typeof gl.drawArraysInstanced === 'function';
        } catch (e) {
            return false;
        }
    }
}

export {SpecialEngineManager};