/**
 * GridRenderer — Renderizado visual del autómata celular sobre Canvas 2D.
 *
 * Estrategia de rendering:
 *   - markAllDirty() activa un flag booleano (_fullDirtyPending) en O(1).
 *     render() lo consume haciendo un full render.
 *   - markDirty/markDirtyIndex agrega índices al Set _dirtyCells para
 *     renderizado parcial — solo si no hay ya un full render pendiente.
 *   - Las propiedades _prevFlags y _renderFlags han sido eliminadas:
 *     eran escritas pero nunca leídas en ninguna parte del proyecto.
 */
class GridRenderer {
    /**
     * @param {Object}   options
     * @param {HTMLCanvasElement} options.canvas
     * @param {HTMLElement}       options.container
     * @param {Function} options.getCell       — (x, y) => 0|1
     * @param {Function} options.getRD2DState  — (x, y) => 0..15
     * @param {Function} options.isRD2DActive  — () => boolean
     * @param {Function} options.getGridSize   — () => number
     * @param {number}   [options.gridSize]
     * @param {number}   [options.cellSize]
     * @param {boolean}  [options.showGrid]
     * @param {boolean}  [options.showActivityEffect]
     */
    constructor(options) {
        if (!options.canvas) throw new Error('GridRenderer: canvas requerido');
        if (typeof options.getCell !== 'function') throw new Error('GridRenderer: getCell requerido');
        if (typeof options.getGridSize !== 'function') throw new Error('GridRenderer: getGridSize requerido');

        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d');
        this.container = options.container;

        this._getCell = options.getCell;
        this._getRD2DState = options.getRD2DState || (() => undefined);
        this._isRD2DActive = options.isRD2DActive || (() => false);
        this._getGridSize = options.getGridSize;

        this.config = {
            showGrid: options.showGrid !== false,
            showActivityEffect: options.showActivityEffect !== false,
            cellSize: Math.max(1, Math.min(options.cellSize || 4, 20)),
            gridSize: Math.max(20, Math.min(options.gridSize || 200, 500))
        };

        // Dirty rendering
        this._dirtyCells = new Set();
        this._fullDirtyPending = false;   // reemplaza markAllDirty O(n²)

        // Efecto de actividad
        // _activityAges : cooldown para 0→1 (nacimiento, amarillo)
        // _dyingAges    : cooldown para 1→0 (muerte, rojo)
        this._coolingCells = new Set();
        this._dyingCells = new Set();
        this._activityCooldown = 3;
        const _totalCells = this.config.gridSize * this.config.gridSize;
        this._activityAges = new Uint8Array(_totalCells).fill(this._activityCooldown);
        this._dyingAges = new Uint8Array(_totalCells).fill(this._activityCooldown);

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
            this._dirtyCells.add(x * this.config.gridSize + y);
        }
    }

    markDirtyIndex(index) {
        if (!this._fullDirtyPending) {
            this._dirtyCells.add(index);
        }
    }

    /**
     * Marca todo el grid para re-renderizado.
     * O(1): activa un flag. El full render ocurre en el próximo render().
     * Las llamadas a markDirty posteriores son ignoradas hasta que render()
     * consuma el flag.
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
        return this.reGrid();
    }

    /**
     * Fuerza re-render completo y retorna el estado actual de showGrid.
     * Llamado al volver de modos especiales para restaurar el grid cuadrado.
     */
    reGrid() {
        this.markAllDirty();
        return this.config.showGrid;
    }

    /** Wrapper público de _resizeCanvas() para special-mode-controller. */
    resizeCanvas() {
        this._resizeCanvas();
    }

    resize(gridSize, cellSize) {
        this.config.gridSize = Math.max(20, Math.min(gridSize, 1000));
        this.config.cellSize = Math.max(1, Math.min(cellSize, 20));

        const totalCells = this.config.gridSize * this.config.gridSize;
        this._activityAges = new Uint8Array(totalCells).fill(this._activityCooldown);
        this._dyingAges = new Uint8Array(totalCells).fill(this._activityCooldown);
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
     *   0→1 (nacimiento): _activityAges[i] = 0  → se pinta amarillo durante cooldown frames
     *   1→0 (muerte):     _dyingAges[i]    = 0  → se pinta rojo   durante cooldown frames
     *
     * @param {Uint32Array|Array} changedBuffer — índices planos (x*size+y)
     * @param {number}            [changedCount]
     */
    updateActivityAges(changedBuffer, changedCount) {
        const cooldown = this._activityCooldown;
        const size = this.config.gridSize;
        const count = changedCount !== undefined ? changedCount : changedBuffer.length;

        for (let i = 0; i < count; i++) {
            const index = changedBuffer[i];
            const x = (index / size) | 0;
            const y = index % size;
            if (this._getCell(x, y)) {
                // 0→1: nació
                this._activityAges[index] = 0;
                this._coolingCells.add(index);
                // Limpiar dying por si la celda renació en el mismo spot
                this._dyingAges[index] = cooldown;
                this._dyingCells.delete(index);
            } else {
                // 1→0: murió
                this._dyingAges[index] = 0;
                this._dyingCells.add(index);
                // Limpiar born
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
    // COLOR PROVIDER (LangtonEngine multi-color)
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

        const {cellSize, gridSize} = this.config;
        return {
            x: Math.max(0, Math.min(Math.floor(canvasX / cellSize), gridSize - 1)),
            y: Math.max(0, Math.min(Math.floor(canvasY / cellSize), gridSize - 1))
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
        this._getGridSize = null;
    }

    // =========================================
    // RENDER INTERNO
    // =========================================

    _forceFullRender() {
        const cellSize = this.config.cellSize;

        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.config.showGrid) {
            if (cellSize > 2) {
                this._drawGrid();
            } else {
                if (!this._subtleGridCache) this._buildSubtleGridCache();
                this.ctx.drawImage(this._subtleGridCache, 0, 0);
            }
        }

        this._drawCells((x, y) => this._getCell(x, y));
    }

    _renderDirtyCells() {
        for (const index of this._dirtyCells) {
            const x = (index / this.config.gridSize) | 0;
            const y = index % this.config.gridSize;
            this._renderCell(x, y);
        }
    }

    _renderCell(x, y) {
        const cellSize = this.config.cellSize;
        const cellIndex = x * this.config.gridSize + y;
        const isAlive = this._getCell(x, y);

        if (this._isRD2DActive() && isAlive) {
            this._renderRD2DCell(x, y, cellSize, this._getRD2DState(x, y) || 0);
            return;
        }

        if (cellSize <= 2) {
            this._renderSmallCell(x, y, cellIndex, isAlive);
        } else {
            this._renderLargeCell(x, y, cellIndex, isAlive);
        }
    }

    // =========================================
    // COLOR DE CELDA
    // =========================================

    /**
     * Devuelve el color CSS para una celda según su estado y actividad.
     *   isAlive + naciendo  → amarillo (#b9b610)
     *   isAlive estable     → verde   (#059669)
     *   !isAlive + muriendo → rojo    (#ef4444)
     *   !isAlive estable    → null    (usar fondo)
     *
     * @param {number}  cellIndex
     * @param {boolean} isAlive
     * @returns {string|null}
     */
    _getCellColor(cellIndex, isAlive) {
        if (!this.config.showActivityEffect) return isAlive ? this.colorAlive : null;
        const cooldown = this._activityCooldown;
        if (isAlive) {
            return this._activityAges[cellIndex] < cooldown ? this.colorBorn : this.colorAlive;
        }
        return this._dyingAges[cellIndex] < cooldown ? this.colorDying : null;
    }

    _renderSmallCell(x, y, cellIndex, isAlive) {
        const cellSize = this.config.cellSize;
        const xPos = x * cellSize;
        const yPos = y * cellSize;

        // Si hay colorProvider (Generations, Langton multi-color) consultarlo siempre,
        // no solo para celdas vivas — las células moribundas tienen grid=0 pero color propio.
        const customColor = this._colorProvider?.(cellIndex) ?? null;
        const actColor = customColor ?? this._getCellColor(cellIndex, isAlive);

        if (actColor) {
            this.ctx.fillStyle = actColor;
            this.ctx.fillRect(xPos, yPos, cellSize, cellSize);
        } else {
            this.ctx.fillStyle = this.colorDead;
            this.ctx.fillRect(xPos, yPos, cellSize, cellSize);
            if (this.config.showGrid && cellSize === 2) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                this.ctx.fillRect(xPos + 1, yPos, 1, cellSize);
                this.ctx.fillRect(xPos, yPos + 1, cellSize, 1);
            }
        }
    }

    _renderLargeCell(x, y, cellIndex, isAlive) {
        const cellSize = this.config.cellSize;
        const innerSize = cellSize - 2;

        // Si hay colorProvider activo, usarlo también para celdas "muertas" (moribundas)
        if (this._colorProvider) {
            const customColor = this._colorProvider(cellIndex);
            this.ctx.clearRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            if (customColor) {
                this.ctx.fillStyle = customColor;
                this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            }
            return;
        }

        if (isAlive) {
            this.ctx.clearRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            this._drawSingleCell(x, y);
        } else {
            const dyingColor = this.config.showActivityEffect && this._dyingAges[cellIndex] < this._activityCooldown
                ? this.colorDying : null;
            this.ctx.clearRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            if (dyingColor) {
                this.ctx.fillStyle = dyingColor;
                this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, innerSize, innerSize);
            }
        }
    }

    _drawSingleCell(x, y) {
        const cellSize = this.config.cellSize;
        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;
        const cellIndex = x * this.config.gridSize + y;

        const customColor = this._colorProvider?.(cellIndex);
        const baseColor = customColor ?? this._getCellColor(cellIndex, true);
        const isBorn = !customColor && this.config.showActivityEffect
            && this._activityAges[cellIndex] < this._activityCooldown;
        const drawSize = Math.max(1, cellSize - (cellSize > 2 ? 2 : 1));
        const offset = cellSize > 2 ? 1 : 0;

        if (customColor) {
            this.ctx.fillStyle = customColor;
        } else if (cellSize >= 4) {
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
            this.ctx.fillStyle = baseColor;
        }

        this.ctx.fillRect(x * cellSize + offset, y * cellSize + offset, drawSize, drawSize);

        if (!customColor && isBorn && cellSize >= 4) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 2);
        }
    }

    _drawGrid() {
        const {gridSize, cellSize} = this.config;
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let i = 0; i <= gridSize; i++) {
            const pos = i * cellSize;
            this.ctx.moveTo(pos, 0);
            this.ctx.lineTo(pos, h);
            this.ctx.moveTo(0, pos);
            this.ctx.lineTo(w, pos);
        }
        this.ctx.stroke();
    }

    _buildSubtleGridCache() {
        const {gridSize, cellSize} = this.config;
        const cache = document.createElement('canvas');
        cache.width = this.canvas.width;
        cache.height = this.canvas.height;
        const cCtx = cache.getContext('2d');

        cCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        for (let x = 0; x < gridSize; x++) {
            const xPos = x * cellSize;
            for (let y = 0; y < gridSize; y++) {
                const yPos = y * cellSize;
                cCtx.fillRect(xPos + 1, yPos, 1, cellSize);
                cCtx.fillRect(xPos, yPos + 1, cellSize, 1);
            }
        }
        this._subtleGridCache = cache;
    }

    _drawCells(predicate) {
        const {gridSize, cellSize} = this.config;
        for (let x = 0; x < gridSize; x++) {
            for (let y = 0; y < gridSize; y++) {
                const isAlive = predicate(x, y);
                const cellIndex = x * gridSize + y;
                // Si hay colorProvider (Generations, Langton) consultarlo siempre:
                // las células moribundas tienen isAlive=false pero color propio.
                const customColor = this._colorProvider?.(cellIndex) ?? null;
                const color = customColor ?? this._getCellColor(cellIndex, isAlive);

                if (!color) continue; // muerta y sin actividad reciente

                this.ctx.fillStyle = color;
                if (cellSize <= 2) {
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
        const width = this.config.gridSize * this.config.cellSize;
        this.canvas.width = width;
        this.canvas.height = width;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = width + 'px';
        if (this.container) {
            this.container.style.width = (width + 20) + 'px';
            this.container.style.height = (width + 20) + 'px';
        }
    }
}

window.GridRenderer = GridRenderer;