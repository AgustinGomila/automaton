class CellularAutomaton {
    constructor(gridSize = 200, cellSize = 4) {
        // Configuración con validación estricta
        this.gridSize = Math.min(Math.max(gridSize, 20), 200);
        this.cellSize = Math.min(Math.max(cellSize, 4), 20);

        // Estado interno
        this.grid = this.createEmptyGrid();
        this.dirtyFlags = new Uint8Array(this.gridSize * this.gridSize);  // 0=desconocido, 1=viva
        this.generation = 0;
        this.isRunning = false;
        this.updateInterval = 100;
        this.showGrid = true;
        this.showActivityEffect = true;

        this._changedSet = new Set();
        this._pendingTimeouts = new Set();

        // Sistema de dirty rendering
        this.renderFlags = new Uint8Array(this.gridSize * this.gridSize);  // Estado actual renderizado
        this.prevFlags = new Uint8Array(this.gridSize * this.gridSize);    // Estado de la generación anterior
        this.activityAges = new Uint8Array(this.gridSize * this.gridSize); // 0 = recién cambiada
        this.activityCooldown = 3; // Generaciones para pasar a verde plano
        this.dirtyCells = new Set();

        // Canvas
        this.canvas = document.getElementById('canvas');
        if (!this.canvas) {
            throw new Error('Canvas element no encontrado');
        }
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Estadísticas
        const maxHistoryLength = 100;
        this._lastPopulation = 0;
        this.populationHistory = new CircularArray(maxHistoryLength);

        // UndoManager
        this.undoManager = new UndoManager(50);
        this.undoManager.startTracking();

        // Vecindad
        this.neighborhoodType = 'moore';
        this.neighborhoodRadius = 1;
        this._neighborOffsets = this._precomputeNeighborOffsets();

        // Animación
        this.rafId = null;
        this._lastFrameTime = 0

        // Límites
        this.maxGenerations = null;
        this.maxPopulation = null;
        this.limitType = 'none'; // 'none', 'generations', 'population', 'wrap'
        this.limitValue = 1000;
        this.isLimitReached = false;
        this.wrapEdges = true; // true = toroidal, false = paredes duras

        // Bind y event listeners
        this._boundAnimate = this._animate.bind(this);
        this._boundHandleResize = this._handleResize.bind(this);
        this._cleanupResize = this._addEventListener(window, 'resize', this._boundHandleResize);

        // Worker
        this.worker = null;
        this.workerThreshold = 100; // Usar worker si gridSize >= 100
        this.isWorkerProcessing = false;
        this._initWorker();

        // Inicializar
        this._initRule().then(() => {
            // Inicializar actividad para celdas vivas iniciales
            for (let x = 0; x < this.gridSize; x++) {
                for (let y = 0; y < this.gridSize; y++) {
                    if (this.grid[x][y]) {
                        this.activityAges[x * this.gridSize + y] = 0;
                    }
                }
            }
            this._forceFullRender();
            eventBus.emit('automaton:ready', this);
        }).catch(err => {
            console.error('Error inicializando autómata:', err);
            eventBus.emit('automaton:error', err);
        });
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    destroy() {
        // Prevenir doble ejecución o ejecución en estado inválido
        if (this._isDestroyed) return;

        this.stop();

        // Cleanup resize con verificación
        if (this._cleanupResize) {
            try {
                this._cleanupResize();
            } catch (e) {
            }
            this._cleanupResize = null;
        }

        // Limpiar worker de forma segura
        this._cleanupWorker();

        // UndoManager con verificación
        if (this.undoManager) {
            try {
                this.undoManager.clear();
            } catch (e) {
            }
            this.undoManager = null;
        }

        // Liberar buffers principales
        this.grid = null;
        this.renderFlags = null;
        this.prevFlags = null;

        // Limpiar Sets/Arrays con verificación de existencia
        if (this.dirtyCells) {
            this.dirtyCells.clear();
            this.dirtyCells = null;
        }

        if (this.populationHistory) {
            this.populationHistory.clear();
            this.populationHistory = null;
        }

        // Limpiar timeouts pendientes
        if (this._pendingTimeouts) {
            this._pendingTimeouts.forEach(id => clearTimeout(id));
            this._pendingTimeouts.clear();
            this._pendingTimeouts = null;
        }

        // Limpiar Set reutilizable (verificar primero)
        if (this._changedSet) {
            this._changedSet.clear();
            this._changedSet = null;
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

    // =========================================
    // WORKER CON HANDLER ÚNICO Y REUTILIZABLE
    // =========================================
    _initWorker() {
        // Limpieza previa si existe
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.isWorkerProcessing = false;
        }

        if (this.gridSize >= this.workerThreshold && window.Worker) {
            try {
                // Crear worker
                this.worker = new Worker('scripts/workers/automaton-worker.js');

                // Handler con ID único para tracking
                const handlerId = `worker_handler_${Date.now()}`;
                this._currentHandlerId = handlerId;

                this.worker.onmessage = (e) => {
                    // Ignorar mensajes de workers antiguos
                    if (this._currentHandlerId !== handlerId) {
                        console.warn('⚠️ Worker message ignorado (handler obsoleto)');
                        return;
                    }

                    const {newGrid, changedCells, population, density, generation} = e.data;

                    // Validar worker aún activo
                    if (!this.worker || this._currentHandlerId !== handlerId) return;

                    this.grid = newGrid;
                    this.generation = generation;
                    this._lastPopulation = population;

                    // Marcar celdas modificadas
                    this.dirtyCells.clear();
                    changedCells.forEach(index => this.dirtyCells.add(index));

                    // Actualizar estadísticas y límites
                    this.updateStats();
                    this.checkLimits();

                    // Actualizar edades de actividad antes de renderizar
                    this._updateActivityAges(changedCells); // Pasar changedCells del worker

                    // Renderizar
                    this.render();

                    this.isWorkerProcessing = false;
                    console.debug(`🔄 Worker: G${generation} P${population} D${density}%`);
                };

                this.worker.onerror = (error) => {
                    // Solo maneja error si es del worker actual
                    if (this._currentHandlerId !== handlerId) return;

                    console.error('❌ Worker error:', error);
                    this.isWorkerProcessing = false;

                    // Fallback inmediato a main thread
                    this._cleanupWorker();
                    this._markAllDirty();
                    this.render();
                };

                console.debug(`✅ Worker creado para grid ${this.gridSize}x${this.gridSize}`);
            } catch (error) {
                console.warn('❌ No se pudo crear worker, usando main thread:', error);
                this._cleanupWorker();
            }
        }
    }

    _cleanupWorker() {
        if (this.worker) {
            // Marcar handler obsoleto
            this._currentHandlerId = null;

            // Terminar worker
            this.worker.terminate();
            this.worker = null;
            this.isWorkerProcessing = false;

            console.debug('🧹 Worker limpiado completamente');
        }
    }

    _nextGenerationMainThread() {
        const newGrid = this.createEmptyGrid();
        let changes = 0;
        const changedCells = []; // Array para trackear cambios

        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const neighbors = this._countNeighbors(x, y);

                // Forzar a número explícito (0 o 1)
                const currentState = this.grid[y][x] ? 1 : 0;

                const survives = this.rule.survival.includes(neighbors);
                const born = this.rule.birth.includes(neighbors);
                const nextState = currentState === 1
                    ? (survives ? 1 : 0)
                    : (born ? 1 : 0);

                newGrid[y][x] = nextState;

                // Comparar números puros
                if (nextState !== currentState) {
                    changes++;
                    const index = y * this.gridSize + x;
                    this.dirtyCells.add(index);
                    changedCells.push(index);
                }
            }
        }

        // DEBUG TEMPORAL
        if (this.generation % 10 === 0) {
            const totalAlive = this.grid.flat().filter(c => c).length;
            console.log(`Gen ${this.generation}: ${changedCells.length} cambios de ${totalAlive} vivas`);
        }

        this.grid = newGrid;
        this.generation++;
        this._lastPopulation = this.countPopulation();
        this.updateStats();
        this.checkLimits();
        this._updateActivityAges(changedCells);

        return changes;
    }

    _nextGenerationWorker() {
        if (this.isWorkerProcessing) {
            console.warn('Worker ocupado, saltando frame');
            return;
        }

        this.isWorkerProcessing = true;

        const totalCells = this.gridSize * this.gridSize;
        const flatGrid = new Uint8Array(totalCells);

        // Column-major: each this.grid[x] is a column at offset x * gridSize
        for (let x = 0; x < this.gridSize; x++) {
            flatGrid.set(this.grid[x], x * this.gridSize);
        }

        // Preparar datos para worker
        const messageData = {
            grid: flatGrid,
            gridSize: this.gridSize,
            rule: this.rule,
            wrapEdges: this.wrapEdges,
            neighborhoodType: this.neighborhoodType,
            neighborhoodRadius: this.neighborhoodRadius,
            neighborOffsets: this._neighborOffsets,
            generation: this.generation
        };

        // Enviar al worker (sin transferibles por simplicidad)
        this.worker.postMessage(messageData);
    }

    // =========================================
    // VECINDAD
    // =========================================

    _precomputeNeighborOffsets() {
        const offsets = [];
        const radius = this.neighborhoodRadius;

        for (let i = -radius; i <= radius; i++) {
            for (let j = -radius; j <= radius; j++) {
                if (i === 0 && j === 0) continue;
                if (this.neighborhoodType === 'neumann' && Math.abs(i) + Math.abs(j) > radius) continue;
                offsets.push({dx: i, dy: j});
            }
        }
        return offsets;
    }

    _countNeighbors(x, y) {
        let count = 0;
        const size = this.gridSize;

        for (const {dx, dy} of this._neighborOffsets) {
            if (this.wrapEdges) {
                // === MODO TOROIDAL ===
                const nx = (x + dx + size) % size;
                const ny = (y + dy + size) % size;
                if (this.grid[nx][ny]) count++;
            } else {
                // === MODO PAREDES DURAS ===
                const nx = x + dx;
                const ny = y + dy;

                // Solo contar si está dentro de los límites
                if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                    if (this.grid[nx][ny]) count++;
                }
            }
        }

        return count;
    }

    // =========================================
    // SISTEMA DE DIRTY RENDERING
    // =========================================

    createEmptyGrid() {
        return Array.from({length: this.gridSize}, () =>
            new Uint8Array(this.gridSize)
        );
    }

    setCell(x, y, state, markDirty = true) {
        if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return false;

        if (this.grid[x][y] !== state) {
            // Guardar estado antes de modificar
            this.undoManager.saveState(this.grid, this.generation);

            // Marcar siempre que cambie, sin condiciones
            this.grid[x][y] = state;

            // Resetear edad de actividad para celdas manualmente editadas
            if (state) this.activityAges[y * this.gridSize + x] = 0;

            const index = x * this.gridSize + y;
            if (markDirty) this.dirtyCells.add(index);
            return true;
        }
        return false;
    }

    _markAllDirty() {
        this.dirtyCells.clear();
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                this.dirtyCells.add(x * this.gridSize + y);
            }
        }
    }

    _updateActivityAges(changedCells) {
        const size = this.gridSize;
        const cooldown = this.activityCooldown;

        // Si hay demasiados cambios (más del 50% del grid), algo está mal
        if (changedCells.length > (size * size * 0.5)) {
            console.warn('Detectado posible error: más del 50% de celdas marcadas como cambiadas');
        }

        const changedSet = new Set(changedCells);

        // Verificar una celda específica (ej: centro)
        const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
        const wasReset = changedSet.has(centerIdx);

        for (let index = 0; index < size * size; index++) {
            const y = Math.floor(index / size);
            const x = index % size;

            if (this.grid[y][x]) {
                // Si cambió este turno, resetear edad
                if (changedSet.has(index)) {
                    this.activityAges[index] = 0;
                    // Ya está en dirtyCells por el cambio de estado
                } else if (this.activityAges[index] < cooldown) {
                    // Envejecer celda viva
                    this.activityAges[index]++;
                    // Si JUSTO alcanzó el cooldown, marcar para redibujar cambio de color
                    if (this.activityAges[index] === cooldown) {
                        this.dirtyCells.add(index);
                    }
                }
            } else {
                // Celdas muertas resetean edad
                this.activityAges[index] = 0;
            }
        }

        // Debug edad de celda central cada 10 gens
        if (this.generation % 10 === 0) {
            console.log(`  Edad celda centro: ${this.activityAges[centerIdx]}, Reseteado: ${wasReset}`);
        }
    }

    // =========================================
    // RENDER
    // =========================================

    render() {
        if (!this.ctx || !this.canvas || this._isDestroyed) return;
        if (this.dirtyCells.size === 0 && this.generation > 0) return;

        // Render completo solo si es primera generación o hay muchos cambios
        const fullRenderNeeded = this.dirtyCells.size > (this.gridSize * this.gridSize * 0.1);

        if (fullRenderNeeded || this.generation === 0) {
            this._forceFullRender();
        } else {
            // Solo renderizar celdas dirty (sin tocar el grid)
            this._renderDirtyCells();
        }

        this.dirtyCells.clear();
    }

    _forceFullRender() {
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Para zoom > 2: grilla normal
        if (this.showGrid && this.cellSize > 2) {
            this._drawGrid();
        }

        this._drawCells((x, y) => this.grid[x][y]);

        // Para zoom <= 2: dibujar grilla SOLO en celdas muertas (después de las vivas)
        if (this.showGrid && this.cellSize <= 2) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            for (let x = 0; x < this.gridSize; x++) {
                for (let y = 0; y < this.gridSize; y++) {
                    if (!this.grid[x][y] && this.cellSize === 2) {
                        const xPos = x * 2;
                        const yPos = y * 2;

                        // Dibuja líneas derecha e inferior (como en _renderCell)
                        this.ctx.fillRect(xPos + 1, yPos, 1, 2);
                        this.ctx.fillRect(xPos, yPos + 1, 2, 1);
                    }
                }
            }
        }
    }

    _renderDirtyCells() {
        for (const index of this.dirtyCells) {
            // Descomposición column-major
            const x = Math.floor(index / this.gridSize);
            const y = index % this.gridSize;
            this._renderCell(x, y);
        }
    }

    _renderCell(x, y) {
        const cellSize = this.cellSize;
        const cellIndex = x * this.gridSize + y;
        const isAlive = this.grid[x][y];

        if (cellSize <= 2) {
            const xPos = x * cellSize;
            const yPos = y * cellSize;

            if (isAlive) {
                const isRecentlyActive = this.activityAges[cellIndex] < this.activityCooldown;
                this.ctx.fillStyle = (isRecentlyActive && this.showActivityEffect) ? '#b9b610' : '#059669';
                this.ctx.fillRect(xPos, yPos, cellSize, cellSize);
            } else {
                // Fondo azul
                this.ctx.fillStyle = '#0f172a';
                this.ctx.fillRect(xPos, yPos, cellSize, cellSize);

                // Grilla: líneas de 1px usando fillRect (más rápido y preciso que stroke)
                if (this.showGrid && cellSize === 2) {
                    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                    // Línea vertical derecha de la celda
                    this.ctx.fillRect(xPos + 1, yPos, 1, cellSize);
                    // Línea horizontal inferior de la celda
                    this.ctx.fillRect(xPos, yPos + 1, cellSize, 1);
                }
                // Para zoom 1x no dibujamos grilla (sería invisible o taparía toda la celda)
            }
            this.renderFlags[cellIndex] = isAlive ? 1 : 0;
        } else {
            // Zoom > 2: lógica original
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

        // Calcular tamaño real a dibujar (mínimo 1px)
        const drawSize = Math.max(1, cellSize - (cellSize > 2 ? 2 : 1));
        const offset = cellSize > 2 ? 1 : 0;

        if (cellSize >= 4) {
            // Solo usar gradiente para celdas grandes
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
            // Celdas pequeñas: color sólido para mejor performance
            this.ctx.fillStyle = (isRecentlyActive && this.showActivityEffect) ? '#b9b610' : '#059669';
        }

        this.ctx.fillRect(x * cellSize + offset, y * cellSize + offset, drawSize, drawSize);

        // Brillo solo si es reciente y celda es grande suficiente
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
        this.ctx.fillStyle = '#059669';

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (predicate(x, y)) {
                    const cellIndex = x * this.gridSize + y;
                    const isRecentlyActive = this.activityAges[cellIndex] < this.activityCooldown;

                    // Usar color dorado si es activa y el efecto está activo
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

    // =========================================
    // GENERACIÓN
    // =========================================

    async _initRule() {
        let attempts = 0;
        while (!window.RULES && attempts < 50) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }

        const ruleKey = window.RULES?.conway ? 'conway' : Object.keys(window.RULES || {})[0];
        if (ruleKey) this.setRuleByKey(ruleKey);
        else this.setRule([2, 3], [3]);
    }

    nextGeneration() {
        if (this.checkLimits()) return 0;

        // Copia atómica con propagación (más rápido que bucles)
        this.prevFlags = new Uint8Array(this.renderFlags);

        this.dirtyCells.clear();

        // === DECIDIR: Worker o main thread ===
        const useWorker = this.worker && this.gridSize >= this.workerThreshold;

        if (useWorker) {
            this._nextGenerationWorker();
            return 0; // Retorna 0 temporalmente, se actualizará async
        } else {
            return this._nextGenerationMainThread();
        }
    }

    // =========================================
    // MÉTODOS PÚBLICOS
    // =========================================

    setRule(survival, birth) {
        if (!Array.isArray(survival) || !Array.isArray(birth)) {
            throw new Error('Survival y birth deben ser arrays');
        }

        const isValid = arr => arr.every(n => Number.isInteger(n) && n >= 0 && n <= 8);
        if (!isValid(survival) || !isValid(birth)) {
            throw new Error('Valores de regla inválidos (deben ser 0-8)');
        }

        this.rule = {
            survival: [...survival].sort((a, b) => a - b),
            birth: [...birth].sort((a, b) => a - b)
        };

        this.generation = 0;
        this.isLimitReached = false;
        this._markAllDirty();
        this.updateStats();
        this.render();

        eventBus.emit('automaton:ruleChanged', this.rule);
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

        this.gridSize = size;
        this.grid = this.createEmptyGrid();
        this.activityAges = new Uint8Array(this.gridSize * this.gridSize);
        this.resizeCanvas();
        this.generation = 0;
        this.isLimitReached = false;
        this._neighborOffsets = this._precomputeNeighborOffsets();
        this.updateStats();
        this._markAllDirty();
        this.render();

        eventBus.emit('automaton:resized', {size});
    }

    setCellSize(size) {
        const newSize = Math.min(Math.max(size, 1), 20);
        this.cellSize = newSize;
        this.resizeCanvas();
        this._markAllDirty();
        this.render();

        eventBus.emit('automaton:zoomChanged', {zoom: newSize});
    }

    setNeighborhoodType(type) {
        if (!['moore', 'neumann'].includes(type)) return;

        this.neighborhoodType = type;
        this._neighborOffsets = this._precomputeNeighborOffsets();
        this.generation = 0;
        this.isLimitReached = false;
        this._markAllDirty();
        this.updateStats();
        this.render();

        eventBus.emit('automaton:neighborhoodChanged', {type});
        eventBus.emit('automaton:wrapChanged', {wrap: this.wrapEdges});
    }

    setNeighborhoodRadius(radius) {
        const newRadius = Math.min(Math.max(radius, 1), 5);
        this.neighborhoodRadius = newRadius;
        this._neighborOffsets = this._precomputeNeighborOffsets();
        this.generation = 0;
        this.isLimitReached = false;
        this._markAllDirty();
        this.updateStats();
        this.render();

        eventBus.emit('automaton:radiusChanged', {radius: newRadius});
        eventBus.emit('automaton:wrapChanged', {wrap: this.wrapEdges});
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

    countPopulation() {
        let count = 0;
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y]) count++;
            }
        }
        return count;
    }

    getDensity() {
        return ((this._lastPopulation / (this.gridSize * this.gridSize)) * 100).toFixed(1);
    }

    updateStats(populationOverride = null) {
        const population = populationOverride !== null
            ? populationOverride
            : this.countPopulation();

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

    // =========================================
    // MÉTODOS DE EDICIÓN
    // =========================================

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

    copyArea(minX, minY, maxX, maxY) {
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const grid = Array.from({length: width}, () => Array(height).fill(false));

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
                    grid[x - minX][y - minY] = this.grid[x][y];
                }
            }
        }

        return {grid, width, height};
    }

    clearArea(minX, minY, maxX, maxY) {
        // Detener ejecución si está activa
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
            this.isRunning = false;
        }

        setTimeout(() => {
            let changed = false;
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
                        const cellChanged = this.setCell(x, y, false);
                        if (cellChanged) changed = true;
                    }
                }
            }
            if (changed) {
                this.updateStats();
                this.render();
            }

            // Reanudar si estaba en ejecución
            if (wasRunning) {
                setTimeout(() => {
                    this.isRunning = true;
                    this.start();
                }, 50);
            }
        }, 0);
    }

    pasteArea(area, offsetX, offsetY) {
        // 1. Detener ejecución si está activa
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
            this.isRunning = false;
        }

        // 2. Limpiar worker si está procesando
        if (this.isWorkerProcessing) {
            this._cleanupWorker();
            this.isWorkerProcessing = false;
        }

        setTimeout(() => {
            if (!area?.grid) {
                // Si estaba running, reanudar
                if (wasRunning) {
                    this.isRunning = true;
                    this.start();
                }
                return;
            }

            let changed = false;
            for (let x = 0; x < area.width; x++) {
                for (let y = 0; y < area.height; y++) {
                    const gridX = offsetX + x;
                    const gridY = offsetY + y;
                    if (gridX >= 0 && gridX < this.gridSize && gridY >= 0 && gridY < this.gridSize) {
                        const cellChanged = this.setCell(gridX, gridY, area.grid[x][y]);
                        if (cellChanged) changed = true;
                    }
                }
            }
            if (changed) {
                this.updateStats();
                this.render();
            }

            // Reanudar si estaba en ejecución
            if (wasRunning) {
                setTimeout(() => {
                    this.isRunning = true;
                    this.start();
                }, 50);
            }
        }, 0);
    }

    undo() {
        const result = this.undoManager.undo(this.grid, this.generation);
        if (result) {
            this.grid = result.grid;
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
        const result = this.undoManager.redo(this.grid, this.generation);
        if (result) {
            this.grid = result.grid;
            this.generation = result.generation;
            this._markAllDirty();
            this.updateStats();
            this.render();
            eventBus.emit('automaton:redo', {generation: this.generation});
            return true;
        }
        return false;
    }

    importPattern(pattern, centerX, centerY) {
        // 1. Detener ejecución si está activa
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop();
            this.isRunning = false;
        }

        // 2. Limpiar worker si está procesando
        if (this.isWorkerProcessing) {
            this._cleanupWorker();
            this.isWorkerProcessing = false;
        }

        // 3. Esperar un frame para asegurar que RAF se detuvo
        setTimeout(() => {
            if (!pattern?.pattern) {
                console.warn('No pattern to import');
                // Si estaba running, reanudar
                if (wasRunning) {
                    this.isRunning = true;
                    this.start();
                }
                return;
            }

            if (pattern.pattern === 'random') {
                // Si es random, llamamos a randomize (que ya maneja su propia lógica)
                this.randomize(0.3);
                // Nota: randomize ya maneja reanudar si estaba running
                return;
            }

            // Guardar antes de importar
            this.undoManager.saveState(this.grid, this.generation);

            const patternData = pattern.pattern;
            const offsetX = Math.floor(patternData[0].length / 2);
            const offsetY = Math.floor(patternData.length / 2);

            let changed = false;
            for (let row = 0; row < patternData.length; row++) {
                for (let col = 0; col < patternData[row].length; col++) {
                    if (patternData[row][col] === 1) {
                        const gridX = centerX - offsetX + col;
                        const gridY = centerY - offsetY + row;
                        if (gridX >= 0 && gridX < this.gridSize && gridY >= 0 && gridY < this.gridSize) {
                            const cellChanged = this.setCell(gridX, gridY, true);
                            if (cellChanged) changed = true;
                        }
                    }
                }
            }

            if (changed) {
                this.updateStats();
                this.render();
            }

            this.resetDirtyFlags();

            // 4. Reanudar si estaba en ejecución
            if (wasRunning) {
                // Pequeña pausa para asegurar render completo
                setTimeout(() => {
                    this.isRunning = true;
                    this.start();
                }, 50);
            }
        }, 0);
    }

    exportPattern() {
        let minX = this.gridSize, minY = this.gridSize;
        let maxX = 0, maxY = 0;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y]) {
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
                row.push(this.grid[x][y] ? 1 : 0);
            }
            pattern.push(row);
        }

        return {
            pattern,
            name: `Patrón personalizado ${new Date().toLocaleDateString()}`,
            description: "Patrón exportado desde el autómata"
        };
    }

    // =========================================
    // CONTROL DE EJECUCIÓN
    // =========================================

    randomize(density = 0.3) {
        // 1. Detener completamente la ejecución si está activa
        const wasRunning = this.isRunning;
        if (wasRunning) {
            this.stop(); // Cancela RAF
            this.isRunning = false; // Asegurar estado consistente
        }

        // 2. Limpiar completamente el worker si está procesando
        if (this.isWorkerProcessing) {
            this._cleanupWorker();
            this.isWorkerProcessing = false;
        }

        // 3. Esperar un frame para asegurar que RAF se detuvo
        setTimeout(() => {
            // 4. Limpiar el estado como en reset
            this.undoManager.saveState(this.grid, this.generation);
            this.activityAges = new Uint8Array(this.gridSize * this.gridSize);

            // 5. Deshabilitar tracking durante operación masiva
            const wasTracking = this.undoManager.isTracking;
            this.undoManager.stopTracking();

            let changed = false;
            const gridSize = this.gridSize;

            // 6. Aplicar aleatorización (mismo código existente)
            for (let x = 0; x < gridSize; x++) {
                const row = this.grid[x];
                for (let y = 0; y < gridSize; y++) {
                    const newState = Math.random() < density;
                    if (row[y] !== newState) {
                        row[y] = newState;
                        changed = true;
                    }
                }
            }

            // 7. Restaurar tracking
            if (wasTracking) {
                this.undoManager.startTracking();
            }

            // 8. Resetear estado
            this.generation = 0;
            this.isLimitReached = false;
            this.populationHistory.clear();
            this.dirtyCells.clear();

            // 9. Forzar reinicio de worker si es necesario
            if (this.gridSize >= this.workerThreshold) {
                this._initWorker();
            }

            // 10. Actualizar y renderizar completo
            if (changed) {
                this._markAllDirty();
                this.updateStats();
                this.render();
            }

            this.prevFlags.set(this.renderFlags);

            // 11. Solo si estaba ejecutándose, reiniciar
            if (wasRunning) {
                // Pequeña pausa para asegurar render completo
                setTimeout(() => {
                    this.isRunning = true;
                    this.start();
                }, 50);
            }
        }, 0);
    }

    resetDirtyFlags() {
        this.dirtyFlags.fill(0);
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y]) {
                    this.dirtyFlags[x * this.gridSize + y] = 1;
                }
            }
        }
    }

    clear() {
        // Detener ejecución si está activa
        if (this.isRunning) {
            this.stop();
            this.isRunning = false;
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        // Cancelar worker si está procesando
        if (this.isWorkerProcessing) {
            this._cleanupWorker();
            this.isWorkerProcessing = false;
        }

        // Guardar un solo estado antes de limpiar (para poder deshacer la limpieza completa)
        this.undoManager.saveState(this.grid, this.generation);

        // Deshabilitar tracking durante operación masiva (evita el bottleneck)
        const wasTracking = this.undoManager.isTracking;
        this.undoManager.stopTracking();

        let changed = false;
        // Limpiar directamente
        for (let y = 0; y < this.gridSize; y++) {
            const row = this.grid[y];
            for (let x = 0; x < this.gridSize; x++) {
                if (row[x]) {
                    row[x] = 0;
                    changed = true;
                }
            }
        }

        // Restaurar tracking
        if (wasTracking) {
            this.undoManager.startTracking();
        }

        // Resetear ages de forma eficiente
        this.activityAges.fill(0);

        this.generation = 0;
        this.isLimitReached = false;
        this.populationHistory.clear();
        this.dirtyCells.clear();

        if (changed) {
            this._markAllDirty();

            // Forzar render completo para eliminar cualquier residuo visual
            this._forceFullRender();
            this.updateStats();

            this.prevFlags.set(this.renderFlags);
        }
    }

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
        // Evitar múltiples RAF loops
        if (this.rafId) {
            console.warn('⚠️ RAF ya activo');
            return;
        }

        // Resetear edades de actividad al iniciar para mostrar todas como activas
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y]) {
                    this.activityAges[x * this.gridSize + y] = 0;
                }
            }
        }
        this._markAllDirty();

        console.debug('▶️ Simulación iniciada con RAF');
        this._lastFrameTime = performance.now();
        this._animateRAF();
    }

    stop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
            console.debug('⏹️ Simulación detenida');
        }
    }

    _animateRAF(currentTime = 0) {
        if (!this.isRunning) return;

        // En la primera generación, asegurar que todas las celdas vivas muestren actividad
        if (this.generation === 0 && this._lastFrameTime === currentTime) {
            for (let x = 0; x < this.gridSize; x++) {
                for (let y = 0; y < this.gridSize; y++) {
                    if (this.grid[x][y]) {
                        this.activityAges[x * this.gridSize + y] = 0;
                    }
                }
            }
            this._markAllDirty();
        }

        // Delta time para timing preciso
        const deltaTime = currentTime - this._lastFrameTime;

        // Ejecutar solo si ha pasado el intervalo configurado
        if (deltaTime >= this.updateInterval) {
            this._lastFrameTime = currentTime - (deltaTime % this.updateInterval);

            // Generar frame
            this.nextGeneration();

            // Emitir evento para UI
            eventBus.emit('automaton:generation', {
                generation: this.generation,
                population: this.countPopulation(),
                density: this.getDensity()
            });
            this.render();
        }

        // Loop inmediato con RAF
        this.rafId = requestAnimationFrame((time) => this._animateRAF(time));
    }

    // Legacy para backwards compatibility
    _animate() {
        // Delegar al nuevo sistema
        if (!this._lastFrameTime) {
            this._lastFrameTime = performance.now();
            this._animateRAF();
        }
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

    _handleResize() {
        setTimeout(() => this.render(), 100);
    }
}

class CircularArray {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = new Array(maxSize);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }

    get length() {
        return this.size;
    }

    push(item) {
        if (this.size < this.maxSize) {
            this.buffer[this.tail] = item;
            this.tail = (this.tail + 1) % this.maxSize;
            this.size++;
        } else {
            // Sobrescribe el elemento más antiguo
            this.buffer[this.tail] = item;
            this.tail = (this.tail + 1) % this.maxSize;
            this.head = this.tail;
        }
    }

    get(index) {
        if (index < 0 || index >= this.size) return undefined;
        return this.buffer[(this.head + index) % this.maxSize];
    }

    clear() {
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }

    // Soporte para iteración y spread operator
    * [Symbol.iterator]() {
        for (let i = 0; i < this.size; i++) {
            yield this.get(i);
        }
    }
}