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

        // Grid cada N celdas (ajustable para rendimiento)
        this.gridStep = 5; // Dibujar línea cada 5 celdas
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

        const pathUp = new Path2D();
        pathUp.moveTo(size * 0.5, 0);
        pathUp.lineTo(0, h);
        pathUp.lineTo(size, h);
        pathUp.closePath();

        const pathDown = new Path2D();
        pathDown.moveTo(size * 0.5, h);
        pathDown.lineTo(0, 0);
        pathDown.lineTo(size, 0);
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

        const width = this.gridManager.width * this.cellSize * 0.5 + this.cellSize;
        const height = this.gridManager.height * this.cellSize * Math.sqrt(3) / 2 + this.cellSize;

        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        if (this.container) {
            this.container.style.width = (width + 20) + 'px';
            this.container.style.height = (height + 20) + 'px';
        }
    }

    render(options = {}) {
        if (!this.gridManager) return;

        const fullRender = options.force || this._isFirstRender || this._dirtyCells.size === 0;

        if (fullRender) {
            this._renderFullOptimized();
            this._isFirstRender = false;
        } else {
            this._renderDirtyOptimized();
        }

        this._dirtyCells.clear();
    }

    // Grid visible cada N celdas + celdas vivas
    _renderFullOptimized() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // 1. Fondo sólido
        ctx.fillStyle = this.colorDead;
        ctx.fillRect(0, 0, width, height);

        // 2. Dibujar GRID cada N celdas (si está activado)
        if (this.showGrid) {
            this._drawBackgroundGrid();
        }

        // 3. Dibujar SOLO celdas vivas
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

                    // Borde de celda viva siempre visible
                    ctx.stroke(path);
                    ctx.restore();
                }
            }
        }
    }

    // Dibujar grid de fondo cada N celdas
    _drawBackgroundGrid() {
        const ctx = this.ctx;
        const h = this.cellSize * Math.sqrt(3) / 2;
        const step = this.gridStep;

        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; // Más sutil que el grid de celdas vivas
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        // Líneas verticales cada N columnas
        for (let q = 0; q < this.gridManager.width; q += step) {
            const x = q * this.cellSize * 0.5;
            // Offset para alinear con el patrón triangular
            const offset = (q & 1) * (this.cellSize * 0.25);
            ctx.moveTo(x + offset, 0);
            ctx.lineTo(x + offset, this.canvas.height);
        }

        // Líneas horizontales cada N filas
        for (let r = 0; r < this.gridManager.height; r += step) {
            const y = r * h;
            ctx.moveTo(0, y);
            ctx.lineTo(this.canvas.width, y);
        }

        // Líneas diagonales para patrón triangular (opcional, cada 10 celdas)
        if (step <= 5) {
            for (let r = 0; r < this.gridManager.height; r += step * 2) {
                for (let q = 0; q < this.gridManager.width; q += step * 2) {
                    const pos = this.gridManager.toCartesian(q, r, this.cellSize);
                    const x = pos.x + this.cellSize * 0.5;
                    const y = pos.y;

                    // Línea diagonal corta para sugerir triángulos
                    ctx.moveTo(x - this.cellSize * 0.25, y + h * 0.5);
                    ctx.lineTo(x + this.cellSize * 0.25, y + h * 0.5);
                }
            }
        }

        ctx.stroke();
    }

    _renderDirtyOptimized() {
        const ctx = this.ctx;
        const pathUp = this._pathCache.get('up');
        const pathDown = this._pathCache.get('down');
        const h = this.cellSize * Math.sqrt(3) / 2;

        for (const key of this._dirtyCells) {
            const [q, r] = key.split(',').map(Number);
            const state = this.gridManager.grid[q][r];
            const pos = this.gridManager.toCartesian(q, r, this.cellSize);

            // Limpiar área local
            ctx.fillStyle = this.colorDead;
            ctx.fillRect(pos.x - 1, pos.y - 1, this.cellSize + 2, h + 2);

            // Redibujar líneas de grid en esta área (si están cerca de línea de grid)
            if (this.showGrid) {
                this._redrawGridInArea(q, r, pos);
            }

            // Dibujar celda si está viva
            if (state === 1) {
                const path = pos.orientation === 'up' ? pathUp : pathDown;

                ctx.save();
                ctx.translate(pos.x, pos.y);
                ctx.fillStyle = this.colorAlive;
                ctx.fill(path);
                ctx.strokeStyle = this.colorGrid;
                ctx.lineWidth = 0.5;
                ctx.stroke(path);
                ctx.restore();
            }
        }
    }

    // Redibujar líneas de grid en área específica
    _redrawGridInArea(q, r, pos) {
        const ctx = this.ctx;
        const step = this.gridStep;

        // Solo dibujar si esta celda está en una línea de grid
        if (q % step === 0 || r % step === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();

            if (q % step === 0) {
                const offset = (q & 1) * (this.cellSize * 0.25);
                ctx.moveTo(pos.x + this.cellSize * 0.5 + offset, pos.y - 5);
                ctx.lineTo(pos.x + this.cellSize * 0.5 + offset, pos.y + this.cellSize + 5);
            }

            if (r % step === 0) {
                ctx.moveTo(pos.x - 5, pos.y);
                ctx.lineTo(pos.x + this.cellSize + 5, pos.y);
            }

            ctx.stroke();
        }
    }

    markDirty(q, r) {
        if (!this.gridManager) return;
        if (q >= 0 && q < this.gridManager.width &&
            r >= 0 && r < this.gridManager.height) {
            this._dirtyCells.add(`${q},${r}`);
        }
    }

    markAllDirty() {
        if (!this.gridManager) return;
        this._dirtyCells.clear();
        this._isFirstRender = true;
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this._isFirstRender = true; // Forzar redraw completo para mostrar/ocultar grid
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