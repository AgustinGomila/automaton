/**
 * HexRenderer — Renderer Canvas 2D para grids hexagonales (pointy-top, odd-r).
 *
 * Estrategia de render idéntica a TriangleRenderer:
 *   - Full render cuando la fracción de celdas sucias supera FULL_RENDER_THRESHOLD.
 *   - Dirty render para actualizaciones parciales — redibuja solo las celdas cambiadas.
 *   - Path2D cacheado por cellSize — reconstruido solo al cambiar el zoom.
 *
 * Grilla — offscreen canvas (sin DOM):
 *   Se construye una sola vez por resize/zoom/toggle en _buildGridOffscreen().
 *   En cada _renderFull() se blita con drawImage() — O(1) por frame.
 *   En _renderDirty() cada celda sucia re-strokea solo su propio contorno.
 *
 * Geometría (pointy-top, radio = size):
 *   w_celda  = size × √3
 *   h_celda  = size × 2
 *   paso_v   = size × 1.5      (solapamiento vertical entre filas)
 *   offset_r_impar = w/2       (desplazamiento horizontal filas impares)
 *
 * Canvas:
 *   canvasW = cols × w_celda + w_celda/2   (filas impares sobresalen medio hex)
 *   canvasH = rows × paso_v + size × 0.5   (media celda en la última fila)
 */
class HexRenderer {

    /**
     * @param {Object}  options
     * @param {HTMLCanvasElement} options.canvas
     * @param {HTMLElement|null}  options.container
     * @param {number}  options.cellSize   — radio del hexágono
     * @param {boolean} [options.showGrid=true]
     * @param {string}  [options.colorAlive]
     * @param {string}  [options.colorDead]
     * @param {string}  [options.colorGrid]
     */
    constructor(options) {
        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d', {alpha: false});
        this.container = options.container;
        this.cellSize = options.cellSize || 8;
        this.showGrid = options.showGrid !== false;
        this.colorAlive = options.colorAlive || '#10b981';
        this.colorDead = options.colorDead || '#0f172a';
        this.colorGrid = options.colorGrid || 'rgba(255,255,255,0.08)';

        this.gridManager = null;
        this._dirtyCells = new Set();   // índices planos col*rows+row
        this._isFirstRender = true;

        // Path2D del hexágono unitario, cacheado por cellSize
        this._hexPath = null;
        this._cachedSize = 0;

        // Offscreen canvas para la grilla — dibujado una sola vez, blitado por frame
        this._gridOffscreen = null;    // HTMLCanvasElement fuera del DOM
        this._gridOffscreenCtx = null;
        this._gridDirty = true;    // true → rebuild antes del próximo render

        // Vértices del hexágono relativos al centro (se recalculan con cellSize)
        this._vx = null;   // Float64Array[6]
        this._vy = null;   // Float64Array[6]

        // Constantes geométricas derivadas de cellSize
        this._geom = null;
    }

    // ─── API pública ──────────────────────────────────────────────────────

    setGridManager(gm) {
        this.gridManager = gm;
        this._rebuildPath();
        this._resizeCanvas();
        this._gridDirty = true;
        this._isFirstRender = true;
        this.markAllDirty();
    }

    resize(gw, gh, cellSize) {
        if (cellSize !== undefined) this.cellSize = cellSize;
        this._rebuildPath();
        if (this.gridManager) {
            this._resizeCanvas();
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

    updateActivityAges(changedCells) {
        for (const {x, y} of changedCells) this.markDirty(x, y);
    }

    getConfig(key) {
        if (key === 'showGrid') return this.showGrid;
        return false;
    }

    setConfig(key, value) {
        if (key === 'showGrid') {
            this.showGrid = value;
            this._gridDirty = true;
            this._isFirstRender = true;
        }
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

    /**
     * Render completo: fondo → celdas vivas → grilla.
     * La grilla se blita desde el offscreen canvas (O(1)) — se reconstruye
     * solo cuando _gridDirty=true (resize, zoom, toggle).
     */
    _renderFull() {
        if (!this.ctx || !this._geom || !this._hexPath) return;

        const ctx = this.ctx;
        const {w, stepV, halfW} = this._geom;
        const rows = this.gridManager.height;
        const cols = this.gridManager.width;
        const grid = this.gridManager.grid;

        // 1. Fondo
        ctx.fillStyle = this.colorDead;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 2. Celdas vivas — solo fill, sin stroke individual
        ctx.fillStyle = this.colorAlive;
        for (let c = 0; c < cols; c++) {
            const col = grid[c];
            for (let r = 0; r < rows; r++) {
                if (col[r]) this._fillCell(ctx, c, r, w, stepV, halfW);
            }
        }

        // 3. Grilla sobre todo — blit del offscreen (O(1) por frame)
        if (this.showGrid) {
            if (this._gridDirty) this._buildGridOffscreen();
            if (this._gridOffscreen) {
                ctx.drawImage(this._gridOffscreen, 0, 0);
            }
        }
    }

    /**
     * Render parcial: solo redibuja las celdas marcadas como sucias.
     * Para cada celda: fill de fondo o color vivo, luego re-stroke del contorno.
     */
    _renderDirty() {
        if (!this.ctx || !this._geom || !this._hexPath) return;

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

            if (grid[c][r]) {
                ctx.fillStyle = this.colorAlive;
                ctx.strokeStyle = this.colorGrid;
                this._drawCell(ctx, c, r, w, stepV, halfW);
            } else {
                // Borrar la celda muerta: fill con colorDead + restituir contorno
                ctx.fillStyle = this.colorDead;
                ctx.strokeStyle = this.colorGrid;
                this._drawCell(ctx, c, r, w, stepV, halfW);
            }
        }
    }

    // ─── Helpers de dibujado ──────────────────────────────────────────────

    /**
     * Rellena un hexágono sin stroke — usado en _renderFull para celdas vivas.
     * Sin save/restore: aplica la traslación sobre los vértices absolutos.
     */
    _fillCell(ctx, c, r, w, stepV, halfW) {
        const offset = (r & 1) === 1 ? halfW : 0;
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
     * Dibuja un hexágono con fill Y stroke — usado en _renderDirty.
     * El fill limpia el área; el stroke restaura el contorno de grilla.
     */
    _drawCell(ctx, c, r, w, stepV, halfW) {
        const offset = (r & 1) === 1 ? halfW : 0;
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
        if (this.showGrid) ctx.stroke();
    }

    // ─── Offscreen canvas de grilla ───────────────────────────────────────

    /**
     * Construye el offscreen canvas de grilla con líneas rectas intermitentes.
     *
     * En lugar de dibujar N contornos hexagonales (O(cols×rows)), la grilla
     * completa se representa con 3 familias de líneas rectas — análogo exacto
     * a la grilla rectangular (horizontales + verticales) pero con tres direcciones.
     *
     * Las aristas de la malla hex forman segmentos colineales en:
     *   Familia A — verticales    x = n×halfW       n entero (0..2·cols+1)
     *   Familia B — diagonales ↘  x − y√3 = n×halfW  n impar
     *   Familia C — diagonales ↗  x + y√3 = n×halfW  n impar
     *
     * Todas usan setLineDash([size, 2×size]) — dash=arista, gap=2×aristas —
     * con LDO=0 (el offset se resetea en cada moveTo según la spec Canvas2D).
     * La única diferencia es el y_start por subfamilia de A:
     *   n par  (bordes de filas pares):   moveTo(x, size/2)
     *   n impar (bordes de filas impares): moveTo(x, 2×size)
     *
     * Coste de construcción: O(cols + rows) — igual que la grilla rectangular.
     * Coste por frame:        O(1) — drawImage del offscreen.
     */
    _buildGridOffscreen() {
        if (!this.gridManager || !this._geom) return;

        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // Crear o reciclar el offscreen canvas (fondo transparente para blit)
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
        octx.setLineDash([size, 2 * size]);   // dash=arista, gap=2×arista, período=3×size
        octx.lineDashOffset = 0;

        // ── Familia A: líneas verticales ──────────────────────────────────
        // x = n×halfW para n = 0, 1, 2, ..., 2·cols+1
        // n par   → arista de fila par,   primer segmento en y = size/2
        // n impar → arista de fila impar, primer segmento en y = 2·size
        // El lineDash offset se reinicia con cada moveTo → LDO=0 funciona para ambos.
        octx.beginPath();
        const nMaxA = Math.ceil(cw / halfW) + 1;
        for (let n = 0; n <= nMaxA; n++) {
            const x = n * halfW;
            const yStart = (n & 1) ? 2 * size : size * 0.5;
            octx.moveTo(x, yStart);
            octx.lineTo(x, ch);
        }
        octx.stroke();

        // ── Familia B: diagonales ↘ (slope +1/√3) ─────────────────────────
        // Ecuación de línea: x − y√3 = xi, donde xi = n×halfW con n impar.
        // Cada línea va desde (xi, 0) hacia (xi + ch×√3, ch).
        // LDO=0 es válido SOLO si moveTo parte de y=0 — Canvas recorta automáticamente
        // cualquier porción fuera del canvas, por lo que xi puede ser negativo.
        // Si se usara un moveTo en y>0 (clipping manual), el lineDash empezaría
        // en la posición incorrecta y los segmentos quedarían desfasados.
        {
            const nMin = Math.ceil(-ch * SQRT3 / halfW);
            const nMax = Math.floor(cw / halfW);
            const nStart = (nMin & 1) ? nMin : nMin + 1;
            octx.beginPath();
            for (let n = nStart; n <= nMax; n += 2) {
                const xi = n * halfW;
                octx.moveTo(xi, 0);                  // siempre y=0 → LDO=0 garantizado
                octx.lineTo(xi + ch * SQRT3, ch);
            }
            octx.stroke();
        }

        // ── Familia C: diagonales ↗ (slope −1/√3) ─────────────────────────
        // Ecuación de línea: x + y√3 = xi, donde xi = n×halfW con n impar.
        // Cada línea va desde (xi, 0) hacia (xi − ch×√3, ch).
        // Mismo argumento: moveTo siempre en y=0, Canvas recorta.
        // xi puede ser > cw sin problema.
        {
            const nMin = 1;
            const nMax = Math.ceil((cw + ch * SQRT3) / halfW);
            const nStart = (nMin & 1) ? nMin : nMin + 1;
            octx.beginPath();
            for (let n = nStart; n <= nMax; n += 2) {
                const xi = n * halfW;
                octx.moveTo(xi, 0);                  // siempre y=0 → LDO=0 garantizado
                octx.lineTo(xi - ch * SQRT3, ch);
            }
            octx.stroke();
        }

        octx.setLineDash([]);   // restaurar para futuros usos del contexto
        this._gridDirty = false;
    }

    // ─── Geometría y canvas ───────────────────────────────────────────────

    /**
     * Construye el Path2D del hexágono centrado en (0,0) y los arrays
     * de vértices absolutos (_vx/_vy) usados en _fillCell/_drawCell.
     * Se reconstruye solo cuando cellSize cambia.
     */
    _rebuildPath() {
        if (this.cellSize === this._cachedSize && this._geom) return;

        const size = this.cellSize;
        const verts = HexGridManager.hexVertices(size);

        // Path2D cacheado (para compatibilidad si alguien lo usa externamente)
        const path = new Path2D();
        path.moveTo(verts[0][0], verts[0][1]);
        for (let i = 1; i < 6; i++) path.lineTo(verts[i][0], verts[i][1]);
        path.closePath();
        this._hexPath = path;

        // Arrays de offsets para drawCell/fillCell sin save/translate/restore
        this._vx = new Float64Array(verts.map(v => v[0]));
        this._vy = new Float64Array(verts.map(v => v[1]));

        this._cachedSize = size;

        const w = size * Math.sqrt(3);
        const stepV = size * 1.5;
        this._geom = {size, w, stepV, halfW: w / 2};

        // Invalidar offscreen — el tamaño de los hexágonos cambió
        this._gridDirty = true;
    }

    _resizeCanvas() {
        if (!this.gridManager) return;
        if (!this._geom || !this._hexPath) this._rebuildPath();
        if (!this._geom) return;

        const {w, stepV, size} = this._geom;
        const cols = this.gridManager.width;
        const rows = this.gridManager.height;

        // Las filas impares desplazan media celda → ancho extra
        const canvasW = Math.ceil(cols * w + w / 2);
        const canvasH = Math.ceil(rows * stepV + size * 0.5);

        this.canvas.width = canvasW;
        this.canvas.height = canvasH;
        this.canvas.style.width = canvasW + 'px';
        this.canvas.style.height = canvasH + 'px';

        // Relleno inmediato para evitar flash de fondo CSS
        if (this.ctx) {
            this.ctx.fillStyle = this.colorDead;
            this.ctx.fillRect(0, 0, canvasW, canvasH);
        }

        if (this.container) {
            this.container.style.width = (canvasW + 20) + 'px';
            this.container.style.height = (canvasH + 20) + 'px';
        }

        // Invalidar el offscreen — las dimensiones del canvas cambiaron
        this._gridDirty = true;
    }

    /**
     * Convierte coordenadas de mouse (clientX, clientY) a celda hexagonal.
     */
    getCellFromMouse(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;
        return this.gridManager?.fromPixel(px, py, this.cellSize) ?? null;
    }

    // ─── Stubs de interfaz (compatibilidad con automaton.js) ─────────────

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

    resetActivity() {
        this._isFirstRender = true;
        this.markAllDirty();
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
        this._dirtyCells.clear();
        this.gridManager = null;
        this.ctx = null;
    }
}

window.HexRenderer = HexRenderer;