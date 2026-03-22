/**
 * CellularAutomaton — Coordinador del autómata celular.
 *
 * Responsabilidad: conectar y orquestar los subsistemas sin conocer sus
 * detalles internos.
 *
 * Subsistemas directos:
 *   CellularAutomatonCore — matemática pura (grid, vecindad, reglas)
 *   StateManager          — undo/redo, historial de población
 *   GridRenderer          — renderizado Canvas 2D con dirty rendering
 *   AnimationLoop         — timing RAF
 *   SimulationLimiter     — límites por generación / población
 *   GridWorkerManager     — Web Worker para grids grandes
 *   SpecialEngineManager  — motores alternativos (Wolfram, RD-2D, ...)
 *   EditCoordinator       — operaciones de edición del grid
 */
class CellularAutomaton {
    constructor(gridSize = 500, cellSize = 2) {
        this.gridSize = Math.min(Math.max(gridSize, 20), 1000);
        this.cellSize = Math.min(Math.max(cellSize, 1), 20);

        // === CORE MATEMÁTICO ===
        this.core = new CellularAutomatonCore({
            size: this.gridSize,
            rule: {birth: [3], survival: [2, 3]},
            neighborhoodType: 'moore',
            neighborhoodRadius: 1,
            wrapEdges: true
        });

        // === STATE MANAGER ===
        this.stateManager = new StateManager(this.core.gridManager, {
            maxHistory: 50,
            maxPopulationHistory: 100
        });

        this.stateManager.on({
            onStateChange: (event) => this._handleStateChange(event),
            onHistoryChange: (stats) => this._handleHistoryChange(stats)
        });

        this.stateManager.startTracking();

        this.core.on({
            onGeneration: (stats) => this._handleCoreGeneration(stats),
            onCellChange: (indices, count) => this._handleCoreCellChange(indices, count),
            onStateChange: (event) => this._handleCoreStateChange(event)
        });

        // === RENDERIZADO VISUAL ===
        this.renderer = new GridRenderer({
            canvas: document.getElementById('canvas'),
            container: document.getElementById('canvas-container'),
            gridSize: this.gridSize,
            cellSize: this.cellSize,
            showGrid: true,
            showActivityEffect: true,
            getCell: (x, y) => this.core.getCell(x, y),
            getRD2DState: (x, y) => this.rd2dEngine?.stateGrid?.[x]?.[y],
            isRD2DActive: () => this.specialMode === SpecialEngineManager.MODES.RD2D && this.rd2dEngine?.isActive,
            getGridSize: () => this.gridSize
        });

        // === ESTADO DE EJECUCIÓN ===
        this.generation = 0;
        this._loop = new AnimationLoop({onStep: () => this._step()});

        // === WORKERS ===
        this._workerManager = new GridWorkerManager({
            workerPath: 'scripts/infrastructure/workers/automaton-worker.js',
            threshold: 600,
            getGridSize: () => this.gridSize,
            getCore: () => this.core,
            onResult: ({generation, population, changedCells, changedCount}) => {
                this.generation = generation;
                this.stateManager.recordPopulation(population);

                if (changedCount > 0) {
                    for (let i = 0; i < changedCount; i++) {
                        this.renderer.markDirtyIndex(changedCells[i]);
                    }
                } else {
                    this.renderer.markAllDirty();
                }

                this.updateStats(population);
                this.checkLimits();
                this.renderer.updateActivityAges(changedCells, changedCount);
                this.render();
            },
            onError: () => {
                this.renderer.markAllDirty();
                this.render();
            }
        });
        this._workerManager.init();

        // === MOTORES ESPECIALES ===
        this._engineManager = new SpecialEngineManager({
            getRenderer: () => this.renderer,
            setRenderer: (r) => {
                this.renderer = r;
            },
            getCore: () => this.core,
            setCore: (c) => {
                this.core = c;
            },
            getGridSize: () => this.gridSize,
            getCellSize: () => this.cellSize,
            getAutomaton: () => this
        });

        // === LÍMITES ===
        this._limiter = new SimulationLimiter({
            onLimitReached: () => {
                this.stop();
                eventBus.emit('automaton:runningChanged', {isRunning: false});
            }
        });

        // === EDITOR ===
        this._editor = new EditCoordinator(this);

        // === EVENTOS GLOBALES ===
        this._cleanupResize = this._addEventListener(window, 'resize', () => {
            setTimeout(() => this.render(), 100);
        });

        this._init().catch(err => {
            console.error('Error inicializando autómata:', err);
            eventBus.emit('automaton:error', err);
        });
    }

    // =========================================
    // PROPIEDADES DELEGADAS
    // =========================================

    get canvas() {
        return this.renderer?.canvas;
    }

    get ctx() {
        return this.renderer?.ctx;
    }

    get showGrid() {
        return this.renderer?.getConfig('showGrid');
    }

    get grid() {
        return this.core?.gridManager?.grid;
    }

    set grid(value) {
        if (this.core?.gridManager) this.core.gridManager.grid = value;
    }

    get limitType() {
        return this._limiter.limitType;
    }

    get isLimitReached() {
        return this._limiter.isLimitReached;
    }

    set isLimitReached(v) {
        this._limiter.isLimitReached = v;
    }

    get rule() {
        return {
            birth: this.core?.ruleEngine?.birth || [3],
            survival: this.core?.ruleEngine?.survival || [2, 3]
        };
    }

    get neighborhoodType() {
        return this.core?.neighborhood?.type || 'moore';
    }

    get neighborhoodRadius() {
        return this.core?.neighborhood?.radius || 1;
    }

    get wrapEdges() {
        return this.core?.neighborhood?.wrapEdges ?? true;
    }

    set wrapEdges(value) {
        this.core?.neighborhood?.configure({wrapEdges: value});
    }

    get undoCount() {
        return this.stateManager?.undoCount || 0;
    }

    get redoCount() {
        return this.stateManager?.redoCount || 0;
    }

    get canUndo() {
        return this.stateManager?.canUndo || false;
    }

    get canRedo() {
        return this.stateManager?.canRedo || false;
    }

    get populationHistory() {
        return this.stateManager?.populationHistory;
    }

    get specialMode() {
        return this._engineManager.specialMode;
    }

    set specialMode(v) {
        this._engineManager.specialMode = v;
    }

    get wolframEngine() {
        return this._engineManager.wolframEngine;
    }

    set wolframEngine(v) {
        this._engineManager.wolframEngine = v;
    }

    get rd2dEngine() {
        return this._engineManager.rd2dEngine;
    }

    set rd2dEngine(v) {
        this._engineManager.rd2dEngine = v;
    }

    get triangleEngine() {
        return this._engineManager.triangleEngine;
    }

    set triangleEngine(v) {
        this._engineManager.triangleEngine = v;
    }

    get uwEngine() {
        return this._engineManager.uwEngine;
    }

    set uwEngine(v) {
        this._engineManager.uwEngine = v;
    }

    get langtonEngine() {
        return this._engineManager.langtonEngine;
    }

    set langtonEngine(v) {
        this._engineManager.langtonEngine = v;
    }

    get wireworldEngine() {
        return this._engineManager.wireworldEngine;
    }

    set wireworldEngine(v) {
        this._engineManager.wireworldEngine = v;
    }

    get _originalRenderer() {
        return this._engineManager._originalRenderer;
    }

    set _originalRenderer(v) {
        this._engineManager._originalRenderer = v;
    }

    get worker() {
        return this._workerManager._worker;
    }

    get workerThreshold() {
        return this._workerManager.threshold;
    }

    get isWorkerProcessing() {
        return this._workerManager.isProcessing;
    }

    set isWorkerProcessing(v) {
        this._workerManager.isProcessing = v;
    }

    get isRunning() {
        return this._loop.isRunning;
    }

    // Asignaciones directas (this.isRunning = false) son no-ops por compatibilidad.
    set isRunning(_) {
    }

    // =========================================
    // INICIALIZACIÓN
    // =========================================

    async _init() {
        await this._initRule();
        this.renderer.markAllDirty();
        this.renderer.render({generation: 0});
        eventBus.emit('automaton:ready', this);
    }

    async _initRule() {
        let attempts = 0;
        while (!window.RULES && attempts < 50) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        const ruleKey = window.RULES?.conway ? 'conway' : Object.keys(window.RULES || {})[0];
        if (ruleKey && window.RULES?.[ruleKey]) {
            const rule = window.RULES[ruleKey];
            this.core.setRule({birth: rule.birth, survival: rule.survival});
        }
    }

    // =========================================
    // CALLBACKS DEL CORE
    // =========================================

    _handleCoreGeneration(stats) {
        this.generation = stats.generation;
        this.stateManager.recordPopulation(stats.population);
        eventBus.emit('stats:updated', stats);
    }

    _handleCoreCellChange(indices, count) {
        for (let i = 0; i < count; i++) {
            this.renderer.markDirtyIndex(indices[i]);
        }
    }

    _handleCoreStateChange(event) {
        switch (event.type) {
            case 'clear':
                this.renderer.resetActivity();
                this.renderer.markAllDirty();
                break;
            case 'resize':
                this.gridSize = event.size;
                this.renderer.markAllDirty();
                break;
            case 'ruleChange':
                this.generation = 0;
                this.isLimitReached = false;
                this.renderer.markAllDirty();
                eventBus.emit('automaton:ruleChanged', this.core.ruleEngine);
                break;
            case 'neighborhoodChange':
                this.generation = 0;
                this.isLimitReached = false;
                this.renderer.markAllDirty();
                eventBus.emit('automaton:neighborhoodChanged', event.info);
                break;
            case 'randomize':
                this.renderer.markAllDirty();
                eventBus.emit('automaton:randomized', event);
                break;
            case 'deserialize':
                this.renderer.markAllDirty();
                this.updateStats();
                break;
        }
    }

    _handleStateChange(event) {
        eventBus.emit('state:changed', event);
        switch (event.type) {
            case 'clear':
            case 'randomize':
            case 'import':
            case 'paste':
                this.renderer.markAllDirty();
                this.updateStats();
                this.render();
                break;
        }
    }

    _handleHistoryChange(stats) {
        eventBus.emit('history:changed', stats);
    }

    // =========================================
    // WORKERS
    // =========================================

    _initWorker() {
        this._workerManager.init();
    }

    /** Sincroniza el grid del worker tras cualquier edición manual. */
    _syncWorkerGrid() {
        this._workerManager.syncGrid();
    }

    _cleanupWorker() {
        this._workerManager.cleanup();
    }

    // =========================================
    // GENERACIÓN — dispatch polimórfico
    // =========================================

    nextGeneration() {
        if (this.checkLimits()) return 0;
        const t0 = performance.now();
        return this.specialMode
            ? this._stepEngineMode(t0)
            : this._stepStandardMode(t0);
    }

    /**
     * Paso en modo motor especial: obtiene el descriptor del engine activo
     * y ejecuta la lógica común (stop, stats, activity, render, timing).
     */
    _stepEngineMode(t0) {
        const desc = this._engineManager.stepActive();
        if (!desc) return 0;

        if (!desc.continued) {
            this.stop();
            eventBus.emit('automaton:runningChanged', {isRunning: false});
            if (desc.stopMessage) console.debug(desc.stopMessage);
        }

        this.generation = desc.generation;
        this.updateStats(desc.population);

        const cc = desc.changedCells;
        if (!desc.skipActivity) {
            this.renderer.updateActivityAges(cc);
        }
        if (desc.markDirtyFromCells) {
            for (let i = 0; i < cc.length; i++) {
                this.renderer.markDirty(cc[i] >>> 16, cc[i] & 0xFFFF);
            }
        }

        const tStep = performance.now();
        this.render();
        this._debugTiming(desc.label, t0, tStep, performance.now());
        return 1;
    }

    /** Paso en modo estándar: core síncrono o worker. */
    _stepStandardMode(t0) {
        const result = (this.worker && this.gridSize >= this.workerThreshold)
            ? this._nextGenerationWorker()
            : this._nextGenerationCore();
        const tStep = performance.now();
        this._debugTiming('Standard', t0, tStep, tStep); // render se mide en _step
        return result;
    }

    // =========================================
    // WRAPPERS DE RENDERER — para SpecialModeController
    // Evitan que el controller UI acceda directamente a this.renderer.
    // =========================================

    _resetRendererCanvas() {
        this.renderer.resizeCanvas();
    }

    _reGrid() {
        this.renderer.reGrid();
    }

    _resizeRenderer(gs, cs) {
        this.renderer.resize(gs, cs);
    }

    /** Conecta el gridManager del motor triangular al renderer activo. */
    _setRendererGridManager(gm) {
        this.renderer.setGridManager?.(gm);
    }

    _nextGenerationCore() {
        const stats = this.core.step();
        // stats.changedCells es el Uint32Array interno de RuleEngine (reutilizado).
        // Debe consumirse antes del próximo step(). Lo pasamos con el count lógico
        // para evitar el spread [...Set] que creaba un Array de hasta 160k entradas.
        const changed = stats.births + stats.deaths;
        if (changed > this.gridSize * this.gridSize * 0.1) {
            this.renderer.markAllDirty();
        }
        // Population ya viene calculada en stats: evita un segundo countPopulation() O(n²).
        this._checkLimitsWithPop(stats.population);
        this.renderer.updateActivityAges(stats.changedCells, stats.changedCount);
        return changed;
    }

    _nextGenerationWorker() {
        this._workerManager.requestNextGeneration();
        return 0;
    }

    _debugTiming(mode, t0, tStep, tRender) {
        const stepMs = tStep - t0;
        // Si tRender == tStep el render aún no ocurrió (se mide en _step para modo síncrono)
        const renderMs = tRender > tStep ? tRender - tStep : null;
        const totalMs = renderMs !== null ? tRender - t0 : stepMs;

        const α = 0.15;
        if (!this._perf) {
            this._perf = {
                stepMs: stepMs,
                renderMs: renderMs ?? 0,
                totalMs: totalMs,
                genCount: 0, lastSecond: tRender, genPerSec: 0, mode
            };
        } else {
            this._perf.stepMs = α * stepMs + (1 - α) * this._perf.stepMs;
            if (renderMs !== null) {
                this._perf.renderMs = α * renderMs + (1 - α) * this._perf.renderMs;
                this._perf.totalMs = α * totalMs + (1 - α) * this._perf.totalMs;
            }
            this._perf.mode = mode;
        }

        // Contar gen/s en ventana de 1 segundo
        this._perf.genCount++;
        if (tRender - this._perf.lastSecond >= 1000) {
            this._perf.genPerSec = this._perf.genCount;
            this._perf.genCount = 0;
            this._perf.lastSecond = tRender;
        }

        if (this._perfVisible) {
            eventBus.emit('perf:update', this._perf);
        }

        if (!this._lastDebugLog || tRender - this._lastDebugLog >= 2000) {
            this._lastDebugLog = tRender;
            console.debug(
                `⏱ [${mode}] Gen ${this.generation} | ` +
                `step: ${stepMs.toFixed(2)}ms | ` +
                (renderMs !== null ? `render: ${renderMs.toFixed(2)}ms | ` : '') +
                `total: ${totalMs.toFixed(2)}ms`
            );
        }
    }

    // =========================================
    // BUCLE DE ANIMACIÓN
    // =========================================

    _step(stepsPerFrame = 1) {
        if (this.specialMode) {
            this.nextGeneration();
            return;
        }
        if (this._workerManager.isProcessing) return;
        if (this._workerManager.isAvailable) {
            this.nextGeneration();
            return;
        }
        // Modo síncrono: medir render separado del cálculo
        let stepsRun = 0;
        for (let i = 0; i < stepsPerFrame; i++) {
            if (!this.isRunning) break;
            if (this.nextGeneration() === 0) break;
            stepsRun++;
        }
        if (stepsRun > 0) {
            const tRenderStart = performance.now();
            this.render();
            const tRenderEnd = performance.now();
            // Actualizar renderMs en el EMA con la medición real
            if (this._perf) {
                const α = 0.15;
                const renderMs = tRenderEnd - tRenderStart;
                this._perf.renderMs = α * renderMs + (1 - α) * this._perf.renderMs;
                this._perf.totalMs = this._perf.stepMs + this._perf.renderMs;
                // Sumar pasos adicionales al contador (nextGeneration ya sumó 1)
                if (stepsRun > 1) this._perf.genCount += stepsRun - 1;
            }
        }
    }

    // =========================================
    // API PÚBLICA — consulta y configuración
    // =========================================

    render() {
        if (!this.renderer || this._isDestroyed) return;
        this.renderer.render({generation: this.generation});
    }

    _markAllDirty() {
        this.renderer?.markAllDirty();
    }

    setCell(x, y, state, markDirty = true) {
        if (markDirty && this.stateManager?.isTracking) {
            this.stateManager.saveState(this.generation);
        }

        const changed = this.core.setCell(x, y, state);

        if (changed) {
            this.renderer.markDirty(x, y);

            if (this.specialMode === SpecialEngineManager.MODES.RD2D && this.rd2dEngine?.isActive) {
                if (this.rd2dEngine.stateGrid?.[x]) {
                    this.rd2dEngine.stateGrid[x][y] = state
                        ? (this.rd2dEngine._inferStateFromNeighbors(x, y) || 15)
                        : 0;
                }
            }
        }

        return changed;
    }

    getCell(x, y) {
        return this.core.getCell(x, y);
    }

    setRule(survival, birth) {
        this.core.setRule({birth, survival});
    }

    setRuleByKey(ruleKey) {
        if (!window.RULES?.[ruleKey]) throw new Error(`Regla ${ruleKey} no encontrada`);
        const rule = window.RULES[ruleKey];
        this.setRule(rule.survival, rule.birth);
        return true;
    }

    resizeGrid(newSize) {
        const size = Math.min(Math.max(newSize, 20), 1000);
        if (this.isRunning) this.stop();

        this.core.resize(size);
        this.gridSize = this.core.gridManager.size;

        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.isActive) {
            this.triangleEngine.resize(size);
        } else {
            this.renderer.resize(this.gridSize, this.cellSize);
        }

        if (this.specialMode === SpecialEngineManager.MODES.RD2D && this.rd2dEngine?.isActive) {
            this.rd2dEngine.gridSize = this.gridSize;
            this.rd2dEngine._initStateGrid();
            this.rd2dEngine.initialized = false;
        }

        this.updateStats();
        this.render();

        if (size >= this.workerThreshold && this.specialMode !== SpecialEngineManager.MODES.TRIANGLE) {
            this._initWorker();
        }

        eventBus.emit('automaton:resized', {size});
    }

    setCellSize(size) {
        const newSize = Math.min(Math.max(size, 1), 20);
        this.cellSize = newSize;
        this.renderer.resize(this.gridSize, newSize);
        // Resetear actividad: el redimensionado del canvas invalida el estado
        // visual anterior y dejaría todas las celdas pintadas de amarillo.
        this.renderer.resetActivity();
        this.render();
        eventBus.emit('automaton:zoomChanged', {zoom: newSize});
    }

    setNeighborhoodType(type) {
        this.core.setNeighborhood({type});
    }

    setNeighborhoodRadius(radius) {
        this.core.setNeighborhood({radius});
    }

    updateStats(populationOverride = null) {
        const population = populationOverride !== null
            ? populationOverride
            : this.core.gridManager.countPopulation();
        const density = (population / (this.gridSize * this.gridSize) * 100).toFixed(1);
        eventBus.emit('stats:updated', {generation: this.generation, population, density});
    }

    checkLimits() {
        return this._limiter.check(this.generation, () => this.core.gridManager.countPopulation());
    }

    /**
     * Igual que checkLimits() pero recibe la población ya calculada en este frame,
     * evitando un segundo countPopulation() O(n²) en _nextGenerationCore().
     * @param {number} population
     */
    _checkLimitsWithPop(population) {
        return this._limiter.check(this.generation, () => population);
    }

    setLimit(type, value) {
        this._limiter.setLimit(type, value);
        eventBus.emit('automaton:limitChanged', {type, value});
    }

    getCellFromMouse(e) {
        return this.renderer.getCellFromMouse(e);
    }

    toggleGrid() {
        const newState = this.renderer.toggleGrid();
        this.render();
        eventBus.emit('automaton:gridToggled', {showGrid: newState});
        return newState;
    }

    setShowActivityEffect(enabled) {
        this.renderer.setConfig('showActivityEffect', enabled);
        this.render();
        eventBus.emit('automaton:showActivityEffectChanged', {enabled});
        return enabled;
    }

    /** Activa o desactiva la recolección y emisión de métricas de rendimiento. */
    setPerfVisible(visible) {
        this._perfVisible = visible;
        if (!visible) this._perf = null;
    }

    // =========================================
    // CONTROL DE EJECUCIÓN
    // =========================================

    toggleRunning() {
        if (this.checkLimits()) {
            this.isLimitReached = false;
            this.generation = 0;
            this.updateStats();
        }
        if (this._loop.isRunning) {
            this.stop();
        } else {
            this.start();
        }
        return this._loop.isRunning;
    }

    start() {
        if (this._loop.isRunning) return;
        // markAllDirty garantiza que el primer frame pinta el estado actual.
        // Los motores especiales retoman incrementalmente y no necesitan esto.
        if (!this.specialMode) this.renderer.markAllDirty();
        this._loop.start();
    }

    stop() {
        this._loop.stop();
    }

    setSpeed(level) {
        const result = this._loop.setSpeed(level);
        eventBus.emit('automaton:speedChanged', {speed: result.interval, stepsPerFrame: result.stepsPerFrame});
        return result.interval;
    }

    // =========================================
    // DELEGACIÓN A EditCoordinator
    // =========================================

    randomize(density) {
        return this._editor.randomize(density);
    }

    clear() {
        return this._editor.clear();
    }

    copyArea(minX, minY, maxX, maxY) {
        return this._editor.copyArea(minX, minY, maxX, maxY);
    }

    async pasteArea(area, ox, oy) {
        return this._editor.pasteArea(area, ox, oy);
    }

    clearPatternCells(area, ox, oy) {
        return this._editor.clearPatternCells(area, ox, oy);
    }

    clearArea(minX, minY, maxX, maxY) {
        return this._editor.clearArea(minX, minY, maxX, maxY);
    }

    async importPattern(pat, cx, cy) {
        return this._editor.importPattern(pat, cx, cy);
    }

    exportPattern(bounds) {
        return this._editor.exportPattern(bounds);
    }

    exportWireworldState(name, desc) {
        return this._editor.exportWireworldState(name, desc);
    }

    importWireworldState(sg, pw, ph) {
        return this._editor.importWireworldState(sg, pw, ph);
    }

    shiftGrid(dx, dy) {
        return this._editor.shiftGrid(dx, dy);
    }

    undo() {
        return this._editor.undo();
    }

    redo() {
        return this._editor.redo();
    }

    downloadPattern(filename) {
        return this._editor.downloadPattern(filename);
    }

    // =========================================
    // MOTORES ESPECIALES
    // =========================================

    async _initSpecialEngine(engineName) {
        return this._engineManager.activate(engineName);
    }

    // =========================================
    // API DE DIBUJO — para CanvasController
    // Centralizan el dispatch al motor activo,
    // evitando que el controller conozca los engines.
    // =========================================

    /**
     * Traduce coordenadas de cliente (pixels CSS) a coordenadas de celda del
     * motor activo.
     * - Modo Triangle: devuelve {q, r} del renderer triangular.
     * - Resto: devuelve {x, y} del renderer estándar.
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{q?: number, r?: number, x?: number, y?: number} | null}
     */
    getCellCoords(clientX, clientY) {
        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.isActive) {
            return this.renderer.getCellFromMouse(clientX, clientY);
        }
        return this.renderer.getCellFromMouse({clientX, clientY});
    }

    /**
     * Dibuja una celda usando el motor activo y actualiza el estado.
     * - Triangle: acepta {q, r}.
     * - Resto: acepta {x, y}.
     * No aplica a Langton ni WireWorld (tienen APIs propias).
     * @param {{ q: number, r: number } | { x: number, y: number }} coords
     * @param {number} state — 0 o 1
     * @returns {boolean} changed
     */
    drawCellAt(coords, state) {
        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.isActive) {
            const changed = this.triangleEngine.gridManager.setCell(coords.q, coords.r, state);
            if (changed) {
                this.renderer.markDirty(coords.q, coords.r);
                this.render();
                this.updateStats(this.triangleEngine.gridManager.countPopulation());
            }
            return !!changed;
        }
        const changed = this.setCell(coords.x, coords.y, state ? 1 : 0);
        if (changed) {
            this.updateStats();
            this.render();
        }
        return changed;
    }

    /**
     * Lee el estado de celda del motor especial activo.
     * WireWorld: estados 0-3. Resto: estado binario del grid.
     */
    getEngineStateAt(x, y) {
        if (this.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.wireworldEngine?.isActive) {
            return this.wireworldEngine.stateGrid[x]?.[y] ?? 0;
        }
        return this.core.getCell(x, y);
    }

    /**
     * Establece el estado de celda del motor especial activo y renderiza.
     * WireWorld: estados 0-3 vía engine.setStateAt.
     */
    setEngineStateAt(x, y, state) {
        if (this.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.wireworldEngine?.isActive) {
            const changed = this.wireworldEngine.setStateAt(x, y, state);
            if (changed) {
                this.updateStats();
                this.render();
            }
            return changed;
        }
        return this.setCell(x, y, state);
    }

    /**
     * Elimina el agente/celda del motor activo en (x, y) y renderiza.
     * - Langton: quita hormiga y limpia stateGrid.
     * - Resto: borra celda (state 0).
     */
    eraseEngineAt(x, y) {
        if (this.specialMode === SpecialEngineManager.MODES.LANGTON && this.langtonEngine?.isActive) {
            this.langtonEngine.eraseAt(x, y);
            this.renderer.markDirty(x, y);
            this.render();
            return;
        }
        const changed = this.setCell(x, y, 0);
        if (changed) {
            this.updateStats();
            this.render();
        }
    }

    /**
     * Añade un agente en (x, y) para el motor activo y renderiza.
     * Langton: agrega hormiga. Resto: dibuja celda viva.
     * @param {number} x
     * @param {number} y
     * @param {number} [dir=0] — dirección inicial (Langton: 0=N 1=E 2=S 3=W)
     */
    addEngineAgentAt(x, y, dir = 0) {
        if (this.specialMode === SpecialEngineManager.MODES.LANGTON && this.langtonEngine?.isActive) {
            this.langtonEngine.addAnt(x, y, dir);
            this.renderer.markDirty(x, y);
            this.render();
            return;
        }
        this.drawCellAt({x, y}, 1);
    }

    /**
     * Sincroniza el motor activo con el estado del grid tras una edición
     * masiva (mover/pegar selección). Reemplaza los tres if/else de endDrag
     * en CanvasController.
     */
    syncEngineAfterEdit() {
        this.renderer.resetActivity();
        const {specialMode, langtonEngine, rd2dEngine, wireworldEngine} = this;
        if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) langtonEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) rd2dEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) wireworldEngine.syncFromGrid();
    }

    /**
     * Retorna el modo activo y la info del engine para DisplayController.
     * @returns {{ mode: string, info: Object|null }}
     */
    getActiveEngineInfo() {
        return this._engineManager.getActiveInfo();
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        if (this._isDestroyed) return;

        this.stop();

        if (this._cleanupResize) {
            try {
                this._cleanupResize();
            } catch (e) {
            }
            this._cleanupResize = null;
        }

        this._cleanupWorker();

        this.stateManager?.destroy();
        this.stateManager = null;

        this.renderer?.destroy();
        this.renderer = null;

        this.core?.destroy();
        this.core = null;

        this._loop?.destroy();
        this._loop = null;

        this._limiter?.destroy();
        this._limiter = null;

        this._engineManager?.destroy();
        this._engineManager = null;

        this._workerManager?.destroy();
        this._workerManager = null;

        // EditCoordinator solo guarda una referencia, no tiene recursos propios
        this._editor = null;

        this._isDestroyed = true;
        eventBus.emit('automaton:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        return () => target.removeEventListener(event, handler, options);
    }
}

window.CellularAutomaton = CellularAutomaton;