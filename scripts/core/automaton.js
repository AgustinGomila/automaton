/**
 * CellularAutomaton - Coordinador del autómata celular
 *
 * Responsabilidad: Integrar el core matemático con:
 * - Renderizado en canvas
 * - Workers para grids grandes
 * - Motores especiales (Wolfram, RD-2D)
 * - Gestión de estado (undo, límites)
 * - Comunicación con UI (EventBus)
 */

class CellularAutomaton {
    constructor(gridSize = 200, cellSize = 4) {
        // Validación de parámetros
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

        // Conectar callbacks del core
        this.core.on({
            onGeneration: (stats) => this._handleCoreGeneration(stats),
            onCellChange: (cells) => this._handleCoreCellChange(cells),
            onStateChange: (event) => this._handleCoreStateChange(event)
        });

        // === ESTADO DE EJECUCIÓN ===
        this.isRunning = false;
        this.generation = 0;
        this.updateInterval = 100;
        this.rafId = null;
        this._lastFrameTime = 0;

        // === RENDERIZADO ===
        this.canvas = document.getElementById('canvas');
        if (!this.canvas) {
            throw new Error('Canvas element no encontrado');
        }
        this.ctx = this.canvas.getContext('2d');
        this.showGrid = true;
        this.showActivityEffect = true;

        // Flags para dirty rendering
        this.dirtyCells = new Set();
        this.renderFlags = new Uint8Array(this.gridSize * this.gridSize);
        this.prevFlags = new Uint8Array(this.gridSize * this.gridSize);
        this.activityAges = new Uint8Array(this.gridSize * this.gridSize);
        this.activityCooldown = 3;

        this.resizeCanvas();

        // === WORKERS ===
        this.worker = null;
        this.workerThreshold = 100;
        this.isWorkerProcessing = false;
        this._currentHandlerId = null;
        this._initWorker();

        // === MOTORES ESPECIALES ===
        this.wolframEngine = null;
        this.rd2dEngine = null;
        this.specialMode = null;
        this._specialEngineLoaded = false;

        // === UNDO MANAGER ===
        this.undoManager = new UndoManager(50);
        this.undoManager.startTracking();

        // === LÍMITES ===
        this.limitType = 'none';
        this.limitValue = 1000;
        this.maxGenerations = null;
        this.maxPopulation = null;
        this.isLimitReached = false;

        // === HISTORIAL ===
        this.populationHistory = new CircularArray(100);
        this._lastPopulation = 0;

        // === EVENTOS ===
        this._cleanupResize = this._addEventListener(window, 'resize', () => {
            setTimeout(() => this.render(), 100);
        });

        // Inicializar
        this._init().catch(err => {
            console.error('Error inicializando autómata:', err);
            eventBus.emit('automaton:error', err);
        });
    }

    // =========================================
    // INICIALIZACIÓN
    // =========================================

    get grid() {
        return this.core?.gridManager?.grid;
    }

    set grid(value) {
        if (this.core?.gridManager) {
            this.core.gridManager.grid = value;
        }
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    get rule() {
        return {
            birth: this.core?.ruleEngine?.birth || [3],
            survival: this.core?.ruleEngine?.survival || [2, 3]
        };
    }

    get neighborhoodType() {
        return this.core?.neighborhood?.type || 'moore';
    }

    // =========================================
    // CALLBACKS DEL CORE
    // =========================================

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

    // =========================================
    // WORKERS
    // =========================================

    async _init() {
        await this._initRule();

        // Inicializar actividad para celdas vivas iniciales
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.core.getCell(x, y)) {
                    this.activityAges[x * this.gridSize + y] = 0;
                }
            }
        }

        this._forceFullRender();
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
    // GENERACIÓN (COORDINA CORE, WORKER O ESPECIAL)
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

        if (this.undoManager) {
            try {
                this.undoManager.clear();
            } catch (e) {
            }
            this.undoManager = null;
        }

        if (this.core) {
            this.core.destroy();
            this.core = null;
        }

        // Limpiar motores especiales
        if (this.wolframEngine) {
            this.wolframEngine.deactivate?.();
            this.wolframEngine = null;
        }
        if (this.rd2dEngine) {
            this.rd2dEngine.deactivate?.();
            this.rd2dEngine = null;
        }

        // Liberar buffers
        this.renderFlags = null;
        this.prevFlags = null;
        this.activityAges = null;

        if (this.dirtyCells) {
            this.dirtyCells.clear();
            this.dirtyCells = null;
        }

        if (this.populationHistory) {
            this.populationHistory.clear();
            this.populationHistory = null;
        }

        this.ctx = null;
        this.canvas = null;
        this._isDestroyed = true;

        eventBus.emit('automaton:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        return () => target.removeEventListener(event, handler, options);
    }

    _handleCoreGeneration(stats) {
        this.generation = stats.generation;
        this._lastPopulation = stats.population;
        this.populationHistory.push(stats.population);

        eventBus.emit('stats:updated', stats);
    }

    // =========================================
    // ACTIVIDAD (EFECTO VISUAL)
    // =========================================

    _handleCoreCellChange(cells) {
        // Marcar celdas cambiadas como dirty para renderizado
        for (const cell of cells) {
            this.dirtyCells.add(cell.x * this.gridSize + cell.y);
        }
    }

    // =========================================
    // RENDERIZADO
    // =========================================

    _handleCoreStateChange(event) {
        switch (event.type) {
            case 'clear':
                this.activityAges.fill(0);
                this._markAllDirty();
                break;

            case 'resize':
                this.gridSize = event.size;
                this.renderFlags = new Uint8Array(event.size * event.size);
                this.prevFlags = new Uint8Array(event.size * event.size);
                this.activityAges = new Uint8Array(event.size * event.size);
                break;

            case 'ruleChange':
                this.generation = 0;
                this.isLimitReached = false;
                this._markAllDirty();
                eventBus.emit('automaton:ruleChanged', this.core.ruleEngine);
                break;

            case 'neighborhoodChange':
                this.generation = 0;
                this.isLimitReached = false;
                this._markAllDirty();
                eventBus.emit('automaton:neighborhoodChanged', event.info);
                break;

            case 'randomize':
                this._markAllDirty();
                eventBus.emit('automaton:randomized', event);
                break;

            case 'deserialize':
                this._markAllDirty();
                this.updateStats();
                break;
        }
    }

    _initWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isWorkerProcessing = false;
        }

        if (this.gridSize >= this.workerThreshold && window.Worker) {
            try {
                this.worker = new Worker('scripts/workers/automaton-worker.js');

                const handlerId = `worker_handler_${Date.now()}`;
                this._currentHandlerId = handlerId;

                this.worker.onmessage = (e) => {
                    console.log('Recibido de worker:', {
                        gridLength: e.data.newGrid?.length,
                        changedCellsCount: e.data.changedCells?.length,
                        population: e.data.population,
                        generation: e.data.generation
                    });

                    if (this._currentHandlerId !== handlerId) return;

                    const {newGrid, changedCells, population, generation, error} = e.data;

                    if (error) {
                        console.error('Error en worker:', error);
                        this.isWorkerProcessing = false;
                        this._cleanupWorker();
                        return;
                    }

                    if (!this.worker || this._currentHandlerId !== handlerId) return;

                    // Verificar formato del grid recibido
                    if (!newGrid || !Array.isArray(newGrid)) {
                        console.error('Grid inválido desde worker:', newGrid);
                        this.isWorkerProcessing = false;
                        return;
                    }

                    // Actualizar grid del core
                    const size = this.gridSize;
                    for (let x = 0; x < size && x < newGrid.length; x++) {
                        const col = newGrid[x];
                        if (col instanceof Uint8Array && col.length === size) {
                            this.core.gridManager.grid[x].set(col);
                        } else if (Array.isArray(col) || ArrayBuffer.isView(col)) {
                            // Convertir array a Uint8Array si es necesario
                            for (let y = 0; y < size && y < col.length; y++) {
                                this.core.gridManager.grid[x][y] = col[y] ? 1 : 0;
                            }
                        }
                    }

                    this.generation = generation;
                    this._lastPopulation = population;

                    // Marcar celdas modificadas como dirty
                    this.dirtyCells.clear();
                    if (Array.isArray(changedCells)) {
                        changedCells.forEach(index => {
                            if (index >= 0 && index < size * size) {
                                this.dirtyCells.add(index);
                            }
                        });
                    } else {
                        // Si no hay changedCells, marcar todo como dirty
                        this._markAllDirty();
                    }

                    this.updateStats();
                    this.checkLimits();
                    this._updateActivityAges(changedCells || []);
                    this.render();

                    this.isWorkerProcessing = false;
                };

                this.worker.onerror = (error) => {
                    if (this._currentHandlerId !== handlerId) return;
                    console.error('Worker error:', error);
                    this.isWorkerProcessing = false;
                    this._cleanupWorker();
                    // Fallback a main thread
                    this._markAllDirty();
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

    nextGeneration() {
        if (this.checkLimits()) return 0;

        // === MODO ESPECIAL: RD-2D ===
        if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive) {
            const continued = this.rd2dEngine.step();
            if (!continued) {
                this.stop();
                console.debug('RD-2D: Simulación detenida (estable)');
            }
            this.generation = this.rd2dEngine.generation;
            this.updateStats();
            this.render();
            return 1;
        }

        // === MODO ESPECIAL: WOLFRAM ===
        if (this.specialMode === 'wolfram' && this.wolframEngine?.isActive) {
            const continued = this.wolframEngine.step();
            if (!continued) {
                this.stop();
                console.debug('Wolfram: Límite alcanzado');
            }
            this.generation = this.wolframEngine.generation;
            this.updateStats();
            this.render();
            return 1;
        }

        // === MODO 2D ESTÁNDAR ===
        this.prevFlags = new Uint8Array(this.renderFlags);
        this.dirtyCells.clear();

        // Decidir: Worker o Core
        if (this.worker && this.gridSize >= this.workerThreshold) {
            return this._nextGenerationWorker();
        } else {
            return this._nextGenerationCore();
        }
    }

    _nextGenerationCore() {
        // Usar el core para calcular
        const stats = this.core.step();

        // Sincronizar estado de actividad
        const changedIndices = [];
        // Necesitamos reconstruir los índices desde las coordenadas
        // Esto es una limitación: el core no expone índices flat
        // Por ahora, marcamos todo como dirty si hay muchos cambios
        if (stats.births + stats.deaths > this.gridSize * this.gridSize * 0.1) {
            this._markAllDirty();
        } else {
            // No tenemos acceso a las coordenadas específicas desde stats
            // Esto se podría mejorar haciendo que el core devuelva changedCells
            this._markAllDirty(); // Conservador por ahora
        }

        this.checkLimits();
        this._updateActivityAges([]); // Recalcular todo

        return stats.births + stats.deaths;
    }

    _nextGenerationWorker() {
        if (this.isWorkerProcessing) {
            // No loguear cada vez para no saturar la consola
            return 0;
        }

        this.isWorkerProcessing = true;

        const size = this.gridSize;
        const flatGrid = new Uint8Array(size * size);

        // Flatten column-major desde el grid del core
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

        console.log('Enviando a worker:', {
            size,
            population: this.core.gridManager.countPopulation(),
            generation: this.generation
        });

        try {
            this.worker.postMessage(messageData, [flatGrid.buffer]);
        } catch (e) {
            // Si Transferable Objects no funcionan, enviar sin transferir
            this.worker.postMessage(messageData);
        }

        return 0;
    }

    _updateActivityAges(changedCells) {
        const size = this.gridSize;
        const cooldown = this.activityCooldown;
        const changedSet = new Set(changedCells);

        for (let index = 0; index < size * size; index++) {
            const x = Math.floor(index / size);
            const y = index % size;

            if (x >= size || y >= size) continue;

            if (this.core.getCell(x, y)) {
                if (changedSet.has(index)) {
                    this.activityAges[index] = 0;
                } else if (this.activityAges[index] < cooldown) {
                    this.activityAges[index]++;
                    if (this.activityAges[index] === cooldown) {
                        this.dirtyCells.add(index);
                    }
                }
            } else {
                this.activityAges[index] = 0;
            }
        }
    }

    render() {
        if (!this.ctx || !this.canvas || this._isDestroyed) return;
        if (this.dirtyCells.size === 0 && this.generation > 0) return;

        const fullRenderNeeded = this.dirtyCells.size > (this.gridSize * this.gridSize * 0.1);

        if (fullRenderNeeded || this.generation === 0) {
            this._forceFullRender();
        } else {
            this._renderDirtyCells();
        }

        this.dirtyCells.clear();
    }

    // =========================================
    // MÉTODOS PÚBLICOS (DELEGAN AL CORE DONDE SEA POSIBLE)
    // =========================================

    _forceFullRender() {
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.showGrid && this.cellSize > 2) {
            this._drawGrid();
        }

        this._drawCells((x, y) => this.core.getCell(x, y));

        if (this.showGrid && this.cellSize <= 2) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            for (let x = 0; x < this.gridSize; x++) {
                for (let y = 0; y < this.gridSize; y++) {
                    if (!this.core.getCell(x, y) && this.cellSize === 2) {
                        const xPos = x * 2;
                        const yPos = y * 2;
                        this.ctx.fillRect(xPos + 1, yPos, 1, 2);
                        this.ctx.fillRect(xPos, yPos + 1, 2, 1);
                    }
                }
            }
        }
    }

    _renderDirtyCells() {
        for (const index of this.dirtyCells) {
            const x = Math.floor(index / this.gridSize);
            const y = index % this.gridSize;
            this._renderCell(x, y);
        }
    }

    _renderCell(x, y) {
        const cellSize = this.cellSize;
        const cellIndex = x * this.gridSize + y;
        const isAlive = this.core.getCell(x, y);

        // MODO RD-2D: Renderizado especial
        if (this.specialMode === 'rd2d' && this.rd2dEngine?.isActive && isAlive) {
            const state = this.rd2dEngine.stateGrid[x]?.[y] || 0;
            this.ctx.fillStyle = '#0f172a';
            this.ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
            this.rd2dEngine._renderRD2DCell(this.ctx, x, y, cellSize, state);
            this.renderFlags[cellIndex] = 1;
            return;
        }

        if (cellSize <= 2) {
            const xPos = x * cellSize;
            const yPos = y * cellSize;

            if (isAlive) {
                const isRecentlyActive = this.activityAges[cellIndex] < this.activityCooldown;
                this.ctx.fillStyle = (isRecentlyActive && this.showActivityEffect) ? '#b9b610' : '#059669';
                this.ctx.fillRect(xPos, yPos, cellSize, cellSize);
            } else {
                this.ctx.fillStyle = '#0f172a';
                this.ctx.fillRect(xPos, yPos, cellSize, cellSize);

                if (this.showGrid && cellSize === 2) {
                    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                    this.ctx.fillRect(xPos + 1, yPos, 1, cellSize);
                    this.ctx.fillRect(xPos, yPos + 1, cellSize, 1);
                }
            }
            this.renderFlags[cellIndex] = isAlive ? 1 : 0;
        } else {
            const innerSize = cellSize - 2;
            this.ctx.clearRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            this.renderFlags[cellIndex] = isAlive ? 1 : 0;
            if (isAlive) {
                this._drawSingleCell(x, y);
            }
        }
    }

    _drawSingleCell(x, y) {
        const cellSize = this.cellSize;
        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;
        const cellIndex = x * this.gridSize + y;
        const isRecentlyActive = this.activityAges[cellIndex] < this.activityCooldown;
        const drawSize = Math.max(1, cellSize - (cellSize > 2 ? 2 : 1));
        const offset = cellSize > 2 ? 1 : 0;

        if (cellSize >= 4) {
            const gradient = this.ctx.createRadialGradient(
                centerX, centerY, 0,
                centerX, centerY, cellSize / 2
            );

            if (isRecentlyActive && this.showActivityEffect) {
                gradient.addColorStop(0, '#b9b610');
                gradient.addColorStop(0.7, '#059669');
                gradient.addColorStop(1, 'rgba(5, 150, 105, 0.8)');
            } else {
                gradient.addColorStop(0, '#059669');
                gradient.addColorStop(1, '#059669');
            }

            this.ctx.fillStyle = gradient;
        } else {
            this.ctx.fillStyle = (isRecentlyActive && this.showActivityEffect) ? '#b9b610' : '#059669';
        }

        this.ctx.fillRect(x * cellSize + offset, y * cellSize + offset, drawSize, drawSize);

        if (isRecentlyActive && this.showActivityEffect && cellSize >= 4) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 2);
        }
    }

    _drawGrid() {
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.lineWidth = 1;
        for (let i = 0; i <= this.gridSize; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * this.cellSize, 0);
            this.ctx.lineTo(i * this.cellSize, this.canvas.height);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(0, i * this.cellSize);
            this.ctx.lineTo(this.canvas.width, i * this.cellSize);
            this.ctx.stroke();
        }
    }

    _drawCells(predicate) {
        const cellSize = this.cellSize;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (predicate(x, y)) {
                    const cellIndex = x * this.gridSize + y;
                    const isRecentlyActive = this.activityAges[cellIndex] < this.activityCooldown;

                    if (isRecentlyActive && this.showActivityEffect) {
                        this.ctx.fillStyle = '#b9b610';
                    } else {
                        this.ctx.fillStyle = '#059669';
                    }

                    if (cellSize <= 2) {
                        this.ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                    } else {
                        this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
                    }
                }
            }
        }
    }

    _markAllDirty() {
        this.dirtyCells.clear();
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                this.dirtyCells.add(x * this.gridSize + y);
            }
        }
    }

    setCell(x, y, state, markDirty = true) {
        // Guardar para undo antes de modificar
        if (markDirty && this.undoManager?.isTracking) {
            this.undoManager.saveState(this.core.gridManager.grid, this.generation);
        }

        const changed = this.core.setCell(x, y, state);

        if (changed) {
            if (state) this.activityAges[x * this.gridSize + y] = 0;

            if (markDirty) {
                this.dirtyCells.add(x * this.gridSize + y);
            }

            // Sincronizar con RD2D si está activo
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
        // Detener si está corriendo
        if (this.isRunning) {
            this.stop();
            this.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        this.core.setRule({birth, survival});
        // Evento ya emitido por el core
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

        // El core.resize() disparará onStateChange con type: 'resize'
        // que actualizará this.gridSize y los buffers
        this.core.resize(size);

        // Actualizar referencia local (ya debería estar actualizada por el callback,
        // pero nos aseguramos por si el callback no se ejecutó sincrónicamente)
        this.gridSize = this.core.gridManager.size;

        // Canvas y renderizado (esto no está en el core)
        this.resizeCanvas();
        this.updateStats();
        this._markAllDirty();
        this.render();

        // Re-inicializar worker si es necesario
        if (size >= this.workerThreshold) {
            this._initWorker();
        }

        eventBus.emit('automaton:resized', {size});
    }

    // =========================================
    // EDICIÓN DE ÁREAS
    // =========================================

    setCellSize(size) {
        const newSize = Math.min(Math.max(size, 1), 20);
        this.cellSize = newSize;
        this.resizeCanvas();
        this._markAllDirty();
        this.render();
        eventBus.emit('automaton:zoomChanged', {zoom: newSize});
    }

    setNeighborhoodType(type) {
        this.core.setNeighborhood({type});
        // Evento ya emitido por el core
    }

    setNeighborhoodRadius(radius) {
        this.core.setNeighborhood({radius});
        // Evento ya emitido por el core
    }

    resizeCanvas() {
        if (!this.canvas) return;

        this.canvas.width = this.gridSize * this.cellSize;
        this.canvas.height = this.gridSize * this.cellSize;
        this.canvas.style.width = this.canvas.width + 'px';
        this.canvas.style.height = this.canvas.height + 'px';

        const container = document.getElementById('canvas-container');
        if (container) {
            container.style.width = (this.canvas.width + 20) + 'px';
            container.style.height = (this.canvas.height + 20) + 'px';
        }
    }

    updateStats(populationOverride = null) {
        const population = populationOverride !== null
            ? populationOverride
            : this.core.gridManager.countPopulation();

        const density = (population / (this.gridSize * this.gridSize) * 100).toFixed(1);
        this.populationHistory.push(population);

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
            this.isLimitReached = this._lastPopulation >= this.maxPopulation;
        }

        if (this.isLimitReached && this.isRunning) {
            this.stop();
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
    // CONTROL DE EJECUCIÓN
    // =========================================

    copyArea(minX, minY, maxX, maxY) {
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const grid = Array.from({length: width}, () => Array(height).fill(false));

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
                    grid[x - minX][y - minY] = this.core.getCell(x, y);
                }
            }
        }

        return {grid, width, height};
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

        this.undoManager.saveState(this.core.gridManager.grid, this.generation);
        this.undoManager.stopTracking();

        const startX = Math.max(0, minX);
        const endX = Math.min(maxX, this.gridSize - 1);
        const startY = Math.max(0, minY);
        const endY = Math.min(maxY, this.gridSize - 1);

        let changed = false;
        const dirtyIndices = [];
        const size = this.gridSize;

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                if (this.core.getCell(x, y)) {
                    this.core.gridManager.grid[x][y] = 0;
                    dirtyIndices.push(x * size + y);
                    changed = true;
                }
            }
        }

        if (changed) {
            dirtyIndices.forEach(idx => this.dirtyCells.add(idx));
            this.prevFlags = new Uint8Array(this.renderFlags);
            this.updateStats();
            this.render();
        }

        this.undoManager.startTracking();

        if (wasRunning) {
            requestAnimationFrame(() => {
                this.isRunning = true;
                this.start();
            });
        }
    }

    async pasteArea(area, offsetX, offsetY) {
        if (!area?.grid) return;

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

        this.undoManager.saveState(this.core.gridManager.grid, this.generation);
        this.undoManager.stopTracking();

        const width = area.width;
        const height = area.height;
        let changed = false;
        const dirtyIndices = [];
        const size = this.gridSize;

        for (let x = 0; x < width; x++) {
            const gridX = offsetX + x;
            if (gridX < 0 || gridX >= size) continue;

            for (let y = 0; y < height; y++) {
                const gridY = offsetY + y;
                if (gridY < 0 || gridY >= size) continue;

                const newState = area.grid[x][y] ? 1 : 0;
                if (this.core.gridManager.grid[gridX][gridY] !== newState) {
                    this.core.gridManager.grid[gridX][gridY] = newState;
                    dirtyIndices.push(gridX * size + gridY);

                    if (newState) {
                        this.activityAges[gridX * size + gridY] = 0;
                    }
                    changed = true;
                }
            }
        }

        if (changed) {
            dirtyIndices.forEach(idx => this.dirtyCells.add(idx));
            this.prevFlags = new Uint8Array(this.renderFlags);
            this.updateStats();
            this._forceFullRender();

            if (this.gridSize >= this.workerThreshold) {
                this._initWorker();
            }
        }

        this.undoManager.startTracking();

        if (wasRunning) {
            requestAnimationFrame(() => {
                this.isRunning = true;
                this.start();
            });
        }
    }

    undo() {
        const result = this.undoManager.undo(this.core.gridManager.grid, this.generation);
        if (result) {
            this.core.gridManager.grid = result.grid;
            this.generation = result.generation;
            this._markAllDirty();
            this.updateStats();
            this.render();
            eventBus.emit('automaton:undo', {generation: this.generation});
            return true;
        }
        return false;
    }

    redo() {
        const result = this.undoManager.redo(this.core.gridManager.grid, this.generation);
        if (result) {
            this.core.gridManager.grid = result.grid;
            this.generation = result.generation;
            this._markAllDirty();
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

        this.undoManager.saveState(this.core.gridManager.grid, this.generation);
        this.undoManager.stopTracking();

        if (pattern?.pattern === 'random') {
            this.randomize(0.35);
            if (wasRunning) {
                requestAnimationFrame(() => {
                    this.isRunning = true;
                    this.start();
                });
            }
            return;
        }

        if (pattern?.pattern) {
            const patternData = pattern.pattern;
            const offsetX = Math.floor(patternData[0].length / 2);
            const offsetY = Math.floor(patternData.length / 2);

            let changed = false;
            const dirtyIndices = [];
            const size = this.gridSize;

            for (let row = 0; row < patternData.length; row++) {
                for (let col = 0; col < patternData[row].length; col++) {
                    if (patternData[row][col] === 1) {
                        const gridX = centerX - offsetX + col;
                        const gridY = centerY - offsetY + row;

                        if (gridX >= 0 && gridX < size && gridY >= 0 && gridY < size) {
                            if (!this.core.gridManager.grid[gridX][gridY]) {
                                this.core.gridManager.grid[gridX][gridY] = 1;
                                this.activityAges[gridX * size + gridY] = 0;
                                dirtyIndices.push(gridX * size + gridY);
                                changed = true;
                            }
                        }
                    }
                }
            }

            if (changed) {
                dirtyIndices.forEach(idx => this.dirtyCells.add(idx));
                this.prevFlags = new Uint8Array(this.renderFlags);
                this.updateStats();
                this._forceFullRender();

                if (this.gridSize >= this.workerThreshold) {
                    this._initWorker();
                }
            }
        }

        this.undoManager.startTracking();

        if (wasRunning) {
            requestAnimationFrame(() => {
                this.isRunning = true;
                this.start();
            });
        }
    }

    exportPattern() {
        let minX = this.gridSize, minY = this.gridSize;
        let maxX = 0, maxY = 0;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.core.getCell(x, y)) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        }

        if (minX > maxX || minY > maxY) return null;

        const pattern = [];
        for (let y = minY; y <= maxY; y++) {
            const row = [];
            for (let x = minX; x <= maxX; x++) {
                row.push(this.core.getCell(x, y) ? 1 : 0);
            }
            pattern.push(row);
        }

        return {
            pattern,
            name: `${t('patterns.export.name')} ${new Date().toLocaleDateString()}`,
            description: t('patterns.export.description')
        };
    }

    randomize(density = 0.35) {
        const wasRunning = this.isRunning;
        this.stop();

        this._cleanupWorker();

        if (this.undoManager?.isTracking) {
            this.undoManager.saveState(this.core.gridManager.grid, this.generation);
            this.undoManager.stopTracking();
        }

        try {
            // Usar el core para randomizar
            const stats = this.core.randomize(density);

            // Sincronizar estado visual
            if (this.activityAges.length !== this.gridSize * this.gridSize) {
                this.activityAges = new Uint8Array(this.gridSize * this.gridSize);
            } else {
                this.activityAges.fill(0);
            }

            this._lastPopulation = stats.population;
            this.generation = 0;
            this.isLimitReached = false;
            this.populationHistory.clear();

            // Resetear motores especiales
            this.wolframEngine?.reset();
            this.rd2dEngine?.reset();

            this.renderFlags.fill(0);
            this.prevFlags.fill(0);
            this.dirtyCells.clear();

            this._forceFullRender();
            this.updateStats(stats.population);

            eventBus.emit('automaton:randomized', {
                density: stats.density,
                population: stats.population,
                gridSize: this.gridSize
            });

        } catch (error) {
            console.error('Error en randomize:', error);
            eventBus.emit('automaton:error', {
                operation: 'randomize',
                error: error.message
            });
        } finally {
            if (this.undoManager) {
                this.undoManager.startTracking();
            }

            if (this.gridSize >= this.workerThreshold) {
                this._initWorker();
            }

            if (wasRunning) {
                setTimeout(() => this.start(), 0);
            }
        }
    }

    clear() {
        if (this.isRunning) {
            this.stop();
            this.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        this.wolframEngine?.reset();
        this.rd2dEngine?.reset();

        if (this.isWorkerProcessing) {
            this._cleanupWorker();
        }

        this.undoManager.saveState(this.core.gridManager.grid, this.generation);
        const wasTracking = this.undoManager.isTracking;
        this.undoManager.stopTracking();

        // Delegar al core
        this.core.clear();

        if (wasTracking) {
            this.undoManager.startTracking();
        }

        this.activityAges.fill(0);
        this.generation = 0;
        this.isLimitReached = false;
        this.populationHistory.clear();
        this.dirtyCells.clear();

        this._markAllDirty();
        this._forceFullRender();
        this.updateStats();
    }

    // =========================================
    // MOTORES ESPECIALES
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

        // Resetear edades de actividad
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.core.getCell(x, y)) {
                    this.activityAges[x * this.gridSize + y] = 0;
                }
            }
        }
        this._markAllDirty();

        this._lastFrameTime = performance.now();
        this._animateRAF();
    }

    // =========================================
    // PROPIEDADES DELEGADAS
    // =========================================

    stop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    _animateRAF(currentTime = 0) {
        if (!this.isRunning) return;

        if (this.generation === 0 && this._lastFrameTime === currentTime) {
            for (let x = 0; x < this.gridSize; x++) {
                for (let y = 0; y < this.gridSize; y++) {
                    if (this.core.getCell(x, y)) {
                        this.activityAges[x * this.gridSize + y] = 0;
                    }
                }
            }
            this._markAllDirty();
        }

        const deltaTime = currentTime - this._lastFrameTime;

        if (deltaTime >= this.updateInterval) {
            this._lastFrameTime = currentTime - (deltaTime % this.updateInterval);

            this.nextGeneration();

            eventBus.emit('automaton:generation', {
                generation: this.generation,
                population: this.core.gridManager.countPopulation(),
                density: this.core.gridManager.getStats().density
            });

            this.render();
        }

        this.rafId = requestAnimationFrame((time) => this._animateRAF(time));
    }

    setSpeed(level) {
        const minSpeed = 500;
        const maxSpeed = 30;
        this.updateInterval = minSpeed - ((level - 1) * (minSpeed - maxSpeed) / 9);

        if (this.isRunning) {
            this.stop();
            this.start();
        }

        eventBus.emit('automaton:speedChanged', {speed: this.updateInterval});
        return this.updateInterval;
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this._markAllDirty();
        this.render();
        eventBus.emit('automaton:gridToggled', {showGrid: this.showGrid});
        return this.showGrid;
    }

    setShowActivityEffect(enabled) {
        this.showActivityEffect = enabled;
        eventBus.emit('automaton:showActivityEffectChanged', {enabled});
        return this.showActivityEffect;
    }

    async _initSpecialEngine(engineName) {
        if (this.specialMode === engineName && this._specialEngineLoaded) {
            return Promise.resolve();
        }

        if (this.wolframEngine?.isActive) {
            this.wolframEngine.deactivate();
        }
        if (this.rd2dEngine?.isActive) {
            this.rd2dEngine.deactivate();
        }

        if (engineName === 'rd2d') {
            if (typeof RD2DEngine === 'undefined') {
                await this._loadScript('scripts/core/rd2d-engine.js');
            }
            this.rd2dEngine = new RD2DEngine(this);
            this.specialMode = 'rd2d';
        } else if (engineName === 'wolfram') {
            if (typeof WolframEngine === 'undefined') {
                await this._loadScript('scripts/core/wolfram-engine.js');
            }
            this.wolframEngine = new WolframEngine(this);
            this.specialMode = 'wolfram';
        }

        this._specialEngineLoaded = true;
        return Promise.resolve();
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

// Exportar global
window.CellularAutomaton = CellularAutomaton;