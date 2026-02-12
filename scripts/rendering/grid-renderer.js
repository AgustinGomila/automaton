/**
 * GridRenderer - Módulo dedicado al renderizado del autómata celular
 *
 * Responsabilidad: Renderizado puramente visual del grid de celdas.
 *
 * Características:
 * - Dirty rendering optimization (solo redibuja celdas modificadas)
 * - Efectos visuales de actividad (celdas recién modificadas)
 * - Soporte para múltiples modos: 2D estándar, RD-2D
 * - Configuración dinámica de visualización (grid, zoom, efectos)
 */

class GridRenderer {
    /**
     * @param {Object} options - Opciones de configuración y dependencias
     * @param {HTMLCanvasElement} options.canvas - Elemento canvas del DOM
     * @param {HTMLElement} options.container - Contenedor del canvas
     * @param {Function} options.getCell - Callback (x, y) => state (0 o 1)
     * @param {Function} options.getRD2DState - Callback (x, y) => stateRD (0-15)
     * @param {Function} options.isRD2DActive - Callback () => boolean
     * @param {Function} options.getGridSize - Callback () => number
     * @param {number} [options.gridSize=200] - Tamaño inicial del grid
     * @param {number} [options.cellSize=4] - Tamaño inicial de celda en px
     * @param {boolean} [options.showGrid=true] - Mostrar líneas de grilla
     * @param {boolean} [options.showActivityEffect=true] - Efecto de actividad
     */
    constructor(options) {
        // Validación de dependencias requeridas
        if (!options.canvas) {
            throw new Error('GridRenderer requiere options.canvas');
        }
        if (!options.getCell || typeof options.getCell !== 'function') {
            throw new Error('GridRenderer requiere options.getCell function');
        }
        if (!options.getGridSize || typeof options.getGridSize !== 'function') {
            throw new Error('GridRenderer requiere options.getGridSize function');
        }

        // Referencias al DOM
        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d');
        this.container = options.container;

        // Callbacks para consultar estado (inyección de dependencias)
        this._getCell = options.getCell;
        this._getRD2DState = options.getRD2DState || (() => undefined);
        this._isRD2DActive = options.isRD2DActive || (() => false);
        this._getGridSize = options.getGridSize;

        // Configuración visual
        this.config = {
            showGrid: options.showGrid !== false,
            showActivityEffect: options.showActivityEffect !== false,
            cellSize: Math.max(1, Math.min(options.cellSize || 4, 20)),
            gridSize: Math.max(20, Math.min(options.gridSize || 200, 400))
        };

        // Estado interno de renderizado
        this._dirtyCells = new Set();
        this._renderFlags = new Uint8Array(this.config.gridSize * this.config.gridSize);
        this._prevFlags = new Uint8Array(this.config.gridSize * this.config.gridSize);
        this._activityAges = new Uint8Array(this.config.gridSize * this.config.gridSize);
        this._activityCooldown = 3;

        this._resizeCanvas();
    }

    get hasDirtyCells() {
        return this._dirtyCells.size > 0;
    }

    get dirtyCount() {
        return this._dirtyCells.size;
    }

    render(options = {}) {
        const generation = options.generation || 0;

        if (this._dirtyCells.size === 0 && generation > 0) {
            return;
        }

        const totalCells = this.config.gridSize * this.config.gridSize;
        const fullRenderNeeded = this._dirtyCells.size > (totalCells * 0.1);

        if (fullRenderNeeded || generation === 0) {
            this._forceFullRender();
        } else {
            this._renderDirtyCells();
        }

        this._dirtyCells.clear();
    }

    markDirty(x, y) {
        const index = x * this.config.gridSize + y;
        this._dirtyCells.add(index);
    }

    markAllDirty() {
        this._dirtyCells.clear();
        const size = this.config.gridSize;
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                this._dirtyCells.add(x * size + y);
            }
        }
    }

    setConfig(key, value) {
        if (!(key in this.config)) {
            console.warn(`GridRenderer: Config key "${key}" no existe`);
            return false;
        }

        const oldValue = this.config[key];
        this.config[key] = value;

        if (key === 'showGrid' && oldValue !== value) {
            this.markAllDirty();
        }

        if (key === 'showActivityEffect' && oldValue !== value) {
            this.markAllDirty();
        }

        return true;
    }

    getConfig(key) {
        return this.config[key];
    }

    toggleGrid() {
        this.config.showGrid = !this.config.showGrid;
        this.markAllDirty();
        return this.config.showGrid;
    }

    resize(gridSize, cellSize) {
        this.config.gridSize = Math.max(20, Math.min(gridSize, 400));
        this.config.cellSize = Math.max(1, Math.min(cellSize, 20));

        const totalCells = this.config.gridSize * this.config.gridSize;
        this._renderFlags = new Uint8Array(totalCells);
        this._prevFlags = new Uint8Array(totalCells);
        this._activityAges = new Uint8Array(totalCells);
        this._dirtyCells.clear();

        this._resizeCanvas();
        this.markAllDirty();
    }

    updateActivityAges(changedCells) {
        const size = this.config.gridSize;
        const cooldown = this._activityCooldown;
        const changedSet = new Set(changedCells);

        for (let index = 0; index < size * size; index++) {
            const x = Math.floor(index / size);
            const y = index % size;
            const isAlive = this._getCell(x, y);

            if (isAlive) {
                if (changedSet.has(index)) {
                    this._activityAges[index] = 0;
                } else if (this._activityAges[index] < cooldown) {
                    this._activityAges[index]++;
                    if (this._activityAges[index] === cooldown) {
                        this._dirtyCells.add(index);
                    }
                }
            } else {
                this._activityAges[index] = 0;
            }
        }
    }

    resetActivity() {
        this._activityAges.fill(0);
        this.markAllDirty();
    }

    destroy() {
        this._dirtyCells.clear();
        this._renderFlags = null;
        this._prevFlags = null;
        this._activityAges = null;
        this.ctx = null;
        this.canvas = null;
        this.container = null;
        this._getCell = null;
        this._getRD2DState = null;
        this._isRD2DActive = null;
        this._getGridSize = null;
    }

    _forceFullRender() {
        const size = this.config.gridSize;
        const cellSize = this.config.cellSize;

        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.config.showGrid && cellSize > 2) {
            this._drawGrid();
        }

        this._drawCells((x, y) => this._getCell(x, y));

        if (this.config.showGrid && cellSize <= 2) {
            this._drawSubtleGrid();
        }
    }

    _renderDirtyCells() {
        for (const index of this._dirtyCells) {
            const x = Math.floor(index / this.config.gridSize);
            const y = index % this.config.gridSize;
            this._renderCell(x, y);
        }
    }

    _renderCell(x, y) {
        const cellSize = this.config.cellSize;
        const cellIndex = x * this.config.gridSize + y;
        const isAlive = this._getCell(x, y);

        if (this._isRD2DActive() && isAlive) {
            const state = this._getRD2DState(x, y) || 0;
            this._renderRD2DCell(x, y, cellSize, state);
            this._renderFlags[cellIndex] = 1;
            return;
        }

        if (cellSize <= 2) {
            this._renderSmallCell(x, y, cellIndex, isAlive);
        } else {
            this._renderLargeCell(x, y, cellIndex, isAlive);
        }
    }

    _renderSmallCell(x, y, cellIndex, isAlive) {
        const cellSize = this.config.cellSize;
        const xPos = x * cellSize;
        const yPos = y * cellSize;

        if (isAlive) {
            const isRecentlyActive = this._activityAges[cellIndex] < this._activityCooldown;
            this.ctx.fillStyle = (isRecentlyActive && this.config.showActivityEffect)
                ? '#b9b610' : '#059669';
            this.ctx.fillRect(xPos, yPos, cellSize, cellSize);
        } else {
            this.ctx.fillStyle = '#0f172a';
            this.ctx.fillRect(xPos, yPos, cellSize, cellSize);

            if (this.config.showGrid && cellSize === 2) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                this.ctx.fillRect(xPos + 1, yPos, 1, cellSize);
                this.ctx.fillRect(xPos, yPos + 1, cellSize, 1);
            }
        }

        this._renderFlags[cellIndex] = isAlive ? 1 : 0;
    }

    _renderLargeCell(x, y, cellIndex, isAlive) {
        const cellSize = this.config.cellSize;
        const innerSize = cellSize - 2;

        this.ctx.clearRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
        this._renderFlags[cellIndex] = isAlive ? 1 : 0;

        if (isAlive) {
            this._drawSingleCell(x, y);
        }
    }

    _drawSingleCell(x, y) {
        const cellSize = this.config.cellSize;
        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;
        const cellIndex = x * this.config.gridSize + y;

        const isRecentlyActive = this._activityAges[cellIndex] < this._activityCooldown;
        const drawSize = Math.max(1, cellSize - (cellSize > 2 ? 2 : 1));
        const offset = cellSize > 2 ? 1 : 0;

        if (cellSize >= 4) {
            const gradient = this.ctx.createRadialGradient(
                centerX, centerY, 0,
                centerX, centerY, cellSize / 2
            );

            if (isRecentlyActive && this.config.showActivityEffect) {
                gradient.addColorStop(0, '#b9b610');
                gradient.addColorStop(0.7, '#059669');
                gradient.addColorStop(1, 'rgba(5, 150, 105, 0.8)');
            } else {
                gradient.addColorStop(0, '#059669');
                gradient.addColorStop(1, '#059669');
            }

            this.ctx.fillStyle = gradient;
        } else {
            this.ctx.fillStyle = (isRecentlyActive && this.config.showActivityEffect)
                ? '#b9b610' : '#059669';
        }

        this.ctx.fillRect(
            x * cellSize + offset,
            y * cellSize + offset,
            drawSize,
            drawSize
        );

        if (isRecentlyActive && this.config.showActivityEffect && cellSize >= 4) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 2);
        }
    }

    _drawGrid() {
        const size = this.config.gridSize;
        const cellSize = this.config.cellSize;

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.lineWidth = 1;

        for (let i = 0; i <= size; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * cellSize, 0);
            this.ctx.lineTo(i * cellSize, this.canvas.height);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(0, i * cellSize);
            this.ctx.lineTo(this.canvas.width, i * cellSize);
            this.ctx.stroke();
        }
    }

    _drawSubtleGrid() {
        const size = this.config.gridSize;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (!this._getCell(x, y)) {
                    const xPos = x * 2;
                    const yPos = y * 2;
                    this.ctx.fillRect(xPos + 1, yPos, 1, 2);
                    this.ctx.fillRect(xPos, yPos + 1, 2, 1);
                }
            }
        }
    }

    _drawCells(predicate) {
        const size = this.config.gridSize;
        const cellSize = this.config.cellSize;

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (predicate(x, y)) {
                    const cellIndex = x * size + y;
                    const isRecentlyActive = this._activityAges[cellIndex] < this._activityCooldown;

                    this.ctx.fillStyle = (isRecentlyActive && this.config.showActivityEffect)
                        ? '#b9b610' : '#059669';

                    if (cellSize <= 2) {
                        this.ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                    } else {
                        this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
                    }
                }
            }
        }
    }

    _renderRD2DCell(x, y, cellSize, state) {
        if (state === 0) return;

        const borders = this._parseRD2DState(state);
        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;
        const half = cellSize / 2;

        this.ctx.strokeStyle = this._getRD2DColor(state);
        this.ctx.lineWidth = Math.max(2, cellSize / 4);
        this.ctx.lineCap = 'round';

        this.ctx.beginPath();

        if (borders.N) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX, centerY - half + 1);
        }
        if (borders.S) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX, centerY + half - 1);
        }
        if (borders.E) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX + half - 1, centerY);
        }
        if (borders.W) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX - half + 1, centerY);
        }

        this.ctx.stroke();

        this.ctx.fillStyle = this.ctx.strokeStyle;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, cellSize / 6, 0, Math.PI * 2);
        this.ctx.fill();
    }

    _parseRD2DState(state) {
        return {
            N: (state >> 3) & 1,
            S: (state >> 2) & 1,
            E: (state >> 1) & 1,
            W: state & 1
        };
    }

    _getRD2DColor(state) {
        const colors = {
            0: '#000000',
            1: '#ef4444',
            2: '#f97316',
            3: '#eab308',
            4: '#22c55e',
        };

        let count = 0;
        for (let i = 0; i < 4; i++) {
            count += (state >> i) & 1;
        }

        return colors[count] || '#94a3b8';
    }

    _resizeCanvas() {
        if (!this.canvas) return;

        const width = this.config.gridSize * this.config.cellSize;
        const height = width;

        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        if (this.container) {
            this.container.style.width = (width + 20) + 'px';
            this.container.style.height = (height + 20) + 'px';
        }
    }
}

window.GridRenderer = GridRenderer;