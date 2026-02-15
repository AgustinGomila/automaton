/**
 * TriangleRenderer - Renderer para grids triangulares con grid visible
 */
class TriangleRenderer {
    constructor(options) {
        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d', {alpha: false});
        this.container = options.container;
        this.cellSize = options.cellSize || 20;
        this.showGrid = options.showGrid !== false;
        this.colorAlive = options.colorAlive || '#8b5cf6';
        this.colorDead = options.colorDead || '#0f172a';
        this.colorGrid = options.colorGrid || 'rgba(255,255,255,0.1)';

        this.gridManager = null;
        this._dirtyCells = new Set();
        this._activityAges = new Map();
        this._pathCache = new Map();
        this._cachedCellSize = 0;
        this._isFirstRender = true;

        this.gridStep = 5;
    }

    setGridManager(gridManager) {
        this.gridManager = gridManager;
        this._rebuildPathCache();
        this._resizeCanvas();
        this._isFirstRender = true;
        this.markAllDirty();
    }

    _rebuildPathCache() {
        if (this.cellSize === this._cachedCellSize) return;

        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;

        // △ UP: vértice en top, base en bottom
        const pathUp = new Path2D();
        pathUp.moveTo(size * 0.5, 0);   // Top
        pathUp.lineTo(0, h);            // Bottom-left
        pathUp.lineTo(size, h);         // Bottom-right
        pathUp.closePath();

        // ▽ DOWN: vértice en bottom, base en top
        const pathDown = new Path2D();
        pathDown.moveTo(0, 0);          // Top-left
        pathDown.lineTo(size, 0);       // Top-right
        pathDown.lineTo(size * 0.5, h); // Bottom
        pathDown.closePath();

        this._pathCache.set('up', pathUp);
        this._pathCache.set('down', pathDown);
        this._cachedCellSize = size;
    }

    resize(gridSize, cellSize) {
        this.cellSize = cellSize;
        this._rebuildPathCache();
        if (this.gridManager) {
            this._resizeCanvas();
            this._isFirstRender = true;
            this.markAllDirty();
        }
    }

    _resizeCanvas() {
        if (!this.gridManager) return;

        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;

        const width = (this.gridManager.width - 1) * (size / 2) + size;
        const height = (this.gridManager.height - 1) * h + h;

        this.canvas.width = Math.ceil(width);
        this.canvas.height = Math.ceil(height);
        this.canvas.style.width = this.canvas.width + 'px';
        this.canvas.style.height = this.canvas.height + 'px';

        if (this.container) {
            this.container.style.width = (this.canvas.width + 20) + 'px';
            this.container.style.height = (this.canvas.height + 20) + 'px';
        }
    }

    render(options = {}) {
        if (!this.gridManager) return;

        const fullRender = options.force || this._isFirstRender || this._dirtyCells.size === 0;

        if (fullRender) {
            this._renderFull();
            this._isFirstRender = false;
        } else {
            this._renderDirty();
        }

        this._dirtyCells.clear();
    }

    _renderFull() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Fondo
        ctx.fillStyle = this.colorDead;
        ctx.fillRect(0, 0, width, height);

        // Grid de fondo
        if (this.showGrid) {
            this._drawBackgroundGrid();
        }

        // Dibujar celdas vivas
        ctx.fillStyle = this.colorAlive;
        ctx.strokeStyle = this.colorGrid;
        ctx.lineWidth = 0.5;

        const pathUp = this._pathCache.get('up');
        const pathDown = this._pathCache.get('down');

        for (let r = 0; r < this.gridManager.height; r++) {
            for (let q = 0; q < this.gridManager.width; q++) {
                if (this.gridManager.grid[q][r] === 1) {
                    const pos = this.gridManager.toCartesian(q, r, this.cellSize);
                    const path = pos.orientation === 'up' ? pathUp : pathDown;

                    ctx.save();
                    ctx.translate(pos.x, pos.y);
                    ctx.fill(path);
                    ctx.stroke(path);
                    ctx.restore();
                }
            }
        }
    }

    _drawBackgroundGrid() {
        const ctx = this.ctx;
        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.strokeStyle = this.colorGrid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        // Líneas horizontales (bases) cada gridStep filas
        for (let r = 0; r <= this.gridManager.height; r += this.gridStep) {
            const y = r * h;
            if (y >= 0 && y <= height) {
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
        }

        const sqrt3 = Math.sqrt(3);
        // Rango aproximado de parámetros para diagonales
        const kMin = Math.floor(0);
        const kMax = Math.ceil(height / h + sqrt3 * width / h);

        // Diagonales con pendiente negativa (q+r constante) → y = -√3·x + k·h
        for (let k = kMin; k <= kMax; k += this.gridStep) {
            const b = k * h;
            const points = [];

            // Intersección con borde izquierdo (x=0)
            const yLeft = b;
            if (yLeft >= 0 && yLeft <= height) points.push({x: 0, y: yLeft});

            // Intersección con borde derecho (x=width)
            const yRight = b - sqrt3 * width;
            if (yRight >= 0 && yRight <= height) points.push({x: width, y: yRight});

            // Intersección con borde superior (y=0)
            const xTop = b / sqrt3;
            if (xTop >= 0 && xTop <= width) points.push({x: xTop, y: 0});

            // Intersección con borde inferior (y=height)
            const xBottom = (b - height) / sqrt3;
            if (xBottom >= 0 && xBottom <= width) points.push({x: xBottom, y: height});

            if (points.length >= 2) {
                points.sort((a, b) => a.x - b.x);
                ctx.moveTo(points[0].x, points[0].y);
                ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
            }
        }

        // Diagonales con pendiente positiva (q-r constante) → y = √3·x + k·h
        for (let k = kMin; k <= kMax; k += this.gridStep) {
            const b = k * h;
            const points = [];

            // x=0
            const yLeft = b;
            if (yLeft >= 0 && yLeft <= height) points.push({x: 0, y: yLeft});

            // x=width
            const yRight = sqrt3 * width + b;
            if (yRight >= 0 && yRight <= height) points.push({x: width, y: yRight});

            // y=0
            const xTop = -b / sqrt3;
            if (xTop >= 0 && xTop <= width) points.push({x: xTop, y: 0});

            // y=height
            const xBottom = (height - b) / sqrt3;
            if (xBottom >= 0 && xBottom <= width) points.push({x: xBottom, y: height});

            if (points.length >= 2) {
                points.sort((a, b) => a.x - b.x);
                ctx.moveTo(points[0].x, points[0].y);
                ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
            }
        }

        ctx.stroke();
    }

    _drawBackgroundSquareGrid() {
        const ctx = this.ctx;
        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        // Líneas verticales cada N columnas
        for (let q = 0; q < this.gridManager.width; q += this.gridStep) {
            const x = q * (size / 2);
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.canvas.height);
        }

        // Líneas horizontales cada N filas
        for (let r = 0; r < this.gridManager.height; r += this.gridStep) {
            const y = r * h;
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
        }

        ctx.stroke();
    }

    _renderDirty() {
        // Por simplicidad, hacer full render en dirty cells
        // (puedes optimizar esto después)
        this._renderFull();
    }

    markDirty(q, r) {
        if (!this.gridManager) return;
        if (q >= 0 && q < this.gridManager.width && r >= 0 && r < this.gridManager.height) {
            this._dirtyCells.add(`${q},${r}`);
        }
    }

    markAllDirty() {
        if (!this.gridManager) return;
        this._isFirstRender = true;
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this._isFirstRender = true;
        this.markAllDirty();
        return this.showGrid;
    }

    getCellFromMouse(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        return this.gridManager.fromCartesian(x, y, this.cellSize);
    }

    setCellFromMouse(clientX, clientY, state) {
        if (!this.gridManager) return null;

        const result = this.getCellFromMouse(clientX, clientY);
        if (!result) return null;

        const {q, r} = result;
        const changed = this.gridManager.setCell(q, r, state);

        if (changed) {
            this.markDirty(q, r);
            this._activityAges.set(`${q},${r}`, 0);
        }

        return {q, r, changed};
    }

    updateActivityAges(changedCells) {
        const maxProcess = Math.min(changedCells.length, 100);

        for (let i = 0; i < maxProcess; i++) {
            const c = changedCells[i];
            const key = `${c.x},${c.y}`;
            this._activityAges.set(key, 0);
        }
    }

    resetActivity() {
        this._activityAges.clear();
        this._isFirstRender = true;
        this.markAllDirty();
    }

    getConfig(key) {
        if (key === 'showGrid') return this.showGrid;
        if (key === 'showActivityEffect') return true;
        return undefined;
    }

    setConfig(key, value) {
        if (key === 'showGrid') {
            this.showGrid = value;
            this._isFirstRender = true; // Forzar redraw al cambiar config
            this.markAllDirty();
        }
    }

    destroy() {
        this.gridManager = null;
        this._dirtyCells.clear();
        this._activityAges.clear();
        this._pathCache.clear();
    }
}

window.TriangleRenderer = TriangleRenderer;