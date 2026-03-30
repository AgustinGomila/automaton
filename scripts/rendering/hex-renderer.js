/**
 * HexRenderer — Renderer Canvas 2D para grids hexagonales (pointy-top, odd-r).
 *
 * Estrategia de render idéntica a TriangleRenderer:
 *   - Full render cuando la fracción de celdas sucias supera FULL_RENDER_THRESHOLD.
 *   - Dirty render para actualizaciones parciales — redibuja solo las celdas cambiadas.
 *   - Path2D cacheado por cellSize — reconstruido solo al cambiar el zoom.
 *
 * Efecto de actividad (showActivityEffect):
 *   Cuando está activo, las celdas se colorean según su estado de transición:
 *     born  (0→1): colorBorn   durante ACTIVITY_COOLDOWN generaciones
 *     alive (1→1): colorAlive  (estado neutro)
 *     dying (1→0): colorDying  durante ACTIVITY_COOLDOWN generaciones
 *   Se mantienen dos arrays paralelos Uint8Array: _activityAges y _dyingAges.
 *   La lógica es idéntica a GridRenderer.updateActivityAges.
 *
 * Grilla — offscreen canvas (sin DOM):
 *   Se construye una sola vez por resize/zoom/toggle en _buildGridOffscreen().
 *   En cada _renderFull() se blita con drawImage() — O(1) por frame.
 *   Las aristas se representan con 3 familias de líneas rectas intermitentes:
 *     A) Verticales  x = n×halfW
 *     B) Diagonal ↘  x − y√3 = n×halfW  (n impar)
 *     C) Diagonal ↗  x + y√3 = n×halfW  (n impar)
 *   → O(cols + rows) líneas totales, cero costo por frame.
 *
 * Geometría (pointy-top, radio = size):
 *   w_celda  = size × √3
 *   paso_v   = size × 1.5
 *   offset_r_impar = w/2
 *
 * Canvas:
 *   canvasW = cols × w + w/2
 *   canvasH = rows × stepV + size × 0.5
 */
class HexRenderer {

    /**
     * @param {Object}  options
     * @param {HTMLCanvasElement} options.canvas
     * @param {HTMLElement|null}  options.container
     * @param {number}  options.cellSize        — radio del hexágono
     * @param {boolean} [options.showGrid]
     * @param {boolean} [options.showActivityEffect]
     * @param {string}  [options.colorAlive]
     * @param {string}  [options.colorDead]
     * @param {string}  [options.colorGrid]
     * @param {string}  [options.colorBorn]
     * @param {string}  [options.colorDying]
     */
    constructor(options) {
        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d', {alpha: false});
        this.container = options.container;
        this.cellSize = options.cellSize || 8;

        this.showGrid = options.showGrid !== false;
        this.showActivityEffect = options.showActivityEffect !== false;

        this.colorAlive = options.colorAlive || '#10b981';
        this.colorDead = options.colorDead || '#0f172a';
        this.colorGrid = options.colorGrid || 'rgba(255,255,255,0.08)';
        this.colorBorn = options.colorBorn || AppConfig.RENDER.COLOR_BORN;
        this.colorDying = options.colorDying || AppConfig.RENDER.COLOR_DYING;

        this.gridManager = null;
        this._dirtyCells = new Set();
        this._isFirstRender = true;

        // Actividad — mismo modelo que GridRenderer
        this._activityCooldown = AppConfig.RENDER.ACTIVITY_COOLDOWN;
        this._activityAges = null;   // Uint8Array: edad de nacimiento (0 = recién nacida)
        this._dyingAges = null;   // Uint8Array: edad de muerte     (0 = recién muerta)
        this._coolingCells = new Set();
        this._dyingCells = new Set();

        // Path2D y offsets de vértices cacheados por cellSize
        this._hexPath = null;
        this._cachedSize = 0;
        this._vx = null;   // Float64Array[6] — offsets X de los 6 vértices
        this._vy = null;   // Float64Array[6] — offsets Y de los 6 vértices
        this._geom = null;

        // Offscreen canvas de grilla — construido una sola vez, blitado O(1) por frame
        this._gridOffscreen = null;
        this._gridOffscreenCtx = null;
        this._gridDirty = true;
    }

    // ─── API pública ──────────────────────────────────────────────────────

    setGridManager(gm) {
        this.gridManager = gm;
        this._rebuildPath();
        this._resizeCanvas();
        this._allocActivityArrays();
        this._gridDirty = true;
        this._isFirstRender = true;
        this.markAllDirty();
    }

    resize(gw, gh, cellSize) {
        if (cellSize !== undefined) this.cellSize = cellSize;
        this._rebuildPath();
        if (this.gridManager) {
            this._resizeCanvas();
            this._allocActivityArrays();
            this._gridDirty = true;
            this._isFirstRender = true;
            this.markAllDirty();
        }
    }

    markAllDirty() {
        if (!this.gridManager) return;
        const total = this.gridManager.width * this.gridManager.height;
        for (let i = 0; i < total; i++) this._dirtyCells.add(i);
    }

    markDirty(col, row) {
        if (!this.gridManager) return;
        this._dirtyCells.add(col * this.gridManager.height + row);
    }

    getConfig(key) {
        if (key === 'showGrid') return this.showGrid;
        if (key === 'showActivityEffect') return this.showActivityEffect;
        return false;
    }

    setConfig(key, value) {
        if (key === 'showGrid') {
            this.showGrid = value;
            this._gridDirty = true;
            this._isFirstRender = true;
        } else if (key === 'showActivityEffect') {
            this.showActivityEffect = value;
            if (!value) this.resetActivity();
            this._isFirstRender = true;
        }
    }

    /**
     * Avanza los contadores de actividad para las celdas que cambiaron de estado.
     * Recibe Array<{x, y}> desde HexEngine._stepSync / _stepWorker.
     * Lógica idéntica a GridRenderer.updateActivityAges.
     */
    updateActivityAges(changedCells) {
        if (!this.gridManager || !this._activityAges) return;

        const cooldown = this._activityCooldown;
        const rows = this.gridManager.height;
        const grid = this.gridManager.grid;

        for (const {x, y} of changedCells) {
            const idx = x * rows + y;
            if (grid[x]?.[y]) {
                // Nació: edad de nacimiento a 0, cancelar muerte pendiente
                this._activityAges[idx] = 0;
                this._coolingCells.add(idx);
                this._dyingAges[idx] = cooldown;
                this._dyingCells.delete(idx);
            } else {
                // Murió: edad de muerte a 0, cancelar nacimiento pendiente
                this._dyingAges[idx] = 0;
                this._dyingCells.add(idx);
                this._activityAges[idx] = cooldown;
                this._coolingCells.delete(idx);
            }
        }

        // Avanzar cooldown de nacimientos
        for (const idx of this._coolingCells) {
            this._activityAges[idx]++;
            if (this._activityAges[idx] >= cooldown) {
                this._coolingCells.delete(idx);
                this._dirtyCells.add(idx);
            }
        }

        // Avanzar cooldown de muertes
        for (const idx of this._dyingCells) {
            this._dyingAges[idx]++;
            if (this._dyingAges[idx] >= cooldown) {
                this._dyingCells.delete(idx);
                this._dirtyCells.add(idx);
            }
        }
    }

    resetActivity() {
        if (this._activityAges) this._activityAges.fill(this._activityCooldown);
        if (this._dyingAges) this._dyingAges.fill(this._activityCooldown);
        this._coolingCells.clear();
        this._dyingCells.clear();
        this.markAllDirty();
    }

    render(options = {}) {
        if (!this.gridManager) return;
        if (!this._geom || !this._hexPath) this._rebuildPath();
        if (!this._geom) return;

        const total = this.gridManager.width * this.gridManager.height;
        const force = options.force || this._isFirstRender
            || this._dirtyCells.size > total * 0.3;

        if (force) {
            this._renderFull();
            this._isFirstRender = false;
        } else {
            this._renderDirty();
        }
        this._dirtyCells.clear();
    }

    // ─── Render ───────────────────────────────────────────────────────────

    _renderFull() {
        if (!this.ctx || !this._geom) return;

        const ctx = this.ctx;
        const {w, stepV, halfW} = this._geom;
        const rows = this.gridManager.height;
        const cols = this.gridManager.width;
        const grid = this.gridManager.grid;

        // 1. Fondo
        ctx.fillStyle = this.colorDead;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 2. Celdas — color según estado de actividad si está activo
        for (let c = 0; c < cols; c++) {
            const col = grid[c];
            for (let r = 0; r < rows; r++) {
                const color = this._cellColor(c, r, col[r]);
                if (color) {
                    ctx.fillStyle = color;
                    this._fillCell(ctx, c, r, w, stepV, halfW);
                }
            }
        }

        // 3. Grilla — blit del offscreen (O(1) por frame)
        if (this.showGrid) {
            if (this._gridDirty) this._buildGridOffscreen();
            if (this._gridOffscreen) ctx.drawImage(this._gridOffscreen, 0, 0);
        }
    }

    _renderDirty() {
        if (!this.ctx || !this._geom) return;

        const ctx = this.ctx;
        const {w, stepV, halfW} = this._geom;
        const rows = this.gridManager.height;
        const cols = this.gridManager.width;
        const grid = this.gridManager.grid;

        ctx.lineWidth = 0.6;

        for (const idx of this._dirtyCells) {
            const c = (idx / rows) | 0;
            const r = idx % rows;
            if (c >= cols || r >= rows) continue;
            this._drawCellDirty(ctx, c, r, grid[c][r], w, stepV, halfW);
        }
    }

    // ─── Helpers de color y dibujado ──────────────────────────────────────

    /**
     * Retorna el color de relleno para una celda según su estado de actividad.
     * Devuelve null para celdas muertas y sin efecto dying activo.
     */
    _cellColor(c, r, alive) {
        if (!this.showActivityEffect) {
            return alive ? this.colorAlive : null;
        }
        const idx = c * this.gridManager.height + r;
        const cooldown = this._activityCooldown;
        if (alive) {
            return this._activityAges[idx] < cooldown ? this.colorBorn : this.colorAlive;
        }
        return this._dyingAges[idx] < cooldown ? this.colorDying : null;
    }

    /**
     * Rellena una celda en _renderFull — solo fill, sin stroke.
     * Sin save/restore: calcula coordenadas absolutas con _vx/_vy.
     */
    _fillCell(ctx, c, r, w, stepV, halfW) {
        const offset = (r & 1) ? halfW : 0;
        const cx = c * w + offset + halfW;
        const cy = r * stepV + this._geom.size;
        const vx = this._vx, vy = this._vy;

        ctx.beginPath();
        ctx.moveTo(cx + vx[0], cy + vy[0]);
        ctx.lineTo(cx + vx[1], cy + vy[1]);
        ctx.lineTo(cx + vx[2], cy + vy[2]);
        ctx.lineTo(cx + vx[3], cy + vy[3]);
        ctx.lineTo(cx + vx[4], cy + vy[4]);
        ctx.lineTo(cx + vx[5], cy + vy[5]);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Redibuja una celda sucia en _renderDirty: fill con color correcto + stroke de grilla.
     */
    _drawCellDirty(ctx, c, r, alive, w, stepV, halfW) {
        const color = this._cellColor(c, r, alive);
        ctx.fillStyle = color ?? this.colorDead;

        const offset = (r & 1) ? halfW : 0;
        const cx = c * w + offset + halfW;
        const cy = r * stepV + this._geom.size;
        const vx = this._vx, vy = this._vy;

        ctx.beginPath();
        ctx.moveTo(cx + vx[0], cy + vy[0]);
        ctx.lineTo(cx + vx[1], cy + vy[1]);
        ctx.lineTo(cx + vx[2], cy + vy[2]);
        ctx.lineTo(cx + vx[3], cy + vy[3]);
        ctx.lineTo(cx + vx[4], cy + vy[4]);
        ctx.lineTo(cx + vx[5], cy + vy[5]);
        ctx.closePath();
        ctx.fill();
        if (this.showGrid) {
            ctx.strokeStyle = this.colorGrid;
            ctx.stroke();
        }
    }

    // ─── Offscreen canvas de grilla ───────────────────────────────────────

    /**
     * Construye el offscreen canvas de grilla con 3 familias de líneas intermitentes.
     *
     * Familia A — Verticales    x = n×halfW
     * Familia B — Diagonal ↘   x − y√3 = n×halfW  (n impar)
     * Familia C — Diagonal ↗   x + y√3 = n×halfW  (n impar)
     *
     * setLineDash([size, 2×size]) con LDO=0 — válido porque t_v1 = 2×r×stepV
     * siempre es múltiplo del período 3×size. Canvas recorta automáticamente
     * trazos fuera de sus límites → moveTo siempre en y=0, sin clipping manual.
     *
     * Coste: O(cols + rows) líneas, construido solo en _gridDirty=true.
     */
    _buildGridOffscreen() {
        if (!this.gridManager || !this._geom) return;

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

        const {halfW, size} = this._geom;
        const SQRT3 = Math.sqrt(3);

        octx.strokeStyle = this.colorGrid;
        octx.lineWidth = 0.6;
        octx.setLineDash([size, 2 * size]);
        octx.lineDashOffset = 0;

        // ── Familia A: verticales x = n×halfW ────────────────────────────
        // n par   → primer seg en y = size/2   (filas pares)
        // n impar → primer seg en y = 2×size   (filas impares)
        octx.beginPath();
        const nMaxA = Math.ceil(cw / halfW) + 1;
        for (let n = 0; n <= nMaxA; n++) {
            const x = n * halfW;
            const yStart = (n & 1) ? 2 * size : size * 0.5;
            octx.moveTo(x, yStart);
            octx.lineTo(x, ch);
        }
        octx.stroke();

        // ── Familia B: diagonales ↘ (slope +1/√3) ────────────────────────
        // x − y√3 = n×halfW con n impar. LDO=0 garantizado con moveTo(xi, 0).
        {
            const nMin = Math.ceil(-ch * SQRT3 / halfW);
            const nMax = Math.floor(cw / halfW);
            const nStart = (nMin & 1) ? nMin : nMin + 1;
            octx.beginPath();
            for (let n = nStart; n <= nMax; n += 2) {
                const xi = n * halfW;
                octx.moveTo(xi, 0);
                octx.lineTo(xi + ch * SQRT3, ch);
            }
            octx.stroke();
        }

        // ── Familia C: diagonales ↗ (slope −1/√3) ────────────────────────
        // x + y√3 = n×halfW con n impar. Mismo argumento de LDO=0.
        {
            const nMin = 1;
            const nMax = Math.ceil((cw + ch * SQRT3) / halfW);
            const nStart = (nMin & 1) ? nMin : nMin + 1;
            octx.beginPath();
            for (let n = nStart; n <= nMax; n += 2) {
                const xi = n * halfW;
                octx.moveTo(xi, 0);
                octx.lineTo(xi - ch * SQRT3, ch);
            }
            octx.stroke();
        }

        octx.setLineDash([]);
        this._gridDirty = false;
    }

    // ─── Geometría y canvas ───────────────────────────────────────────────

    _rebuildPath() {
        if (this.cellSize === this._cachedSize && this._geom) return;

        const size = this.cellSize;
        const verts = HexGridManager.hexVertices(size);

        const path = new Path2D();
        path.moveTo(verts[0][0], verts[0][1]);
        for (let i = 1; i < 6; i++) path.lineTo(verts[i][0], verts[i][1]);
        path.closePath();
        this._hexPath = path;

        this._vx = new Float64Array(verts.map(v => v[0]));
        this._vy = new Float64Array(verts.map(v => v[1]));

        this._cachedSize = size;

        const w = size * Math.sqrt(3);
        const stepV = size * 1.5;
        this._geom = {size, w, stepV, halfW: w / 2};

        this._gridDirty = true;
    }

    _resizeCanvas() {
        if (!this.gridManager || !this._geom) return;

        const {w, stepV, size} = this._geom;
        const cols = this.gridManager.width;
        const rows = this.gridManager.height;

        const canvasW = Math.ceil(cols * w + w / 2);
        const canvasH = Math.ceil(rows * stepV + size * 0.5);

        this.canvas.width = canvasW;
        this.canvas.height = canvasH;
        this.canvas.style.width = canvasW + 'px';
        this.canvas.style.height = canvasH + 'px';

        if (this.ctx) {
            this.ctx.fillStyle = this.colorDead;
            this.ctx.fillRect(0, 0, canvasW, canvasH);
        }

        if (this.container) {
            this.container.style.width = (canvasW + 20) + 'px';
            this.container.style.height = (canvasH + 20) + 'px';
        }

        this._gridDirty = true;
    }

    /**
     * Reserva (o re-reserva) los arrays de actividad al tamaño actual del grid.
     * Se llama tras setGridManager y resize — ambos pueden cambiar cols×rows.
     */
    _allocActivityArrays() {
        if (!this.gridManager) return;
        const total = this.gridManager.width * this.gridManager.height;
        const cooldown = this._activityCooldown;
        this._activityAges = new Uint8Array(total).fill(cooldown);
        this._dyingAges = new Uint8Array(total).fill(cooldown);
        this._coolingCells.clear();
        this._dyingCells.clear();
    }

    // ─── Interfaz pública ─────────────────────────────────────────────────

    getCellFromMouse(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;
        return this.gridManager?.fromPixel(px, py, this.cellSize) ?? null;
    }

    // ─── Stubs de compatibilidad ──────────────────────────────────────────

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this._gridDirty = true;
        this._isFirstRender = true;
        this.markAllDirty();
        return this.showGrid;
    }

    toggleGridHighlights() {
        return false;
    }

    reGrid() {
        this._gridDirty = true;
        this._isFirstRender = true;
        this.markAllDirty();
        return this.showGrid;
    }

    resizeCanvas() { /* gestionado internamente */
    }

    markDirtyIndex(idx) {
        if (!this.gridManager) return;
        const rows = this.gridManager.height;
        this.markDirty((idx / rows) | 0, idx % rows);
    }

    destroy() {
        this._hexPath = null;
        this._gridOffscreen = null;
        this._gridOffscreenCtx = null;
        this._activityAges = null;
        this._dyingAges = null;
        this._coolingCells.clear();
        this._dyingCells.clear();
        this._dirtyCells.clear();
        this.gridManager = null;
        this.ctx = null;
    }
}

window.HexRenderer = HexRenderer;