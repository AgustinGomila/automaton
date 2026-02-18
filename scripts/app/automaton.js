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
        this.isRunning = false;
        this.generation = 0;
        this.updateInterval = 100;
        this.rafId = null;
        this._lastFrameTime = 0;

        // === WORKERS ===
        this.worker = null;
        this.workerThreshold = 100;
        this.isWorkerProcessing = false;
        this._currentHandlerId = null;
        this._initWorker();

        // === MOTORES ESPECIALES ===
        this.wolframEngine = null;
        this.rd2dEngine = null;
        this.triangleEngine = null;
        this.specialMode = null;
        this._specialEngineLoaded = false;
        this._originalRenderer = null;
        this._originalCore = null;

        // === LÍMITES ===
        this.limitType = 'none';
        this.limitValue = 1000;
        this.maxGenerations = null;
        this.maxPopulation = null;
        this.isLimitReached = false;

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

    // =========================================
    // INICIALIZACIÓN
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
    // LIFECYCLE & CLEANUP
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

        this._isDestroyed = true;
        eventBus.emit('automaton:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        return () => target.removeEventListener(event, handler, options);
    }

    // =========================================
    // CALLBACKS DEL CORE
    // =========================================

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

    // =========================================
    // WORKERS
    // =========================================

    _initWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isWorkerProcessing = false;
        }

        if (this.gridSize >= this.workerThreshold && window.Worker) {
            try {
                this.worker = new Worker('scripts/infrastructure/workers/automaton-worker.js');
                const handlerId = `worker_handler_${Date.now()}`;
                this._currentHandlerId = handlerId;

                this.worker.onmessage = (e) => {
                    if (this._currentHandlerId !== handlerId) return;

                    const {newGrid, changedCells, population, generation, error} = e.data;

                    if (error) {
                        console.error('Error en worker:', error);
                        this.isWorkerProcessing = false;
                        this._cleanupWorker();
                        return;
                    }

                    if (!this.worker || this._currentHandlerId !== handlerId) return;

                    if (!newGrid || !Array.isArray(newGrid)) {
                        console.error('Grid inválido desde worker:', newGrid);
                        this.isWorkerProcessing = false;
                        return;
                    }

                    const size = this.gridSize;
                    for (let x = 0; x < size; x++) {
                        const col = newGrid[x];
                        if (col instanceof Uint8Array && col.length === size) {
                            this.core.gridManager.grid[x].set(col);
                        } else if (Array.isArray(col) || ArrayBuffer.isView(col)) {
                            for (let y = 0; y < size && y < col.length; y++) {
                                this.core.gridManager.grid[x][y] = col[y] ? 1 : 0;
                            }
                        }
                    }

                    this.generation = generation;
                    this.stateManager.recordPopulation(population);

                    if (Array.isArray(changedCells)) {
                        changedCells.forEach(index => {
                            if (index >= 0 && index < size * size) {
                                const x = Math.floor(index / size);
                                const y = index % size;
                                this.renderer.markDirty(x, y);
                            }
                        });
                    } else {
                        this.renderer.markAllDirty();
                    }

                    this.updateStats();
                    this.checkLimits();
                    this.renderer.updateActivityAges(changedCells || []);
                    this.render();

                    this.isWorkerProcessing = false;
                };

                this.worker.onerror = (error) => {
                    if (this._currentHandlerId !== handlerId) return;
                    console.error('Worker error:', error);
                    this.isWorkerProcessing = false;
                    this._cleanupWorker();
                    this.renderer.markAllDirty();
                    this.render();
                };

            } catch (error) {
                console.warn('No se pudo crear worker:', error);
                this._cleanupWorker();
            }
        }
    }

    _cleanupWorker() {
        if (this.worker) {
            this._currentHandlerId = null;
            this.worker.terminate();
            this.worker = null;
            this.isWorkerProcessing = false;
        }
    }

    _nextGenerationWorker() {
        if (this.isWorkerProcessing) return 0;

        this.isWorkerProcessing = true;

        const size = this.gridSize;
        const flatGrid = new Uint8Array(size * size);

        const grid = this.core.gridManager.grid;
        for (let x = 0; x < size; x++) {
            const col = grid[x];
            const baseIdx = x * size;
            for (let y = 0; y < size; y++) {
                flatGrid[baseIdx + y] = col[y] ? 1 : 0;
            }
        }

        const messageData = {
            grid: flatGrid,
            gridSize: size,
            rule: {
                birth: this.core.ruleEngine.birth,
                survival: this.core.ruleEngine.survival
            },
            wrapEdges: this.core.neighborhood.wrapEdges,
            neighborhoodType: this.core.neighborhood.type,
            neighborhoodRadius: this.core.neighborhood.radius,
            neighborOffsets: this.core.neighborhood._offsets,
            generation: this.generation
        };

        try {
            this.worker.postMessage(messageData, [flatGrid.buffer]);
        } catch (e) {
            this.worker.postMessage(messageData);
        }

        return 0;
    }

    // =========================================
    // GENERACIÓN
    // =========================================

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
        } else {
            return this._nextGenerationCore();
        }
    }

    // Método para restaurar modo estándar
    restoreStandardMode() {
        if (this._originalRenderer) {
            this.renderer = this._originalRenderer;
            this._originalRenderer = null;
        }
        if (this._originalCore) {
            this.core = this._originalCore;
            this._originalCore = null;
        }
        this.specialMode = null;

        // Re-inicializar renderer estándar
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
    // RENDERIZADO (DELEGADO)
    // =========================================

    render() {
        if (!this.renderer || this._isDestroyed) return;
        this.renderer.render({generation: this.generation});
    }

    _markAllDirty() {
        this.renderer?.markAllDirty();
    }

    // =========================================
    // MÉTODOS PÚBLICOS
    // =========================================

    setCell(x, y, state, markDirty = true) {
        if (markDirty && this.stateManager?.isTracking) {
            this.stateManager.saveState(this.generation);
        }

        const changed = this.core.setCell(x, y, state);

        if (changed) {
            this.renderer.markDirty(x, y);

            if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive) {
                if (state) {
                    this.rd2dEngine.stateGrid[x][y] = this.rd2dEngine._inferStateFromNeighbors(x, y) || 15;
                } else {
                    this.rd2dEngine.stateGrid[x][y] = 0;
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
        this.renderer.resize(this.gridSize, this.cellSize);

        // Notificar al motor triangular si está activo
        if (this.specialMode === 'triangle' && this.triangleEngine?.isActive) {
            this.triangleEngine.resize(size);
        }

        this.updateStats();
        this.render();

        if (size >= this.workerThreshold) {
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
        if (this.limitType === 'none') {
            this.isLimitReached = false;
            return false;
        }

        if (this.limitType === 'generations' && this.maxGenerations !== null) {
            this.isLimitReached = this.generation >= this.maxGenerations;
        } else if (this.limitType === 'population' && this.maxPopulation !== null) {
            this.isLimitReached = this.core.gridManager.countPopulation() >= this.maxPopulation;
        }

        // Si se alcanzó el límite y estábamos corriendo, detener y sincronizar UI
        if (this.isLimitReached && this.isRunning) {
            this.stop();
            this.isRunning = false;

            // Notificar a UI para actualizar botón Play/Pause y habilitar Step
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        return this.isLimitReached;
    }

    setLimit(type, value) {
        this.limitType = type;

        switch (type) {
            case 'none':
                this.maxGenerations = null;
                this.maxPopulation = null;
                break;
            case 'generations':
                this.maxGenerations = parseInt(value);
                this.maxPopulation = null;
                break;
            case 'population':
                this.maxPopulation = parseInt(value);
                this.maxGenerations = null;
                break;
        }

        this.limitValue = value;
        this.isLimitReached = false;
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

        // Si estamos en modo triangular
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

        this.isRunning = !this.isRunning;

        if (this.isRunning) {
            this.start();
        } else {
            this.stop();
        }

        return this.isRunning;
    }

    start() {
        if (this.rafId) {
            console.warn('RAF ya activo');
            return;
        }

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.core.getCell(x, y)) {
                    this.renderer.markDirty(x, y);
                }
            }
        }
        this.renderer.markAllDirty();

        this._lastFrameTime = performance.now();
        this._animateRAF();
    }

    stop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    _animateRAF(currentTime = 0) {
        if (!this.isRunning) return;

        const deltaTime = currentTime - this._lastFrameTime;

        if (deltaTime >= this.updateInterval) {
            this._lastFrameTime = currentTime - (deltaTime % this.updateInterval);

            // Para modo triangular, usar estrategia diferente
            if (this.specialMode === 'triangle') {
                // Procesar generación
                const changed = this.nextGeneration();

                // Solo renderizar si hubo cambios o cada 5 frames mínimo
                if (changed || this.generation % 5 === 0) {
                    this.render();
                }

                // Actualizar stats solo cada 10 generaciones
                if (this.generation % 10 === 0) {
                    this.updateStats();
                }
            } else {
                // Modo estándar
                this.nextGeneration();
                this.render();
            }
        }

        this.rafId = requestAnimationFrame((time) => this._animateRAF(time));
    }

    setSpeed(level) {
        const minSpeed = 500;  // Más lento = más tiempo entre frames
        const maxSpeed = 16;   // ~60fps máximo

        // Mapeo no-lineal para mejor control
        const speedMap = [500, 250, 125, 60, 30, 16, 16, 16, 16, 16];
        this.updateInterval = speedMap[Math.min(level - 1, 9)] || 16;

        if (this.isRunning) {
            this.stop();
            this.start();
        }

        eventBus.emit('automaton:speedChanged', {speed: this.updateInterval});
        return this.updateInterval;
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
        if (this.specialMode === engineName && this._specialEngineLoaded) {
            return Promise.resolve();
        }

        // Desactivar todos los motores especiales activos
        if (this.wolframEngine?.isActive) {
            this.wolframEngine.deactivate();
        }
        if (this.rd2dEngine?.isActive) {
            this.rd2dEngine.deactivate();
        }
        if (this.triangleEngine?.isActive) {
            this.triangleEngine.deactivate();
        }

        // Restaurar renderer y core originales si existen
        if (this._originalRenderer) {
            this.renderer = this._originalRenderer;
            this._originalRenderer = null;
        }
        if (this._originalCore) {
            this.core = this._originalCore;
            this._originalCore = null;
        }

        if (engineName === 'rd2d') {
            if (typeof RD2DEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/rd2d-engine.js');
            }
            this.rd2dEngine = new RD2DEngine(this);
            this.specialMode = 'rd2d';
        } else if (engineName === 'wolfram') {
            if (typeof WolframEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/wolfram-engine.js');
            }
            this.wolframEngine = new WolframEngine(this);
            this.specialMode = 'wolfram';
        } else if (engineName === 'triangle') {
            // Cargar dependencias si no existen
            if (typeof TriangleGridManager === 'undefined') {
                await this._loadScript('scripts/core/engines/triangle-grid-manager.js');
            }
            if (typeof TriangleEngine === 'undefined') {
                await this._loadScript('scripts/core/engines/triangle-engine.js');
            }

            // === Cargar ambos renderers ===
            if (typeof TriangleRenderer === 'undefined') {
                await this._loadScript('scripts/rendering/triangle-renderer.js');
            }
            if (typeof TriangleWebGL2Renderer === 'undefined') {
                await this._loadScript('scripts/rendering/triangle-webgl2-renderer.js');
            }

            // Guardar referencias originales
            if (!this._originalRenderer) {
                this._originalRenderer = this.renderer;
            }
            if (!this._originalCore) {
                this._originalCore = this.core;
            }

            // Crear motor triangular
            this.triangleEngine = new TriangleEngine(this);

            // === Selección dinámica de renderer ===
            const canvas = document.getElementById('canvas');
            const container = document.getElementById('canvas-container');

            // Limpiar canvas anterior
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Detectar WebGL2 y crear renderer apropiado
            const useWebGL2 = this._detectWebGL2Support();

            const rendererOptions = {
                canvas: canvas,
                container: container,
                cellSize: Math.max(3, Math.min(6, this.cellSize)),
                showGrid: this._originalRenderer?.getConfig('showGrid') ?? true,
                colorAlive: '#ec4899',
                colorDead: '#0f172a',
                colorGrid: 'rgba(255,255,255,0.1)'
            };

            this.renderer = useWebGL2
                ? new TriangleWebGL2Renderer(rendererOptions)
                : new TriangleRenderer(rendererOptions);

            this.specialMode = 'triangle';
        }

        this._specialEngineLoaded = true;
        return Promise.resolve();
    }

    /**
     * Detecta soporte WebGL2 con instancing
     * @private
     */
    _detectWebGL2Support() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl2');
            if (!gl) return false;
            // Instancing el core en WebGL2, pero verificamos por seguridad
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

window.CellularAutomaton = CellularAutomaton;