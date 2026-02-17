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
        const w = size / 2;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const gm = this.gridManager;
        const step = this.gridStep;

        ctx.strokeStyle = this.colorGrid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        // 1. LÍNEAS HORIZONTALES - en y = r * h para r múltiplo de step
        for (let r = 0; r <= gm.height; r += step) {
            const y = r * h;
            if (y > height) break;
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }

        // 2. DIAGONALES ↘ (\) - pasan por vértices donde (col + row) es impar
        // col = x/w, row = y/h
        // Ecuación: x/w + y/h = impar, o x/w - y/h = impar (para la otra dirección)

        // Para \: y = -√3(x - x0), pasa por (x0, 0)
        // En celda (q,r), vértice superior de △ está en x = (q+1)*w, y = r*h
        // y (q+1) + r debe ser impar para que sea vértice de △

        // Generar líneas \ que pasan por la fila superior (y=0) en x = k*step*w
        // pero desplazadas para coincidir con vértices: x = w, 3w, 5w... = (2k+1)*w

        const xOffsetDiag = w;  // Empezar en primera línea de vértices

        for (let k = -Math.ceil(height / h); k <= Math.ceil(width / w) + 1; k += step) {
            // Línea que pasa por (xOffsetDiag + k*2*w, 0) si k es par... no
            // Simplemente: xBase = (2k+1)*w para cubrir todos los vértices

            const xBase = xOffsetDiag + k * 2 * w;  // w, 3w, 5w, ... o desplazado

            // Encontrar segmento visible
            const pts = [];

            // y = -√3 * (x - xBase)

            // x=0: y = √3 * xBase
            const yLeft = Math.sqrt(3) * xBase;
            if (yLeft >= 0 && yLeft <= height) pts.push({x: 0, y: yLeft});

            // x=width: y = -√3 * (width - xBase)
            const yRight = -Math.sqrt(3) * (width - xBase);
            if (yRight >= 0 && yRight <= height) pts.push({x: width, y: yRight});

            // y=0: x = xBase
            if (xBase >= 0 && xBase <= width) pts.push({x: xBase, y: 0});

            // y=height: x = xBase - height/√3 = xBase - h*2*w/h = xBase - 2w? No
            // height/√3 = height * w / h = (gm.height * h) * w / h = gm.height * w
            const xBottom = xBase - height / Math.sqrt(3);
            if (xBottom >= 0 && xBottom <= width) pts.push({x: xBottom, y: height});

            if (pts.length >= 2) {
                pts.sort((a, b) => a.x - b.x);
                ctx.moveTo(pts[0].x, pts[0].y);
                ctx.lineTo(pts[1].x, pts[1].y);
            }
        }

        // 3. DIAGONALES ↗ (/) - pendiente +√3
        // y = √3 * (x - xBase)

        for (let k = -Math.ceil(height / h); k <= Math.ceil(width / w) + 1; k += step) {
            const xBase = xOffsetDiag + k * 2 * w;  // Mismos xBase que \

            const pts = [];

            // y = √3 * (x - xBase)

            // x=0: y = -√3 * xBase
            const yLeft = -Math.sqrt(3) * xBase;
            if (yLeft >= 0 && yLeft <= height) pts.push({x: 0, y: yLeft});

            // x=width: y = √3 * (width - xBase)
            const yRight = Math.sqrt(3) * (width - xBase);
            if (yRight >= 0 && yRight <= height) pts.push({x: width, y: yRight});

            // y=0: x = xBase
            if (xBase >= 0 && xBase <= width) pts.push({x: xBase, y: 0});

            // y=height: x = xBase + height/√3
            const xBottom = xBase + height / Math.sqrt(3);
            if (xBottom >= 0 && xBottom <= width) pts.push({x: xBottom, y: height});

            if (pts.length >= 2) {
                pts.sort((a, b) => a.x - b.x);
                ctx.moveTo(pts[0].x, pts[0].y);
                ctx.lineTo(pts[1].x, pts[1].y);
            }
        }

        ctx.stroke();
    }

    _renderDirty() {
        const ctx = this.ctx;
        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;
        const pathUp = this._pathCache.get('up');
        const pathDown = this._pathCache.get('down');
        const gm = this.gridManager;

        ctx.fillStyle = this.colorAlive;
        ctx.strokeStyle = this.colorGrid;
        ctx.lineWidth = 0.5;

        // Procesar celdas dirty
        for (const packed of this._dirtyCells) {
            const q = packed >>> 16;
            const r = packed & 0xFFFF;

            const state = gm.grid[q][r];
            const pos = gm.toCartesian(q, r, size);
            const path = pos.orientation === 'up' ? pathUp : pathDown;

            ctx.save();
            ctx.translate(pos.x, pos.y);

            if (state === 1) {
                ctx.fill(path);
                ctx.stroke(path);
            } else {
                // Clear: dibujar fondo local
                ctx.fillStyle = this.colorDead;
                ctx.fill(path);
                ctx.fillStyle = this.colorAlive; // restore
            }

            ctx.restore();
        }
    }

    markDirty(q, r) {
        if (!this.gridManager) return;
        if (q >= 0 && q < this.gridManager.width && r >= 0 && r < this.gridManager.height) {
            this._dirtyCells.add((q << 16) | r);
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