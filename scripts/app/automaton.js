/**
 * CellularAutomaton - Coordinador del autómata celular
 *
 * Responsabilidad: Integrar todos los subsistemas:
 * - Core matemático (CellularAutomatonCore)
 * - Gestión de estado (StateManager)
 * - Renderizado visual (GridRenderer)
 * - Workers para grids grandes
 * - Motores especiales (Wolfram, RD-2D)
 * - Comunicación con UI (EventBus)
 */

class CellularAutomaton {
    constructor(gridSize = 200, cellSize = 4) {
        this.gridSize = Math.min(Math.max(gridSize, 20), 400);
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
            onCellChange: (cells) => this._handleCoreCellChange(cells),
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
            isRD2DActive: () => this.specialMode === 'rd2d' && this.rd2dEngine?.isActive,
            getGridSize: () => this.gridSize
        });

        // === ESTADO DE EJECUCIÓN ===
        this.generation = 0;
        this._loop = new AnimationLoop({
            onStep: () => this._step()
        });

        // === WORKERS ===
        this._workerManager = new GridWorkerManager({
            workerPath: 'scripts/infrastructure/workers/automaton-worker.js',
            threshold: 100,
            getGridSize: () => this.gridSize,
            getCore: () => this.core,
            onResult: ({generation, population, changedCells, size}) => {
                this.generation = generation;
                this.stateManager.recordPopulation(population);

                if (Array.isArray(changedCells)) {
                    changedCells.forEach(index => {
                        if (index >= 0 && index < size * size) {
                            this.renderer.markDirty(Math.floor(index / size), index % size);
                        }
                    });
                } else {
                    this.renderer.markAllDirty();
                }

                this.updateStats();
                this.checkLimits();
                this.renderer.updateActivityAges(changedCells || []);
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

        // === EVENTOS ===
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
        if (this.core?.gridManager) {
            this.core.gridManager.grid = value;
        }
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
        if (this.core?.neighborhood) {
            this.core.neighborhood.configure({wrapEdges: value});
        }
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

    // =========================================
    // INICIALIZACIÓN
    // =========================================

    get isRunning() {
        return this._loop.isRunning;
    }

    set isRunning(_) {
        // Las asignaciones directas (this.isRunning = false) son redundantes
        // tras llamar a start()/stop(). Este setter las convierte en no-ops
        // para mantener compatibilidad sin efectos secundarios.
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    async _init() {
        await this._initRule();

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.core.getCell(x, y)) {
                    this.renderer.markDirty(x, y);
                }
            }
        }

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

        if (this.stateManager) {
            this.stateManager.destroy();
            this.stateManager = null;
        }

        if (this.renderer) {
            this.renderer.destroy();
            this.renderer = null;
        }

        if (this.core) {
            this.core.destroy();
            this.core = null;
        }

        if (this.wolframEngine) {
            this.wolframEngine.deactivate?.();
            this.wolframEngine = null;
        }
        if (this.rd2dEngine) {
            this.rd2dEngine.deactivate?.();
            this.rd2dEngine = null;
        }

        this._loop?.destroy();
        this._loop = null;

        this._limiter?.destroy();
        this._limiter = null;

        this._engineManager?.destroy();
        this._engineManager = null;

        this._workerManager?.destroy();
        this._workerManager = null;

        this._isDestroyed = true;
        eventBus.emit('automaton:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        return () => target.removeEventListener(event, handler, options);
    }

    _handleCoreGeneration(stats) {
        this.generation = stats.generation;
        this.stateManager.recordPopulation(stats.population);
        eventBus.emit('stats:updated', stats);
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

    _handleCoreCellChange(cells) {
        for (const cell of cells) {
            this.renderer.markDirty(cell.x, cell.y);
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

    _initWorker() {
        this._workerManager.init();
    }

    _cleanupWorker() {
        this._workerManager.cleanup();
    }

    // =========================================
    // GENERACIÓN
    // =========================================

    _nextGenerationWorker() {
        return this._workerManager.requestNextGeneration(this.generation) ? 0 : 0;
    }

    nextGeneration() {
        if (this.checkLimits()) return 0;

        if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive) {
            const continued = this.rd2dEngine.step();
            if (!continued) {
                this.stop();
                console.debug('RD-2D: Simulación detenida (estable)');
            }
            this.generation = this.rd2dEngine.generation;
            this.updateStats();

            // Usar array pre-calculado del engine, sin crear nuevos objetos
            this.renderer.updateActivityAges(this.rd2dEngine.getChangedCells());

            this.render();
            return 1;
        }

        if (this.specialMode === 'wolfram' && this.wolframEngine?.isActive) {
            const continued = this.wolframEngine.step();
            if (!continued) {
                this.stop();
                console.debug('Wolfram: Límite alcanzado');
            }
            this.generation = this.wolframEngine.generation;
            this.updateStats();

            // Para Wolfram, usar dirty cells del renderer
            const changedIndices = [];
            this.renderer._dirtyCells.forEach(index => changedIndices.push(index));
            this.renderer.updateActivityAges(changedIndices);

            this.render();
            return 1;
        }

        // === MODO TRIANGULAR ===
        if (this.specialMode === 'triangle' && this.triangleEngine?.isActive) {
            // Verificar que tenemos gridManager
            if (!this.triangleEngine.gridManager) {
                console.error('❌ TriangleEngine sin gridManager');
                return 0;
            }

            const continued = this.triangleEngine.step();

            if (!continued) {
                this.stop();
                console.debug('Triangle: Sin cambios');
            }

            this.generation = this.triangleEngine.generation;

            // Actualizar población desde el grid triangular
            const population = this.triangleEngine.gridManager?.countPopulation() ?? 0;
            this.updateStats(population);

            // Actualizar activity ages en el renderer triangular
            const changedCells = this.triangleEngine.getChangedCells();
            this.renderer.updateActivityAges(changedCells);

            this.render();
            return 1;
        }

        this.renderer._prevFlags = new Uint8Array(this.renderer._renderFlags);

        if (this.worker && this.gridSize >= this.workerThreshold) {
            return this._nextGenerationWorker();
        }
    }

    // =========================================
    // RENDERIZADO (DELEGADO)
    // =========================================

    restoreStandardMode() {
        this._engineManager.restoreStandardMode();
        this.renderer.resize(this.gridSize, this.cellSize);
        this.renderer.markAllDirty();
    }

    _nextGenerationCore() {
        const stats = this.core.step();

        if (stats.births + stats.deaths > this.gridSize * this.gridSize * 0.1) {
            this.renderer.markAllDirty();
        }

        this.checkLimits();

        const changedIndices = [];
        this.renderer._dirtyCells.forEach(index => {
            changedIndices.push(index);
        });
        this.renderer.updateActivityAges(changedIndices);

        return stats.births + stats.deaths;
    }

    // =========================================
    // MÉTODOS PÚBLICOS
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

            if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive) {
                if (this.rd2dEngine.stateGrid?.[x]) {
                    if (state) {
                        this.rd2dEngine.stateGrid[x][y] = this.rd2dEngine._inferStateFromNeighbors(x, y) || 15;
                    } else {
                        this.rd2dEngine.stateGrid[x][y] = 0;
                    }
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
        if (!window.RULES?.[ruleKey]) {
            throw new Error(`Regla ${ruleKey} no encontrada`);
        }
        const rule = window.RULES[ruleKey];
        this.setRule(rule.survival, rule.birth);
        return true;
    }

    resizeGrid(newSize) {
        const size = Math.min(Math.max(newSize, 20), 400);

        if (this.isRunning) this.stop();

        this.core.resize(size);
        this.gridSize = this.core.gridManager.size;

        if (this.specialMode === 'triangle' && this.triangleEngine?.isActive) {
            this.triangleEngine.resize(size);
        } else {
            this.renderer.resize(this.gridSize, this.cellSize);
        }

        // Sincronizar stateGrid de RD-2D con el nuevo tamaño
        if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive) {
            this.rd2dEngine.gridSize = this.gridSize;
            this.rd2dEngine._initStateGrid();
            this.rd2dEngine.initialized = false;
        }

        this.updateStats();
        this.render();

        if (size >= this.workerThreshold && this.specialMode !== 'triangle') {
            this._initWorker();
        }

        eventBus.emit('automaton:resized', {size});
    }

    setCellSize(size) {
        const newSize = Math.min(Math.max(size, 1), 20);
        this.cellSize = newSize;
        this.renderer.resize(this.gridSize, newSize);
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

        eventBus.emit('stats:updated', {
            generation: this.generation,
            population,
            density
        });
    }

    checkLimits() {
        return this._limiter.check(
            this.generation,
            () => this.core.gridManager.countPopulation()
        );
    }

    setLimit(type, value) {
        this._limiter.setLimit(type, value);
        eventBus.emit('automaton:limitChanged', {type, value});
    }

    getCellFromMouse(e) {
        const rect = this.canvas.getBoundingClientRect();
        const actualWidth = this.canvas.offsetWidth;
        const actualHeight = this.canvas.offsetHeight;
        const scaleX = this.canvas.width / actualWidth;
        const scaleY = this.canvas.height / actualHeight;

        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        const x = Math.max(0, Math.min(Math.floor(canvasX / this.cellSize), this.gridSize - 1));
        const y = Math.max(0, Math.min(Math.floor(canvasY / this.cellSize), this.gridSize - 1));

        return {x, y};
    }

    // =========================================
    // EDICIÓN DE ÁREAS
    // =========================================

    copyArea(minX, minY, maxX, maxY) {
        return this.stateManager.copyArea(minX, minY, maxX, maxY);
    }

    async pasteArea(area, offsetX, offsetY) {
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
            this.isRunning = false;
        }

        if (this.isWorkerProcessing) {
            await new Promise(resolve => {
                const check = () => this.isWorkerProcessing ? setTimeout(check, 10) : resolve();
                check();
            });
            this._cleanupWorker();
        }

        const result = this.stateManager.pasteArea(area, offsetX, offsetY, {
            saveToHistory: true,
            generation: this.generation
        });

        if (result.changedCells.length > 0) {
            result.changedCells.forEach(cell => {
                this.renderer.markDirty(cell.x, cell.y);
            });

            this.renderer._prevFlags = new Uint8Array(this.renderer._renderFlags);
            this.updateStats();
            this.renderer.markAllDirty();
            this.render();

            if (this.gridSize >= this.workerThreshold) {
                this._initWorker();
            }
        }

        if (wasRunning) {
            requestAnimationFrame(() => {
                this.isRunning = true;
                this.start();
            });
        }

        return result;
    }

    clearArea(minX, minY, maxX, maxY) {
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
            this.isRunning = false;
        }

        if (this.isWorkerProcessing) {
            this._cleanupWorker();
        }

        const result = this.stateManager.clearArea(minX, minY, maxX, maxY, {
            saveToHistory: true,
            generation: this.generation
        });

        if (result.changedCells.length > 0) {
            result.changedCells.forEach(cell => {
                this.renderer.markDirty(cell.x, cell.y);
            });

            this.renderer._prevFlags = new Uint8Array(this.renderer._renderFlags);
            this.updateStats();
            this.render();
        }

        if (wasRunning) {
            requestAnimationFrame(() => {
                this.isRunning = true;
                this.start();
            });
        }

        return result;
    }

    undo() {
        const result = this.stateManager.undo(this.generation);
        if (result) {
            this.generation = result.generation;

            if (this.specialMode === 'wolfram' && this.wolframEngine?.isActive) {
                this.wolframEngine.reset();
            }
            if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive) {
                this.rd2dEngine.reset();
            }

            this.renderer.markAllDirty();
            this.updateStats();
            this.render();
            eventBus.emit('automaton:undo', {generation: this.generation});
            return true;
        }
        return false;
    }

    redo() {
        const result = this.stateManager.redo(this.generation);
        if (result) {
            this.generation = result.generation;

            if (this.specialMode === 'wolfram' && this.wolframEngine?.isActive) {
                this.wolframEngine.reset();
            }
            if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive) {
                this.rd2dEngine.reset();
            }

            this.renderer.markAllDirty();
            this.updateStats();
            this.render();
            eventBus.emit('automaton:redo', {generation: this.generation});
            return true;
        }
        return false;
    }

    async importPattern(pattern, centerX, centerY) {
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
            this.isRunning = false;
        }

        if (this.isWorkerProcessing) {
            await new Promise(resolve => {
                const check = () => this.isWorkerProcessing ? setTimeout(check, 10) : resolve();
                check();
            });
            this._cleanupWorker();
        }

        const result = this.stateManager.importPattern(pattern, centerX, centerY, {
            saveToHistory: true,
            generation: this.generation
        });

        if (result.changedCells.length > 0) {
            result.changedCells.forEach(cell => {
                this.renderer.markDirty(cell.x, cell.y);
            });

            this.renderer._prevFlags = new Uint8Array(this.renderer._renderFlags);
            this.updateStats();
            this.renderer.markAllDirty();
            this.render();

            if (this.gridSize >= this.workerThreshold) {
                this._initWorker();
            }
        }

        if (wasRunning) {
            requestAnimationFrame(() => {
                this.isRunning = true;
                this.start();
            });
        }

        return result;
    }

    exportPattern() {
        return this.stateManager.exportPattern();
    }

    downloadPattern(filename) {
        return this.stateManager.downloadPattern(filename);
    }

    randomize(density = 0.35) {
        const wasRunning = this.isRunning;
        this.stop();

        this._cleanupWorker();

        if (this.specialMode === 'triangle' && this.triangleEngine?.gridManager) {
            const width = this.triangleEngine.gridManager.width;
            const height = this.triangleEngine.gridManager.height;

            for (let q = 0; q < width; q++) {
                for (let r = 0; r < height; r++) {
                    const state = Math.random() < density ? 1 : 0;
                    this.triangleEngine.gridManager.setCell(q, r, state);
                }
            }

            this.generation = 0;
            this.renderer.markAllDirty();
            this.renderer.resetActivity();
            this.updateStats(this.triangleEngine.gridManager.countPopulation());
            this.render();

            if (wasRunning) {
                setTimeout(() => this.start(), 0);
            }
            return;
        }

        const stats = this.stateManager.randomize({
            density,
            saveToHistory: true,
            generation: this.generation
        });

        this.renderer.resetActivity();
        this.generation = 0;
        this.isLimitReached = false;

        this.wolframEngine?.reset();
        this.rd2dEngine?.reset();

        this.renderer.markAllDirty();
        this.updateStats(stats.population);
        this.render();

        this._initWorker();

        if (wasRunning) {
            setTimeout(() => this.start(), 0);
        }

        return stats;
    }

    clear() {
        const wasRunning = this.isRunning;

        // === PASO 1: Detener siempre (común a todos los modos) ===
        if (wasRunning) {
            this.stop();
            this.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        if (this.isWorkerProcessing) {
            this._cleanupWorker();
        }

        // === PASO 2: Limpiar grid del autómata base (siempre) ===
        this._clearBaseGrid();

        // === PASO 3: Limpiar motor especial activo ===
        this._clearSpecialEngine();

        // === PASO 4: Resetear estado común (SIEMPRE, sin condiciones) ===
        this._resetCommonState();

        // === PASO 5: Renderizado y actualización ===
        this.renderer._isFirstRender = true;
        this.renderer.markAllDirty();
        this.render();
        this.updateStats(0);

        console.debug('🧹 Clear completado - Modo:', this.specialMode || 'estándar');
    }

    /**
     * Limpia el grid base del autómata (array 2D estándar)
     * @private
     */
    _clearBaseGrid() {
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                this.grid[x][y] = 0;
            }
        }
    }

    /**
     * Limpia el motor especial activo según el modo
     * @private
     */
    _clearSpecialEngine() {
        switch (this.specialMode) {
            case 'wolfram':
                this.wolframEngine?.reset();
                this.wolframEngine?._initializeSeed?.();
                break;

            case 'rd2d':
                this.rd2dEngine?.reset();
                break;

            case 'triangle':
                // Limpiar grid triangular
                if (this.triangleEngine?.gridManager) {
                    for (let q = 0; q < this.triangleEngine.gridManager.width; q++) {
                        this.triangleEngine.gridManager.grid[q].fill(0);
                    }
                }
                // Resetear estado del motor triangular
                this.triangleEngine?.reset?.();
                break;

            default:
                // Modo estándar: limpiar stateManager
                this.stateManager?.clear({
                    saveToHistory: true,
                    generation: this.generation
                });
                break;
        }
    }

    /**
     * Resetea estado común SIEMPRE, independientemente del modo
     * @private
     */
    _resetCommonState() {
        // Estas líneas son CRÍTICAS y deben ejecutarse SIEMPRE
        this.generation = 0;
        this.isLimitReached = false;

        // Resetear activity del renderer
        this.renderer?.resetActivity();

        // Resetear todos los motores especiales por si acaso
        this.wolframEngine?.reset?.();
        this.rd2dEngine?.reset?.();
        this.triangleEngine?.reset?.();
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

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.core.getCell(x, y)) {
                    this.renderer.markDirty(x, y);
                }
            }
        }
        this.renderer.markAllDirty();
        this._loop.start();
    }

    stop() {
        this._loop.stop();
    }

    _step() {
        if (this.specialMode === 'triangle') {
            const changed = this.nextGeneration();
            if (changed || this.generation % 5 === 0) {
                this.render();
            }
            if (this.generation % 10 === 0) {
                this.updateStats();
            }
        } else {
            this.nextGeneration();
            this.render();
        }
    }

    setSpeed(level) {
        const interval = this._loop.setSpeed(level);
        eventBus.emit('automaton:speedChanged', {speed: interval});
        return interval;
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

    // =========================================
    // MOTORES ESPECIALES
    // =========================================

    async _initSpecialEngine(engineName) {
        return this._engineManager.activate(engineName);
    }
}

window.CellularAutomaton = CellularAutomaton;