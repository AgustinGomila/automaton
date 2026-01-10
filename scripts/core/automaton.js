class CellularAutomaton {
    constructor(gridSize = 100, cellSize = 6) {
        // Configuración con validación estricta
        this.gridSize = Math.min(Math.max(gridSize, 20), 200);
        this.cellSize = Math.min(Math.max(cellSize, 4), 20);

        // Estado interno
        this.grid = this.createEmptyGrid();
        this.prevGrid = null;
        this.generation = 0;
        this.isRunning = false;
        this.updateInterval = 100;
        this.intervalId = null;
        this.showGrid = true;

        // Sistema de dirty rendering
        this.dirtyCells = new Set();
        this._lastPopulation = 0;

        // Canvas
        this.canvas = document.getElementById('canvas');
        if (!this.canvas) {
            throw new Error('Canvas element no encontrado');
        }
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Estadísticas
        this.populationHistory = [];
        this.maxHistoryLength = 100;

        // Vecindad optimizada
        this.neighborhoodType = 'moore';
        this.neighborhoodRadius = 1;
        this._neighborOffsets = this._precomputeNeighborOffsets();

        // Límites
        this.maxGenerations = null;
        this.maxPopulation = null;
        this.limitType = 'none'; // 'none', 'generations', 'population', 'wrap'
        this.limitValue = 1000;
        this.isLimitReached = false;

        // Bind y event listeners
        this._boundAnimate = this._animate.bind(this);
        this._boundHandleResize = this._handleResize.bind(this);
        this._cleanupResize = this._addEventListener(window, 'resize', this._boundHandleResize);

        // Inicializar
        this._initRule().then(() => {
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
        this.stop();
        if (this._cleanupResize) this._cleanupResize();

        this.grid = null;
        this.prevGrid = null;
        this.dirtyCells.clear();
        this.populationHistory = [];
        this.ctx = null;
        this.canvas = null;

        eventBus.emit('automaton:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        return () => target.removeEventListener(event, handler, options);
    }

    // =========================================
    // OPTIMIZACIÓN DE VECINDAD
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

    _countNeighborsOptimized(x, y) {
        let count = 0;
        const size = this.gridSize;
        const grid = this.grid; // Cache local para velocidad

        for (const {dx, dy} of this._neighborOffsets) {
            const nx = x + dx;
            const ny = y + dy;

            // Evitar módulo si no es necesario (más rápido)
            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                if (grid[nx][ny]) count++;
            } else if (this.limitType === 'wrap') { // Si añades wrap como opción
                const wrappedX = (nx + size) % size;
                const wrappedY = (ny + size) % size;
                if (grid[wrappedX][wrappedY]) count++;
            }
        }

        return count;
    }

    // =========================================
    // SISTEMA DE DIRTY RENDERING
    // =========================================

    createEmptyGrid() {
        return Array.from({length: this.gridSize}, () =>
            Array.from({length: this.gridSize}, () => false)
        );
    }

    setCell(x, y, state, markDirty = true) {
        if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) return false;

        if (this.grid[x][y] !== state) {
            this.grid[x][y] = state;
            if (markDirty) this.dirtyCells.add(`${x},${y}`);
            return true;
        }
        return false;
    }

    _markAllDirty() {
        this.dirtyCells.clear();
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                this.dirtyCells.add(`${x},${y}`);
            }
        }
    }

    // =========================================
    // RENDER OPTIMIZADO
    // =========================================

    render() {
        if (!this.ctx || !this.canvas) return;
        if (this.dirtyCells.size === 0 && this.generation > 0) return;

        const fullRenderNeeded = this.dirtyCells.size > (this.gridSize * this.gridSize * 0.1);

        if (fullRenderNeeded || this.generation === 0) {
            this._forceFullRender();
        } else {
            this._renderDirtyCells();
        }

        this.dirtyCells.clear();
    }

    _forceFullRender() {
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.showGrid) this._drawGrid();
        this._drawCells((x, y) => this.grid[x][y]);
    }

    _renderDirtyCells() {
        for (const key of this.dirtyCells) {
            const [x, y] = key.split(',').map(Number);
            this._renderCell(x, y);
        }
    }

    _renderCell(x, y) {
        const cellSize = this.cellSize;
        const isAlive = this.grid[x][y];
        const prevAlive = this.prevGrid?.[x]?.[y] ?? false;

        // Si no cambió y no es la primera generación, no renderizar
        if (isAlive === prevAlive && this.generation > 0) return;

        // 1. Limpiar TODA el área de la celda (incluyendo líneas)
        this.ctx.clearRect(x * cellSize, y * cellSize, cellSize, cellSize);

        // 2. Si la cuadrícula está activa, redibujar su línea PRIMERO
        if (this.showGrid) {
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }

        // 3. Dibujar celda si está viva
        if (isAlive) {
            this._drawSingleCell(x, y);
        }
    }

    _drawSingleCell(x, y) {
        const cellSize = this.cellSize;
        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;

        // Verificar si la celda cambió en la última generación
        const changed = this.prevGrid?.[x]?.[y] !== this.grid[x][y];

        // Colores según actividad
        const activeColor = '#b9b610'; // Amarillo para activa
        const stableColor = '#059669'; // Verde para estable
        const highlightColor = 'rgba(255, 255, 255, 0.3)';

        // Gradient dinámico basado en actividad
        const gradient = this.ctx.createRadialGradient(
            centerX, centerY, 0,
            centerX, centerY, cellSize / 2
        );

        if (changed) {
            // CELDA ACTIVA (cambió recientemente)
            gradient.addColorStop(0, activeColor);
            gradient.addColorStop(0.7, stableColor);
            gradient.addColorStop(1, 'rgba(5, 150, 105, 0.8)');
        } else {
            // CELDA ESTABLE
            gradient.addColorStop(0, stableColor);
            gradient.addColorStop(1, stableColor);
        }

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(
            x * cellSize + 1,
            y * cellSize + 1,
            cellSize - 2,
            cellSize - 2
        );

        // Efecto de brillo en borde superior
        if (changed) {
            this.ctx.fillStyle = highlightColor;
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
                    this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
                }
            }
        }
    }

    // =========================================
    // GENERACIÓN OPTIMIZADA
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

        this.prevGrid = this.grid.map(row => [...row]);
        this.dirtyCells.clear();

        const newGrid = this.createEmptyGrid();
        let changes = 0;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const neighbors = this._countNeighborsOptimized(x, y);
                const isAlive = this.grid[x][y];
                const willBeAlive = isAlive
                    ? this.rule.survival.includes(neighbors)
                    : this.rule.birth.includes(neighbors);

                newGrid[x][y] = willBeAlive;
                if (willBeAlive !== isAlive) {
                    changes++;
                    this.dirtyCells.add(`${x},${y}`);
                }
            }
        }

        this.grid = newGrid;
        this.generation++;
        this._lastPopulation = this.countPopulation();
        this.updateStats();
        this.checkLimits();

        eventBus.emit('automaton:generation', {
            generation: this.generation,
            population: this._lastPopulation,
            changes
        });

        return changes;
    }

    // =========================================
    // MÉTODOS PÚBLICOS COMPLETOS
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
        const size = Math.min(Math.max(newSize, 20), 200);

        if (this.isRunning) this.stop();

        this.gridSize = size;
        this.grid = this.createEmptyGrid();
        this.prevGrid = null;
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
        const newSize = Math.min(Math.max(size, 4), 20);
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

    updateStats() {
        const population = this.countPopulation();
        const density = this.getDensity();

        this.populationHistory.push(population);
        if (this.populationHistory.length > this.maxHistoryLength) {
            this.populationHistory = this.populationHistory.slice(-this.maxHistoryLength);
        }

        console.log(`📡 Emitiendo stats: G${this.generation} P${population} D${density}%`);

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

        if (type === 'none') {
            this.maxGenerations = null;
            this.maxPopulation = null;
        } else if (type === 'generations') {
            this.maxGenerations = parseInt(value);
            this.maxPopulation = null;
        } else if (type === 'population') {
            this.maxPopulation = parseInt(value);
            this.maxGenerations = null;
        }

        this.limitValue = value;
        this.isLimitReached = false;
        eventBus.emit('automaton:limitChanged', {type, value});
    }

    // =========================================
    // MÉTODOS DE EDICIÓN COMPLETOS
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
    }

    pasteArea(area, offsetX, offsetY) {
        if (!area?.grid) return;

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
    }

    importPattern(pattern, centerX, centerY) {
        if (!pattern?.pattern) {
            console.warn('No pattern to import');
            return;
        }

        if (pattern.pattern === 'random') {
            this.randomize(0.3);
            return;
        }

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
        let changed = false;
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const newState = Math.random() < density;
                const cellChanged = this.setCell(x, y, newState);
                if (cellChanged) changed = true;
            }
        }
        this.generation = 0;
        this.isLimitReached = false;
        if (changed) {
            this.updateStats();
            this.render();
        }
    }

    clear() {
        let changed = false;
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const cellChanged = this.setCell(x, y, false);
                if (cellChanged) changed = true;
            }
        }
        this.generation = 0;
        this.isLimitReached = false;
        if (changed) {
            this.updateStats();
            this.render();
        }
    }

    toggleRunning() {
        this.isRunning = !this.isRunning;
        this.isRunning ? this.start() : this.stop();
        return this.isRunning;
    }

    start() {
        if (this.intervalId) return;
        console.log('▶️ Simulación iniciada - Intervalo:', this.updateInterval);
        this.intervalId = setInterval(() => this._animate(), this.updateInterval);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    _animate() {
        console.log('🔄 Generación', this.generation + 1);
        this.nextGeneration();

        // === Emitir evento para que UI se actualice en cada paso ===
        eventBus.emit('automaton:generation', {
            generation: this.generation,
            population: this.countPopulation(),
            density: this.getDensity()
        });

        this.render();
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

    _handleResize() {
        setTimeout(() => this.render(), 100);
    }
}