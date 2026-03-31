/**
 * TriangleRenderer - Renderer para grids triangulares con grid visible
 */
class TriangleRenderer {
    constructor(options) {
        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d', {alpha: false});
        this.container = options.container;
        this.cellSize = options.cellSize || AppConfig.GRID.MAX_CELL_SIZE;
        this.showGrid = options.showGrid !== false;
        this.showActivityEffect = options.showActivityEffect !== false;
        this.destroboscope = options.destroboscope || false;

        this.colorAlive = options.colorAlive || '#8b5cf6';
        this.colorDead = options.colorDead || '#0f172a';
        this.colorGrid = options.colorGrid || 'rgba(255,255,255,0.1)';
        this.colorBorn = options.colorBorn || AppConfig.RENDER.COLOR_BORN;
        this.colorDying = options.colorDying || AppConfig.RENDER.COLOR_DYING;

        this.gridManager = null;
        this._dirtyCells = new Set();

        this._activityCooldown = AppConfig.RENDER.ACTIVITY_COOLDOWN;
        this._activityAges = null;
        this._dyingAges = null;
        this._coolingCells = new Set();
        this._dyingCells = new Set();
        this._pathCache = new Map();
        this._cachedCellSize = 0;
        this._isFirstRender = true;

        // Offscreen canvas de grilla — construido una sola vez, blitado O(1) por frame
        this._gridOffscreen = null;
        this._gridOffscreenCtx = null;
        this._gridDirty = true;
    }

    setGridManager(gridManager) {
        this.gridManager = gridManager;
        this._rebuildPathCache();
        this._resizeCanvas();
        this._allocActivityArrays();
        this._gridDirty = true;
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
        // Solo actualizar cellSize si se pasa explícitamente.
        // Cuando se llama solo con gridSize (resize de grid sin cambio de zoom),
        // se preserva el cellSize actual del renderer.
        if (cellSize) this.cellSize = cellSize;
        this._rebuildPathCache();
        if (this.gridManager) {
            this._resizeCanvas();
            this._allocActivityArrays();
            this._gridDirty = true;
            this._isFirstRender = true;
            this.markAllDirty();
        }
    }

    _resizeCanvas() {
        if (!this.gridManager) return;

        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;

        // Dimensiones geométricas del bitmap (base para render y getCellFromMouse)
        const width = (this.gridManager.width - 1) * (size / 2) + size;
        const height = (this.gridManager.height - 1) * h + h;

        this.canvas.width = Math.ceil(width);
        this.canvas.height = Math.ceil(height);

        // El CSS refleja el bitmap exactamente (sin stretch).
        // fittedCellSize en special-engine-manager se calcula para que bitmapH ≈ origH,
        // por lo que el canvas llena el espacio sin escalar y los triángulos son equiláteros.
        // autoSizeGrid usa gh = floor(availH / (√3/2 × cs)) para la misma garantía.
        this.canvas.style.width = this.canvas.width + 'px';
        this.canvas.style.height = this.canvas.height + 'px';

        if (this.container) {
            this.container.style.width = (this.canvas.width + 20) + 'px';
            this.container.style.height = (this.canvas.height + 20) + 'px';
        }

        this._gridDirty = true;
    }

    render(options = {}) {
        if (!this.gridManager) return;

        // TriangleRenderer siempre usa _renderFull: la geometría triangular hace que
        // el dirty render produzca artefactos de borde inevitables (los bounding boxes
        // de triángulos adyacentes se solapan, el stroke no coincide con la grilla real,
        // y el antialiasing sangra fuera del path). _renderFull con offscreen blit
        // es O(cols×rows) fills + O(1) drawImage — suficientemente eficiente.
        this._renderFull();
        this._isFirstRender = false;
        this._dirtyCells.clear();
    }

    _renderFull() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Fondo
        ctx.fillStyle = this.colorDead;
        ctx.fillRect(0, 0, width, height);

        // Grid de fondo — blit del offscreen, O(1) por frame
        if (this.showGrid) {
            if (this._gridDirty) this._buildGridOffscreen();
            if (this._gridOffscreen) ctx.drawImage(this._gridOffscreen, 0, 0);
        }

        // setTransform (1 call) en lugar de save/translate/restore (3 calls).
        // Coordenadas inline en lugar de toCartesian() — sin allocación de objeto por celda.
        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;
        const w = size / 2;
        const gm = this.gridManager;
        const cols = gm.width, rows = gm.height;
        const pathUp = this._pathCache.get('up');
        const pathDown = this._pathCache.get('down');

        for (let r = 0; r < rows; r++) {
            const py = r * h;
            for (let q = 0; q < cols; q++) {
                const color = this._cellColor(q, r, gm.grid[q][r]);
                if (!color) continue;

                ctx.fillStyle = color;
                ctx.setTransform(1, 0, 0, 1, q * w, py);
                ctx.fill(((q + r) & 1) === 0 ? pathUp : pathDown);
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /**
     * Construye el offscreen canvas de grilla triangular.
     *
     * Coordenadas reales (toCartesian): celda (q,r) → translate(q×w, r×h), w=size/2
     *   △UP  paths:   top=(w,0), bl=(0,h), br=(2w,h)
     *   △DOWN paths:  tl=(0,0),  tr=(2w,0), bot=(w,h)
     *
     * Las 3 familias de aristas son continuas (sin gaps):
     *
     *   H  — Horizontales: y = r×h  para r=0..rows
     *         (top de UP y DOWN de cada fila, coincide con bot del row anterior)
     *
     *   ↙  — Diagonal slope −√3 (top→bot-left de △UP):  x + y/√3 = xi = k×w
     *         k ∈ [1, ceil((cw + ch/√3) / w)]
     *         moveTo(xi, 0) → lineTo(xi − ch/√3, ch)
     *
     *   ↘  — Diagonal slope +√3 (top→bot-right de △UP):  x − y/√3 = xi = k×w
     *         k ∈ [ceil(−ch/√3 / w), floor(cw / w)]
     *         moveTo(xi, 0) → lineTo(xi + ch/√3, ch)
     *
     * Canvas recorta automáticamente → moveTo siempre en y=0, sin clipping manual.
     * Coste: O(cols + rows) líneas, 3 strokes. Coste por frame: O(1) via drawImage.
     */
    _buildGridOffscreen() {
        if (!this.gridManager) return;

        const cw = this.canvas.width;
        const ch = this.canvas.height;

        if (!this._gridOffscreen) {
            this._gridOffscreen = document.createElement('canvas');
            this._gridOffscreenCtx = this._gridOffscreen.getContext('2d', {alpha: true});
        }
        if (this._gridOffscreen.width !== cw || this._gridOffscreen.height !== ch) {
            this._gridOffscreen.width = cw;
            this._gridOffscreen.height = ch;
        }

        const octx = this._gridOffscreenCtx;
        octx.clearRect(0, 0, cw, ch);

        if (!this.showGrid) {
            this._gridDirty = false;
            return;
        }

        const size = this.cellSize;
        const h = size * Math.sqrt(3) / 2;
        const w = size / 2;
        const SQRT3 = Math.sqrt(3);
        const rows = this.gridManager.height;

        octx.strokeStyle = this.colorGrid;
        octx.lineWidth = 0.5;

        // ── Familia H: horizontales y = r×h ──────────────────────────────
        octx.beginPath();
        for (let r = 0; r <= rows; r++) {
            const y = r * h;
            if (y > ch) break;
            octx.moveTo(0, y);
            octx.lineTo(cw, y);
        }
        octx.stroke();

        // ── Familia ↙: slope −√3, x + y/√3 = k×w ────────────────────────
        // Solo k impares — las aristas reales tienen k=q+r+1 (UP, q+r par→k impar)
        // y k=q+r+2 (DOWN, q+r impar→k impar). Los k pares son líneas espurias.
        {
            const kMax = Math.ceil((cw + ch / SQRT3) / w);
            octx.beginPath();
            for (let k = 1; k <= kMax; k += 2) {
                const xi = k * w;
                octx.moveTo(xi, 0);
                octx.lineTo(xi - ch / SQRT3, ch);
            }
            octx.stroke();
        }

        // ── Familia ↘: slope +√3, x − y/√3 = k×w ────────────────────────
        // Solo k impares — k=q−r+1 (UP, q+r par→k impar) y k=q−r (DOWN, q+r impar→k impar).
        {
            const kMin = Math.ceil(-ch / SQRT3 / w);
            const kMax = Math.floor(cw / w);
            const kStart = (kMin % 2 !== 0) ? kMin : kMin + 1;  // primer k impar
            octx.beginPath();
            for (let k = kStart; k <= kMax; k += 2) {
                const xi = k * w;
                octx.moveTo(xi, 0);
                octx.lineTo(xi + ch / SQRT3, ch);
            }
            octx.stroke();
        }

        this._gridDirty = false;
    }

    _renderDirty() {
        const ctx = this.ctx;
        const size = this.cellSize;
        const pathUp = this._pathCache.get('up');
        const pathDown = this._pathCache.get('down');
        const gm = this.gridManager;

        ctx.lineWidth = 0.5;

        for (const packed of this._dirtyCells) {
            const q = packed >>> 16;
            const r = packed & 0xFFFF;

            const state = gm.grid[q][r];
            const color = this._cellColor(q, r, state);
            const pos = gm.toCartesian(q, r, size);
            const path = pos.orientation === 'up' ? pathUp : pathDown;

            ctx.fillStyle = color ?? this.colorDead;
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.fill(path);
            // stroke(path) con Path2D explícito — ctx.stroke() sin argumento usaría
            // el current path del contexto (incorrecto), no el Path2D del fill.
            ctx.strokeStyle = this.colorDead;
            ctx.stroke(path);
            if (this.showGrid) {
                ctx.strokeStyle = this.colorGrid;
                ctx.stroke(path);
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
        this._gridDirty = true;
        this._isFirstRender = true;
        this.markAllDirty();
        return this.showGrid;
    }

    /**
     * Stub de compatibilidad con GridRenderer.toggleGridHighlights().
     * El renderer triangular no diferencia entre grilla simple y resaltada
     * (no tiene concepto de líneas mayores/menores), por lo que esta operación
     * es un no-op que devuelve false para indicar que el estado no cambió.
     * @returns {boolean} false — sin estado que conmutar
     */
    toggleGridHighlights() {
        return false;
    }

    getCellFromMouse(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        return this.gridManager.fromCartesian(x, y, this.cellSize);
    }

    _cellColor(q, r, alive) {
        if (!this.showActivityEffect || this.destroboscope) return alive ? this.colorAlive : null;
        const idx = q * this.gridManager.height + r;
        const cooldown = this._activityCooldown;
        if (alive) return this._activityAges[idx] < cooldown ? this.colorBorn : this.colorAlive;
        return this._dyingAges[idx] < cooldown ? this.colorDying : null;
    }

    _allocActivityArrays() {
        if (!this.gridManager) return;
        const total = this.gridManager.width * this.gridManager.height;
        const cooldown = this._activityCooldown;
        this._activityAges = new Uint8Array(total).fill(cooldown);
        this._dyingAges = new Uint8Array(total).fill(cooldown);
        this._coolingCells.clear();
        this._dyingCells.clear();
    }

    /**
     * Avanza contadores de actividad.
     * Acepta packed ints (q<<16|r) de _stepSync, o {x,y} del worker.
     * _activityAges usa índice plano (q*rows+r).
     * _dirtyCells usa formato (q<<16)|r para compatibilidad con _renderDirty.
     */
    updateActivityAges(changedCells) {
        if (!this.gridManager || !this._activityAges || !changedCells?.length) return;

        const cooldown = this._activityCooldown;
        const rows = this.gridManager.height;
        const total = this.gridManager.width * rows;
        const grid = this.gridManager.grid;

        // Si más del 20% del grid cambió, el tracking de actividad es costoso
        // (sets O(N)) y visualmente poco significativo — saltearlo este frame.
        if (changedCells.length > total * 0.2) {
            this._coolingCells.clear();
            this._dyingCells.clear();
            return;
        }

        for (let i = 0; i < changedCells.length; i++) {
            const cell = changedCells[i];
            const q = (typeof cell === 'object') ? cell.x : (cell >>> 16);
            const r = (typeof cell === 'object') ? cell.y : (cell & 0xFFFF);
            const idx = q * rows + r;

            if (grid[q]?.[r]) {
                this._activityAges[idx] = 0;
                this._coolingCells.add(idx);
                this._dyingAges[idx] = cooldown;
                this._dyingCells.delete(idx);
            } else {
                this._dyingAges[idx] = 0;
                this._dyingCells.add(idx);
                this._activityAges[idx] = cooldown;
                this._coolingCells.delete(idx);
            }
        }

        for (const idx of this._coolingCells) {
            this._activityAges[idx]++;
            if (this._activityAges[idx] >= cooldown) {
                this._coolingCells.delete(idx);
                const q = (idx / rows) | 0, r = idx % rows;
                this._dirtyCells.add((q << 16) | r);
            }
        }

        for (const idx of this._dyingCells) {
            this._dyingAges[idx]++;
            if (this._dyingAges[idx] >= cooldown) {
                this._dyingCells.delete(idx);
                const q = (idx / rows) | 0, r = idx % rows;
                this._dirtyCells.add((q << 16) | r);
            }
        }
    }

    resetActivity() {
        if (this._activityAges) this._activityAges.fill(this._activityCooldown);
        if (this._dyingAges) this._dyingAges.fill(this._activityCooldown);
        this._coolingCells.clear();
        this._dyingCells.clear();
        this._isFirstRender = true;
        this.markAllDirty();
    }

    getConfig(key) {
        if (key === 'showGrid') return this.showGrid;
        if (key === 'showActivityEffect') return this.showActivityEffect;
        if (key === 'destroboscope') return this.destroboscope;
        return undefined;
    }

    setConfig(key, value) {
        if (key === 'showGrid') {
            this.showGrid = value;
            this._gridDirty = true;
            this._isFirstRender = true;
            this.markAllDirty();
        } else if (key === 'showActivityEffect') {
            this.showActivityEffect = value;
            if (!value) this.resetActivity();
            this._isFirstRender = true;
        } else if (key === 'destroboscope') {
            this.destroboscope = value;
            this.resetActivity();
            this._isFirstRender = true;
        }
    }

    destroy() {
        this.gridManager = null;
        this._activityAges = null;
        this._dyingAges = null;
        this._gridOffscreen = null;
        this._gridOffscreenCtx = null;
        this._coolingCells.clear();
        this._dyingCells.clear();
        this._dirtyCells.clear();
        this._pathCache.clear();
    }
}

window.TriangleRenderer = TriangleRenderer;