/**
 * GridRenderer — Renderizado visual del autómata celular sobre Canvas 2D.
 *
 * Soporta grids rectangulares (gridWidth × gridHeight).
 * Índice plano: x * gridHeight + y  (column-major, igual que GridManager).
 *
 * Compatibilidad hacia atrás: opción `gridSize` se acepta como cuadrado.
 */
class GridRenderer {
    /**
     * @param {Object}   options
     * @param {HTMLCanvasElement} options.canvas
     * @param {HTMLElement}       options.container
     * @param {Function} options.getCell       — (x, y) => 0|1
     * @param {Function} options.getRD2DState  — (x, y) => 0..15
     * @param {Function} options.isRD2DActive  — () => boolean
     * @param {Function} options.getGridWidth  — () => number
     * @param {Function} options.getGridHeight — () => number
     * @param {Function} [options.getGridSize] — legacy, () => number
     * @param {number}   [options.gridWidth]
     * @param {number}   [options.gridHeight]
     * @param {number}   [options.gridSize]    — legacy alias (cuadrado)
     * @param {number}   [options.cellSize]
     * @param {boolean}  [options.showGrid]
     * @param {boolean}  [options.showActivityEffect]
     * @param {boolean}  [options.showGridHighlights]
     * @param {number}   [options.gridMajorInterval]
     */
    constructor(options) {
        if (!options.canvas) throw new Error('GridRenderer: canvas requerido');
        if (typeof options.getCell !== 'function') throw new Error('GridRenderer: getCell requerido');

        // Soporte para dimensiones rectangulares y compatibilidad legacy
        const legacySize = options.gridSize || 200;
        if (!options.getGridWidth && typeof options.getGridSize === 'function') {
            options.getGridWidth = options.getGridSize;
            options.getGridHeight = options.getGridSize;
        }
        if (typeof options.getGridWidth !== 'function') throw new Error('GridRenderer: getGridWidth requerido');
        if (typeof options.getGridHeight !== 'function') throw new Error('GridRenderer: getGridHeight requerido');

        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d');
        this.container = options.container;

        this._getCell = options.getCell;
        this._getRD2DState = options.getRD2DState || (() => undefined);
        this._isRD2DActive = options.isRD2DActive || (() => false);
        this._getGridWidth = options.getGridWidth;
        this._getGridHeight = options.getGridHeight;

        this.config = {
            showGrid: options.showGrid !== false,
            showActivityEffect: options.showActivityEffect !== false,
            cellSize: Math.max(1, Math.min(options.cellSize || 4, 20)),
            gridWidth: Math.max(20, Math.min(options.gridWidth || legacySize, 1000)),
            gridHeight: Math.max(20, Math.min(options.gridHeight || legacySize, 1000)),
            /** Intervalo entre líneas de énfasis. 0 = desactivado. */
            gridMajorInterval: options.gridMajorInterval ?? 10,
            /** Mostrar líneas mayores de énfasis independientemente de showGrid. */
            showGridHighlights: options.showGridHighlights !== false
        };

        // Dirty rendering
        this._dirtyCells = new Set();
        this._fullDirtyPending = false;

        // Efecto de actividad
        this._coolingCells = new Set();
        this._dyingCells = new Set();
        this._activityCooldown = 3;
        this._initActivityBuffers();

        // Grilla sutil offscreen (cellSize=2)
        this._subtleGridCache = null;

        // Proveedor de color personalizado (LangtonEngine multi-color)
        this._colorProvider = null;

        // Colores configurables por estado
        this.colorDead = '#0f172a';  // 0→0
        this.colorBorn = '#b9b610';  // 0→1
        this.colorAlive = '#059669';  // 1→1
        this.colorDying = '#ef4444';  // 1→0

        this._resizeCanvas();
    }

    // =========================================
    // GETTERS DE CONVENIENCIA
    // =========================================

    /** Ancho lógico actual del grid (puede diferir de config si se sincronizó externamente). */
    get gridWidth() {
        return this.config.gridWidth;
    }

    get gridHeight() {
        return this.config.gridHeight;
    }

    _initActivityBuffers() {
        const total = this.config.gridWidth * this.config.gridHeight;
        this._activityAges = new Uint8Array(total).fill(this._activityCooldown);
        this._dyingAges = new Uint8Array(total).fill(this._activityCooldown);
    }

    get hasDirtyCells() {
        return this._fullDirtyPending || this._dirtyCells.size > 0;
    }

    get dirtyCount() {
        return this._dirtyCells.size;
    }

    // =========================================
    // MARCADO DE CELDAS SUCIAS
    // =========================================

    markDirty(x, y) {
        if (!this._fullDirtyPending) {
            this._dirtyCells.add(x * this.config.gridHeight + y);
        }
    }

    markDirtyIndex(index) {
        if (!this._fullDirtyPending) {
            this._dirtyCells.add(index);
        }
    }

    /**
     * Marca todo el grid para re-renderizado en O(1).
     * Las llamadas a markDirty posteriores se ignoran hasta que render() consuma el flag.
     */
    markAllDirty() {
        this._fullDirtyPending = true;
        this._dirtyCells.clear();
    }

    // =========================================
    // RENDER PRINCIPAL
    // =========================================

    render(options = {}) {
        if (!this._fullDirtyPending && this._dirtyCells.size === 0) return;

        // UMBRAL: Si más del 15% del grid está sucio, hacer render completo
        const totalCells = this.config.gridWidth * this.config.gridHeight;
        if (!this._fullDirtyPending && this._dirtyCells.size > totalCells * 0.15) {
            this._fullDirtyPending = true;
        }

        if (this._fullDirtyPending) {
            this._forceFullRender();
            this._fullDirtyPending = false;
        } else {
            this._renderDirtyCells();
        }

        this._dirtyCells.clear();
    }

    // =========================================
    // CONFIGURACIÓN
    // =========================================

    setConfig(key, value) {
        if (!(key in this.config)) {
            console.warn(`GridRenderer: config key "${key}" desconocida`);
            return false;
        }
        const oldValue = this.config[key];
        this.config[key] = value;

        if (key === 'showGrid' && oldValue !== value) {
            this._subtleGridCache = null;
            this.markAllDirty();
        }
        if (key === 'showGridHighlights' && oldValue !== value) {
            this._subtleGridCache = null;
            this.markAllDirty();
        }
        if (key === 'gridMajorInterval' && oldValue !== value) {
            this._subtleGridCache = null;
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
        this._subtleGridCache = null;
        return this.reGrid();
    }

    toggleGridHighlights() {
        this.config.showGridHighlights = !this.config.showGridHighlights;
        this._subtleGridCache = null;
        this.markAllDirty();
        return this.config.showGridHighlights;
    }

    /** Fuerza re-render completo y retorna el estado actual de showGrid. */
    reGrid() {
        this.markAllDirty();
        return this.config.showGrid;
    }

    /** Wrapper público de _resizeCanvas() para special-mode-controller. */
    resizeCanvas() {
        this._resizeCanvas();
    }

    /**
     * Redimensiona el renderer para un nuevo grid.
     * @param {number} gridWidth
     * @param {number} [gridHeight=gridWidth] — omitir para cuadrado
     * @param {number} [cellSize]             — omitir para no cambiar
     */
    resize(gridWidth, gridHeight = gridWidth, cellSize) {
        this.config.gridWidth = Math.max(20, Math.min(gridWidth, 1000));
        this.config.gridHeight = Math.max(20, Math.min(gridHeight, 1000));
        if (cellSize !== undefined) {
            this.config.cellSize = Math.max(1, Math.min(cellSize, 20));
        }

        this._initActivityBuffers();
        this._dirtyCells.clear();
        this._coolingCells.clear();
        this._dyingCells.clear();
        this._fullDirtyPending = false;
        this._subtleGridCache = null;

        this._resizeCanvas();
        this.markAllDirty();
    }

    // =========================================
    // EFECTO DE ACTIVIDAD
    // =========================================

    /**
     * Avanza los contadores de actividad.
     * Índice plano: x * gridHeight + y
     *
     * @param {Uint32Array|Array} changedBuffer — índices planos
     * @param {number}            [changedCount]
     */
    updateActivityAges(changedBuffer, changedCount) {
        const cooldown = this._activityCooldown;
        const gridHeight = this.config.gridHeight;
        const count = changedCount !== undefined ? changedCount : changedBuffer.length;

        for (let i = 0; i < count; i++) {
            const index = changedBuffer[i];
            const x = (index / gridHeight) | 0;
            const y = index % gridHeight;
            if (this._getCell(x, y)) {
                this._activityAges[index] = 0;
                this._coolingCells.add(index);
                this._dyingAges[index] = cooldown;
                this._dyingCells.delete(index);
            } else {
                this._dyingAges[index] = 0;
                this._dyingCells.add(index);
                this._activityAges[index] = cooldown;
                this._coolingCells.delete(index);
            }
        }

        // Avanzar cooldown de nacimientos
        for (const index of this._coolingCells) {
            this._activityAges[index]++;
            if (this._activityAges[index] >= cooldown) {
                this._coolingCells.delete(index);
                if (!this._fullDirtyPending) this._dirtyCells.add(index);
            }
        }

        // Avanzar cooldown de muertes
        for (const index of this._dyingCells) {
            this._dyingAges[index]++;
            if (this._dyingAges[index] >= cooldown) {
                this._dyingCells.delete(index);
                if (!this._fullDirtyPending) this._dirtyCells.add(index);
            }
        }
    }

    resetActivity() {
        this._coolingCells.clear();
        this._dyingCells.clear();
        this._activityAges.fill(this._activityCooldown);
        this._dyingAges.fill(this._activityCooldown);
        this.markAllDirty();
    }

    // =========================================
    // COLOR PROVIDER
    // =========================================

    setColorProvider(fn) {
        this._colorProvider = fn || null;
    }

    // =========================================
    // MOUSE → CELDA
    // =========================================

    getCellFromMouse(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / this.canvas.offsetWidth;
        const scaleY = this.canvas.height / this.canvas.offsetHeight;

        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        const {cellSize, gridWidth, gridHeight} = this.config;
        return {
            x: Math.max(0, Math.min(Math.floor(canvasX / cellSize), gridWidth - 1)),
            y: Math.max(0, Math.min(Math.floor(canvasY / cellSize), gridHeight - 1))
        };
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        this._dirtyCells.clear();
        this._coolingCells.clear();
        this._dyingCells.clear();
        this._subtleGridCache = null;
        this._activityAges = null;
        this._dyingAges = null;
        this._fullDirtyPending = false;
        this.ctx = null;
        this.canvas = null;
        this.container = null;
        this._getCell = null;
        this._getRD2DState = null;
        this._isRD2DActive = null;
        this._getGridWidth = null;
        this._getGridHeight = null;
    }

    // =========================================
    // RENDER INTERNO
    // =========================================

    _forceFullRender() {
        const {cellSize} = this.config;

        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Dibujar grilla desde cache offscreen (siempre, para ambos tamaños de celda)
        const gridCache = this._getGridCache();
        if (gridCache) {
            this.ctx.drawImage(gridCache, 0, 0);
        }

        this._drawCells((x, y) => this._getCell(x, y));
    }

    _renderDirtyCells() {
        const {gridHeight, cellSize} = this.config;
        const gridCache = this._getGridCache();

        for (const index of this._dirtyCells) {
            const x = (index / gridHeight) | 0;
            const y = index % gridHeight;
            const px = x * cellSize;
            const py = y * cellSize;

            if (gridCache) {
                // Con grilla: restaurar trozo del cache
                this.ctx.clearRect(px, py, cellSize, cellSize);
                this.ctx.drawImage(gridCache, px, py, cellSize, cellSize, px, py, cellSize, cellSize);
            } else {
                // Sin grilla: fondo oscuro
                this.ctx.fillStyle = this.colorDead;
                this.ctx.fillRect(px, py, cellSize, cellSize);
            }

            // Encima pintar la celda (solo si tiene actividad)
            this._renderCell(x, y);
        }
    }

    /**
     * Devuelve el canvas offscreen de grilla (crea/reconstruye si es necesario).
     * null si no hay nada que dibujar (grid y highlights ambos desactivados).
     */
    _getGridCache() {
        const {showGrid, showGridHighlights} = this.config;
        if (!showGrid && !showGridHighlights) return null;
        if (!this._subtleGridCache) this._buildGridCache();
        return this._subtleGridCache;
    }

    _renderCell(x, y) {
        const cellSize = this.config.cellSize;
        const cellIndex = x * this.config.gridHeight + y;
        const isAlive = this._getCell(x, y);

        if (this._isRD2DActive() && isAlive) {
            this._renderRD2DCell(x, y, cellSize, this._getRD2DState(x, y) || 0);
            return;
        }

        if (cellSize <= 3) {
            this._renderSmallCell(x, y, cellIndex, isAlive);
        } else {
            this._renderLargeCell(x, y, cellIndex, isAlive);
        }
    }

    // =========================================
    // COLOR DE CELDA
    // =========================================

    _getCellColor(cellIndex, isAlive) {
        if (!this.config.showActivityEffect) return isAlive ? this.colorAlive : null;
        const cooldown = this._activityCooldown;
        if (isAlive) {
            return this._activityAges[cellIndex] < cooldown ? this.colorBorn : this.colorAlive;
        }
        return this._dyingAges[cellIndex] < cooldown ? this.colorDying : null;
    }

    _renderSmallCell(x, y, cellIndex, isAlive) {
        const customColor = this._colorProvider?.(cellIndex) ?? null;
        const actColor = customColor ?? this._getCellColor(cellIndex, isAlive);

        if (actColor) {
            const cellSize = this.config.cellSize;
            const xPos = x * cellSize;
            const yPos = y * cellSize;

            this.ctx.fillStyle = actColor;
            this.ctx.fillRect(xPos, yPos, cellSize, cellSize);
        }
        // Si no hay actColor, no hacemos nada: la grilla ya está restaurada en _renderDirtyCells
    }

    _renderLargeCell(x, y, cellIndex, isAlive) {
        const cellSize = this.config.cellSize;

        if (this._colorProvider) {
            const customColor = this._colorProvider(cellIndex);
            if (customColor) {
                const innerSize = cellSize - 2;
                this.ctx.clearRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
                this.ctx.fillStyle = customColor;
                this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            }
            return;
        }

        if (isAlive) {
            const innerSize = cellSize - 2;
            this.ctx.clearRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            this._drawSingleCell(x, y);
        } else {
            const dyingColor = this.config.showActivityEffect &&
            this._dyingAges[cellIndex] < this._activityCooldown
                ? this.colorDying : null;

            if (dyingColor) {
                const innerSize = cellSize - 2;
                const px = x * cellSize + 1;
                const py = y * cellSize + 1;
                this.ctx.clearRect(px, py, innerSize, innerSize);
                this.ctx.fillStyle = dyingColor;
                this.ctx.fillRect(px, py, innerSize, innerSize);
            }
        }
    }

    _drawSingleCell(x, y) {
        const cellSize = this.config.cellSize;
        const cellIndex = x * this.config.gridHeight + y;

        const customColor = this._colorProvider?.(cellIndex);
        const drawSize = Math.max(1, cellSize - (cellSize > 2 ? 2 : 1));
        const offset = cellSize > 2 ? 1 : 0;

        if (customColor) {
            this.ctx.fillStyle = customColor;
        } else if (cellSize >= 4) {
            const centerX = x * cellSize + cellSize / 2;
            const centerY = y * cellSize + cellSize / 2;
            const isBorn = this.config.showActivityEffect
                && this._activityAges[cellIndex] < this._activityCooldown;

            const gradient = this.ctx.createRadialGradient(
                centerX, centerY, 0, centerX, centerY, cellSize / 2
            );
            if (isBorn) {
                gradient.addColorStop(0, this.colorBorn);
                gradient.addColorStop(0.7, this.colorAlive);
                gradient.addColorStop(1, this.colorAlive + 'cc');
            } else {
                gradient.addColorStop(0, this.colorAlive);
                gradient.addColorStop(1, this.colorAlive);
            }
            this.ctx.fillStyle = gradient;
        } else {
            this.ctx.fillStyle = customColor ?? this._getCellColor(cellIndex, true);
        }

        this.ctx.fillRect(x * cellSize + offset, y * cellSize + offset, drawSize, drawSize);

        // El efecto de brillo de nacimiento condicional
        if (!customColor && cellSize >= 4) {
            const isBorn = this.config.showActivityEffect
                && this._activityAges[cellIndex] < this._activityCooldown;
            if (isBorn) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 2);
            }
        }
    }

    /**
     * Construye el canvas offscreen de grilla.
     *
     * Combina dos capas según config:
     *   showGrid           → líneas menores en todas las posiciones (trazo tenue 10%)
     *   showGridHighlights → líneas mayores superpuestas (cada gridMajorInterval)
     *
     * Las líneas mayores usan opacidad 28% si la grilla menor está activa (contraste),
     * o 10% (igual que las menores) si se muestran solas.
     *
     * Ambas capas usan strokeStyle para alineación perfecta sin importar cellSize.
     */
    _buildGridCache() {
        const {
            gridWidth, gridHeight, cellSize, gridMajorInterval,
            showGrid, showGridHighlights
        } = this.config;

        // Guard clause: si no hay nada que dibujar, salir temprano
        if (!showGrid && !showGridHighlights) {
            this._subtleGridCache = null;
            return;
        }

        const interval = gridMajorInterval || 10;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        const cache = document.createElement('canvas');
        cache.width = cw;
        cache.height = ch;
        const c = cache.getContext('2d');

        const minorColor = 'rgba(255, 255, 255, 0.10)';
        const majorColor = showGrid ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.10)';

        if (cellSize <= 2) {
            // ── Pixel-perfect para celdas pequeñas ──────────────────────
            if (showGrid) {
                c.fillStyle = minorColor;
                // Verticales
                for (let x = 0; x <= gridWidth; x++) {
                    if (showGridHighlights && x % interval === 0) continue;
                    c.fillRect(x * cellSize, 0, 1, ch);
                }
                // Horizontales
                for (let y = 0; y <= gridHeight; y++) {
                    if (showGridHighlights && y % interval === 0) continue;
                    c.fillRect(0, y * cellSize, cw, 1);
                }
            }

            if (showGridHighlights) {
                c.fillStyle = majorColor;
                for (let x = 0; x <= gridWidth; x++) {
                    if (x % interval !== 0) continue;
                    c.fillRect(x * cellSize, 0, 1, ch);
                }
                for (let y = 0; y <= gridHeight; y++) {
                    if (y % interval !== 0) continue;
                    c.fillRect(0, y * cellSize, cw, 1);
                }
            }
        } else {
            // ── Stroke para celdas grandes ──────────────────────────────
            c.lineWidth = 1;

            if (showGrid) {
                c.strokeStyle = minorColor;
                c.beginPath();
                for (let i = 0; i <= gridWidth; i++) {
                    if (showGridHighlights && i % interval === 0) continue;
                    const pos = i * cellSize;
                    c.moveTo(pos, 0);
                    c.lineTo(pos, ch);
                }
                for (let j = 0; j <= gridHeight; j++) {
                    if (showGridHighlights && j % interval === 0) continue;
                    const pos = j * cellSize;
                    c.moveTo(0, pos);
                    c.lineTo(cw, pos);
                }
                c.stroke();
            }

            if (showGridHighlights) {
                c.strokeStyle = majorColor;
                c.beginPath();
                for (let i = 0; i <= gridWidth; i++) {
                    if (i % interval !== 0) continue;
                    const pos = i * cellSize;
                    c.moveTo(pos, 0);
                    c.lineTo(pos, ch);
                }
                for (let j = 0; j <= gridHeight; j++) {
                    if (j % interval !== 0) continue;
                    const pos = j * cellSize;
                    c.moveTo(0, pos);
                    c.lineTo(cw, pos);
                }
                c.stroke();
            }
        }

        this._subtleGridCache = cache;
    }

    _drawCells(predicate) {
        const {gridWidth, gridHeight, cellSize} = this.config;
        for (let x = 0; x < gridWidth; x++) {
            for (let y = 0; y < gridHeight; y++) {
                const isAlive = predicate(x, y);
                const cellIndex = x * gridHeight + y;
                const customColor = this._colorProvider?.(cellIndex) ?? null;
                const color = customColor ?? this._getCellColor(cellIndex, isAlive);

                if (!color) continue;

                this.ctx.fillStyle = color;
                if (cellSize <= 3) {
                    this.ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                } else {
                    this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
                }
            }
        }
    }

    _renderRD2DCell(x, y, cellSize, state) {
        if (state === 0) return;

        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;
        const half = cellSize / 2;

        this.ctx.strokeStyle = this._getRD2DColor(state);
        this.ctx.lineWidth = Math.max(2, cellSize / 4);
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();

        if ((state >> 3) & 1) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX, centerY - half + 1);
        }
        if ((state >> 2) & 1) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX, centerY + half - 1);
        }
        if ((state >> 1) & 1) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX + half - 1, centerY);
        }
        if (state & 1) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX - half + 1, centerY);
        }

        this.ctx.stroke();

        this.ctx.fillStyle = this.ctx.strokeStyle;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, cellSize / 6, 0, Math.PI * 2);
        this.ctx.fill();
    }

    _getRD2DColor(state) {
        let count = 0;
        for (let i = 0; i < 4; i++) count += (state >> i) & 1;
        return ['#000000', '#ef4444', '#f97316', '#eab308', '#22c55e'][count] || '#94a3b8';
    }

    _resizeCanvas() {
        if (!this.canvas) return;
        const {gridWidth, gridHeight, cellSize} = this.config;
        const w = gridWidth * cellSize;
        const h = gridHeight * cellSize;
        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        if (this.container) {
            this.container.style.width = (w + 20) + 'px';
            this.container.style.height = (h + 20) + 'px';
        }
    }
}

window.GridRenderer = GridRenderer;