/**
 * CellularAutomaton — Coordinador del autómata celular.
 *
 * Actualizado para grids rectangulares (width × height).
 * • gridWidth / gridHeight reemplazan a gridSize como fuente de verdad.
 * • gridSize se mantiene como getter (Math.max) para compatibilidad legacy.
 * • resizeGrid acepta (width, height) con height opcional (cuadrado por defecto).
 * • Worker, renderer y engines especiales reciben dimensiones rectangulares.
 */
class CellularAutomaton {
    constructor(gridWidth = 500, gridHeight = gridWidth, cellSize = 2) {
        // Soportar firma legacy: constructor(gridSize, cellSize)
        // Si gridHeight parece un cellSize (1–20) y gridWidth es grande → API legacy
        if (gridHeight >= 1 && gridHeight <= 20 && gridWidth > 20) {
            cellSize = gridHeight;
            gridHeight = gridWidth;
        }

        this.gridWidth = Math.min(Math.max(gridWidth, 20), 1000);
        this.gridHeight = Math.min(Math.max(gridHeight, 20), 1000);
        this.cellSize = Math.min(Math.max(cellSize, 1), 20);

        // === CORE MATEMÁTICO ===
        this.core = new CellularAutomatonCore({
            width: this.gridWidth,
            height: this.gridHeight,
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
            gridWidth: this.gridWidth,
            gridHeight: this.gridHeight,
            cellSize: this.cellSize,
            showGrid: true,
            showActivityEffect: true,
            getCell: (x, y) => this.core.getCell(x, y),
            getRD2DState: (x, y) => this.rd2dEngine?.stateGrid?.[x]?.[y],
            isRD2DActive: () => this.specialMode === SpecialEngineManager.MODES.RD2D && this.rd2dEngine?.isActive,
            getGridWidth: () => this.gridWidth,
            getGridHeight: () => this.gridHeight
        });

        // === ESTADO DE EJECUCIÓN ===
        this.generation = 0;
        this._loop = new AnimationLoop({onStep: () => this._step()});

        // === WORKERS ===
        this._workerManager = new GridWorkerManager({
            workerPath: 'scripts/infrastructure/workers/automaton-worker.js',
            threshold: 600,
            getGridWidth: () => this.gridWidth,
            getGridHeight: () => this.gridHeight,
            getCore: () => this.core,
            onResult: ({generation, population, changedCells, changedCount}) => {
                const tStep = performance.now();

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

                // Emitir métricas si es visible
                if (this._workerStartTime && this._perfVisible) {
                    const modeLabel = this._getPerfModeLabel();
                    this._debugTiming(modeLabel, this._workerStartTime, tStep, performance.now());
                    this._workerStartTime = null;
                }
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
            getGridWidth: () => this.gridWidth,
            getGridHeight: () => this.gridHeight,
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

    /** Alias legacy: dimensión mayor del grid. */
    get gridSize() {
        return Math.max(this.gridWidth, this.gridHeight);
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

    get generationsEngine() {
        return this._engineManager.generationsEngine;
    }

    set generationsEngine(v) {
        this._engineManager.generationsEngine = v;
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

    set isRunning(_) {
    }  // no-op para compatibilidad

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
                this.gridWidth = event.width ?? this.gridWidth;
                this.gridHeight = event.height ?? this.gridHeight;
                this.renderer.markAllDirty();
                break;
            case 'ruleChange':
                this.generation = 0;
                this.isLimitReached = false;
                this.renderer.markAllDirty();
                this.render();
                // Re-inicializar el worker para que aplique la nueva regla B/S.
                this._initWorker();
                eventBus.emit('automaton:ruleChanged', this.core.ruleEngine);
                break;
            case 'neighborhoodChange':
                this.generation = 0;
                this.isLimitReached = false;
                this.renderer.markAllDirty();
                // Re-inicializar el worker para que reciba los nuevos offsets.
                // Sin esto, grids ≥ 600 seguirían usando el fastpath Moore-1
                // sin importar la vecindad configurada.
                this._initWorker();
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
        this._cleanupWorker();
        this._workerManager.init();
    }

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
        if (!desc.skipActivity) this.renderer.updateActivityAges(cc);
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

    _stepStandardMode(t0) {
        const result = (this.worker && this.gridSize >= this.workerThreshold)
            ? this._nextGenerationWorker()
            : this._nextGenerationCore();
        this._pendingStepT0 = t0;
        this._pendingStepTime = performance.now();
        return result;
    }

    // =========================================
    // WRAPPERS DE RENDERER
    // =========================================

    _resetRendererCanvas() {
        this.renderer.resizeCanvas();
    }

    _reGrid() {
        this.renderer.reGrid();
    }

    /**
     * Redimensiona el renderer para las dimensiones actuales del grid.
     * @param {number} [gw]  — si se omite, usa this.gridWidth
     * @param {number} [gh]  — si se omite, usa this.gridHeight
     * @param {number} [cs]  — si se omite, usa this.cellSize
     */
    _resizeRenderer(gw, gh, cs) {
        this.renderer.resize(
            gw ?? this.gridWidth,
            gh ?? this.gridHeight,
            cs ?? this.cellSize
        );
    }

    _setRendererGridManager(gm) {
        this.renderer.setGridManager?.(gm);
    }

    // =========================================
    // CORE — PASO
    // =========================================

    _nextGenerationCore() {
        const stats = this.core.step();
        const changed = stats.births + stats.deaths;
        if (changed > this.gridWidth * this.gridHeight * 0.1) {
            this.renderer.markAllDirty();
        }
        this._checkLimitsWithPop(stats.population);
        this.renderer.updateActivityAges(stats.changedCells, stats.changedCount);
        return changed;
    }

    _nextGenerationWorker(stepsPerFrame = 1) {
        this._workerStartTime = performance.now(); // Guardar tiempo de inicio
        this._workerManager.requestNextGeneration(stepsPerFrame);
        return 0;
    }

    _getPerfModeLabel() {
        if (!this.specialMode) return 'Standard';
        return this.specialMode.name;
    }

    _debugTiming(mode, t0, tStep, tRender) {
        const stepMs = tStep - t0;
        const renderMs = tRender - tStep;
        const totalMs = tRender - t0;
        const α = 0.15;

        if (!this._perf || this._perf.mode !== mode) {
            this._perf = {
                stepMs, renderMs, totalMs,
                lastSecond: tRender, lastGenSnapshot: this.generation,
                genPerSec: 0, mode
            };
        } else {
            this._perf.stepMs = α * stepMs + (1 - α) * this._perf.stepMs;
            this._perf.renderMs = α * renderMs + (1 - α) * this._perf.renderMs;
            this._perf.totalMs = α * totalMs + (1 - α) * this._perf.totalMs;
            this._perf.mode = mode;
        }

        if (tRender - this._perf.lastSecond >= 1000) {
            this._perf.genPerSec = this.generation - this._perf.lastGenSnapshot;
            this._perf.lastGenSnapshot = this.generation;
            this._perf.lastSecond = tRender;
        }

        if (this._perfVisible) eventBus.emit('perf:update', this._perf);

        if (!this._lastDebugLog || tRender - this._lastDebugLog >= 2000) {
            this._lastDebugLog = tRender;
            console.debug(
                `⏱ [${mode}] Gen ${this.generation} | ` +
                `step: ${stepMs.toFixed(2)}ms | render: ${renderMs.toFixed(2)}ms | ` +
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
            // El worker ejecuta stepsPerFrame pasos internamente antes de responder.
            // Esto hace efectivos los niveles de velocidad 7-10 incluso con el worker.
            this._nextGenerationWorker(stepsPerFrame);
            return;
        }

        for (let i = 0; i < stepsPerFrame; i++) {
            if (!this.isRunning) break;
            if (this.nextGeneration() === 0) break;
        }
        this.render();
        if (this._pendingStepTime !== undefined) {
            const modeLabel = this._getPerfModeLabel();
            this._debugTiming(modeLabel, this._pendingStepT0, this._pendingStepTime, performance.now());
            this._pendingStepT0 = this._pendingStepTime = undefined;
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
            if (this.specialMode === SpecialEngineManager.MODES.GENERATIONS && this.generationsEngine?.isActive) {
                if (this.generationsEngine.stateGrid?.[x]) {
                    this.generationsEngine.stateGrid[x][y] = state ? 1 : 0;
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

    /**
     * Redimensiona el grid.
     * @param {number} newWidth
     * @param {number} [newHeight=newWidth] — omitir para cuadrado
     */
    resizeGrid(newWidth, newHeight = newWidth) {
        const w = Math.min(Math.max(newWidth, 20), 1000);
        const h = Math.min(Math.max(newHeight, 20), 1000);

        if (this.isRunning) this.stop();

        this.core.resize(w, h);
        this.gridWidth = this.core.gridManager.width;
        this.gridHeight = this.core.gridManager.height;

        // 3. Redimensionar el renderer (según modo especial)
        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.isActive) {
            // Pasar las dimensiones rectangulares reales para que el engine
            // calcule triWidth = gw*2, triHeight = gh y preserve las proporciones.
            this.triangleEngine.resize(w, h);
        } else {
            this.renderer.resize(this.gridWidth, this.gridHeight, this.cellSize);
        }

        // 4. Sincronizar motores especiales que mantienen estado propio
        if (this.specialMode === SpecialEngineManager.MODES.RD2D && this.rd2dEngine?.isActive) {
            this.rd2dEngine.gridWidth = this.gridWidth;
            this.rd2dEngine.gridHeight = this.gridHeight;
            this.rd2dEngine.gridSize = Math.max(this.gridWidth, this.gridHeight);
            this.rd2dEngine._initStateGrid();
            this.rd2dEngine.initialized = false;
        }

        // 5. Forzar repintado completo
        this.renderer.markAllDirty();
        this.updateStats();
        this.render();

        if (Math.max(w, h) >= this.workerThreshold &&
            this.specialMode !== SpecialEngineManager.MODES.TRIANGLE) {
            this._initWorker();
        }

        eventBus.emit('automaton:resized', {width: w, height: h});
    }

    setCellSize(size) {
        const newSize = Math.min(Math.max(size, 1), 20);
        this.cellSize = newSize;

        // El renderer triangular acepta (gridSize, cellSize) — 2 parámetros.
        // La firma estándar (gridWidth, gridHeight, cellSize) pasaría gridHeight
        // como cellSize, ignorando newSize por completo.
        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.isActive) {
            this.renderer.resize(this.gridWidth, newSize);
        } else {
            this.renderer.resize(this.gridWidth, this.gridHeight, newSize);
        }

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
        const density = (population / (this.gridWidth * this.gridHeight) * 100).toFixed(1);
        eventBus.emit('stats:updated', {generation: this.generation, population, density});
    }

    checkLimits() {
        return this._limiter.check(this.generation,
            () => this.core.gridManager.countPopulation());
    }

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

    toggleGridHighlights() {
        const newState = this.renderer.toggleGridHighlights();
        this.render();
        eventBus.emit('automaton:gridHighlightsToggled', {showGridHighlights: newState});
        return newState;
    }

    setShowActivityEffect(enabled) {
        this.renderer.setConfig('showActivityEffect', enabled);
        this.render();
        eventBus.emit('automaton:showActivityEffectChanged', {enabled});
        return enabled;
    }

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

    // =========================================
    // MOTORES ESPECIALES
    // =========================================

    async _initSpecialEngine(engineName) {
        return this._engineManager.activate(engineName);
    }

    // =========================================
    // API DE DIBUJO
    // =========================================

    getCellCoords(clientX, clientY) {
        if (this.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.triangleEngine?.isActive) {
            return this.renderer.getCellFromMouse(clientX, clientY);
        }
        return this.renderer.getCellFromMouse({clientX, clientY});
    }

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

    getEngineStateAt(x, y) {
        if (this.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.wireworldEngine?.isActive) {
            return this.wireworldEngine.stateGrid[x]?.[y] ?? 0;
        }
        return this.core.getCell(x, y);
    }

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

    addEngineAgentAt(x, y, dir = 0) {
        if (this.specialMode === SpecialEngineManager.MODES.LANGTON && this.langtonEngine?.isActive) {
            this.langtonEngine.addAnt(x, y, dir);
            this.renderer.markDirty(x, y);
            this.render();
            return;
        }
        this.drawCellAt({x, y}, 1);
    }

    syncEngineAfterEdit() {
        this.renderer.resetActivity();
        const {specialMode, langtonEngine, rd2dEngine, wireworldEngine, generationsEngine} = this;
        if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) langtonEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) rd2dEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) wireworldEngine.syncFromGrid();
    }

    /**
     * Variante de syncEngineAfterEdit para operaciones de move/drag que ya
     * relocalizaron los agentes con moveEngineAgents().
     *
     * En Langton, syncFromGrid() reconstruye ants[] solo donde stateGrid===0,
     * matando TODAS las hormigas activas (stateGrid > 0). Por eso se omite:
     * moveEngineAgents() ya trasladó ants[] al destino correctamente.
     * Los demás engines (RD2D, WireWorld) no tienen agentes posicionales y
     * sí necesitan sincronizar su stateGrid desde grid[][].
     */
    syncEngineAfterMove() {
        this.renderer.resetActivity();
        const {specialMode, rd2dEngine, wireworldEngine} = this;
        if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) rd2dEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) wireworldEngine.syncFromGrid();
    }

    /**
     * Relocaliza los agentes del engine activo de un área origen a un área destino.
     * Actualmente solo Langton tiene agentes (hormigas) con posición propia.
     * En todos los demás modos es un no-op.
     *
     * @param {number} srcX — columna izquierda del área origen
     * @param {number} srcY — fila superior del área origen
     * @param {number} srcW — ancho del área (celdas)
     * @param {number} srcH — alto del área (celdas)
     * @param {number} dstX — columna izquierda del área destino
     * @param {number} dstY — fila superior del área destino
     */
    moveEngineAgents(srcX, srcY, srcW, srcH, dstX, dstY) {
        const {specialMode, langtonEngine} = this;
        if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) {
            langtonEngine.moveAgents(srcX, srcY, srcW, srcH, dstX, dstY);
        }
    }

    getActiveEngineInfo() {
        return this._engineManager.getActiveInfo();
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        if (this._isDestroyed) return;
        this.stop();

        try {
            this._cleanupResize?.();
        } catch (e) {
        }
        this._cleanupResize = null;

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