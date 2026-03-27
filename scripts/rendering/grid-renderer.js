/**
 * GridRenderer — Renderizado visual del autómata celular sobre Canvas 2D.
 *
 * Soporta grids rectangulares (gridWidth × gridHeight).
 * Índice plano: x * gridHeight + y  (column-major, igual que GridManager).
 *
 * Compatibilidad hacia atrás: opción `gridSize` se acepta como cuadrado.
 *
 * === OPTIMIZACIÓN DE GRILLA ===
 * Las líneas de grilla se dibujan en un canvas overlay DOM independiente
 * (position:absolute, pointer-events:none) ubicado encima del canvas principal.
 * Este overlay se construye UNA SOLA VEZ y permanece estático entre generaciones,
 * eliminando el mayor cuello de botella previo:
 *
 *   ANTES: O(N_dirty_cells) llamadas a drawImage(subimagen) por frame
 *   AHORA: 0 llamadas a drawImage en el hot-path de render
 *
 * El overlay sólo se reconstruye cuando cambia la configuración de grilla
 * (toggle, highlights, intervalo, resize).
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

        /**
         * Flag de validez del overlay. true = overlay DOM está construido y sincronizado.
         * Se pone a null/false cuando la config cambia para forzar reconstrucción.
         * Ya NO almacena un canvas offscreen — el overlay vive en el DOM.
         */
        this._subtleGridCache = null;

        /**
         * Canvas DOM overlay que contiene las líneas de grilla.
         * Posicionado con CSS absolute sobre el canvas principal.
         * Se construye una vez; permanece estático durante la simulación.
         */
        this._gridOverlay = null;
        this._gridOverlayCtx = null;

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

    get hasDirtyCells() {
        return this._fullDirtyPending || this._dirtyCells.size > 0;
    }

    get dirtyCount() {
        return this._dirtyCells.size;
    }

    _initActivityBuffers() {
        const total = this.config.gridWidth * this.config.gridHeight;
        this._activityAges = new Uint8Array(total).fill(this._activityCooldown);
        this._dyingAges = new Uint8Array(total).fill(this._activityCooldown);
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
        this._subtleGridCache = null;  // Fuerza reconstrucción del overlay

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
        this._destroyGridOverlay();
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

    /**
     * Render completo: fondo → celdas.
     * Las líneas de grilla las aporta el overlay DOM (no se drawImagean aquí).
     */
    _forceFullRender() {
        // Asegurar que el overlay esté construido antes del primer render completo
        if (!this._subtleGridCache) this._buildGridCache();

        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // La grilla la dibuja el overlay DOM — ningún drawImage aquí
        this._drawCells((x, y) => this._getCell(x, y));
    }

    /**
     * Render diferencial: sólo las celdas marcadas como sucias.
     *
     * OPTIMIZACIÓN CLAVE (v2):
     * Se divide en dos pasadas para minimizar cambios de estado del contexto
     * y eliminar completamente los drawImage de sub-imagen por celda.
     *
     * Pasada 1 — borrar con colorDead (un solo setState, N fillRect):
     *   Antes: clearRect + drawImage(subimagen) × N  → muy costoso
     *   Ahora: fillRect(colorDead) × N en batch       → muy barato
     *
     * Pasada 2 — dibujar contenido de celda:
     *   Igual que antes, pero sin la restauración de grilla previa.
     *
     * El overlay DOM permanece estático; sus líneas aparecen siempre encima
     * sin coste adicional por frame.
     */
    _renderDirtyCells() {
        // Asegurar overlay construido (lazy, sólo en el primer render post-toggle)
        if (!this._subtleGridCache) this._buildGridCache();

        const {gridHeight, cellSize} = this.config;

        // ── Pasada 1: borrar todas las celdas sucias con colorDead ──────────
        // Un único cambio de fillStyle para todas las celdas → mínimo overhead de estado.
        this.ctx.fillStyle = this.colorDead;
        for (const index of this._dirtyCells) {
            const x = (index / gridHeight) | 0;
            const y = index % gridHeight;
            this.ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }

        // ── Pasada 2: dibujar contenido de celda encima ─────────────────────
        for (const index of this._dirtyCells) {
            const x = (index / gridHeight) | 0;
            const y = index % gridHeight;
            this._renderCell(x, y);
        }
    }

    /**
     * Asegura que el overlay esté construido. Devuelve null deliberadamente:
     * el overlay es un elemento DOM, no una fuente para drawImage.
     * Mantenido para compatibilidad con código que pudiera llamarlo externamente.
     * @returns {null}
     */
    _getGridCache() {
        const {showGrid, showGridHighlights} = this.config;
        if (!showGrid && !showGridHighlights) return null;
        if (!this._subtleGridCache) this._buildGridCache();
        return null; // El overlay DOM es el canal de display — no usar drawImage
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
            this.ctx.fillStyle = actColor;
            this.ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
        // Sin actColor: la pasada 1 ya limpió con colorDead; nada más que hacer
    }

    /**
     * Dibuja una celda grande (cellSize > 3) con borde de 1px y contenido interior.
     *
     * No llama a clearRect: la pasada 1 de _renderDirtyCells ya llenó la celda
     * entera con colorDead, por lo que el borde de 1px queda automáticamente como
     * colorDead (el color del "vacío"), y sólo el interior necesita ser pintado.
     */
    _renderLargeCell(x, y, cellIndex, isAlive) {
        const cellSize = this.config.cellSize;
        const innerSize = cellSize - 2;
        const px = x * cellSize + 1;
        const py = y * cellSize + 1;

        if (this._colorProvider) {
            const customColor = this._colorProvider(cellIndex);
            if (customColor) {
                // Sin clearRect: la pasada 1 ya puso colorDead en toda la celda
                this.ctx.fillStyle = customColor;
                this.ctx.fillRect(px, py, innerSize, innerSize);
            }
            return;
        }

        if (isAlive) {
            // Sin clearRect: innecesario, pasada 1 ya borró
            this._drawSingleCell(x, y);
        } else {
            const dyingColor = this.config.showActivityEffect &&
            this._dyingAges[cellIndex] < this._activityCooldown
                ? this.colorDying : null;

            if (dyingColor) {
                // Sin clearRect: innecesario, pasada 1 ya borró
                this.ctx.fillStyle = dyingColor;
                this.ctx.fillRect(px, py, innerSize, innerSize);
            }
            // Sin dyingColor: celda muerta sin efecto → colorDead de pasada 1 es suficiente
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

        // Efecto de brillo en el borde superior al nacer
        if (!customColor && cellSize >= 4) {
            const isBorn = this.config.showActivityEffect
                && this._activityAges[cellIndex] < this._activityCooldown;
            if (isBorn) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                this.ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, 2);
            }
        }
    }

    // =========================================
    // GRILLA — OVERLAY DOM
    // =========================================

    /**
     * Crea el canvas overlay para las líneas de grilla si no existe,
     * y sincroniza su tamaño y posición con el canvas principal.
     *
     * El overlay se inserta inmediatamente después del canvas principal dentro
     * del container (#canvas-container, position:relative), con z-index:1 para
     * quedar encima de las celdas pero debajo de los overlays de patrón/influencia.
     * pointer-events:none garantiza que no interfiere con los eventos de mouse.
     *
     * IMPORTANTE: `background:transparent` en el cssText es imprescindible.
     * La regla global `canvas { background: #0f172a; }` de main.css se aplica
     * a cualquier <canvas> del DOM. Sin este override el overlay aparecería
     * como una capa opaca oscura que tapa completamente las celdas dibujadas
     * en el canvas principal.
     */
    _ensureGridOverlay() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        if (!this._gridOverlay) {
            this._gridOverlay = document.createElement('canvas');
            // background:transparent sobreescribe la regla global
            //   canvas { background: #0f172a; }  (main.css)
            // que de lo contrario convertiría el overlay en un rectángulo opaco.
            // cursor:default evita heredar el crosshair del canvas principal
            // aunque pointer-events:none lo hace inerte.
            this._gridOverlay.style.cssText =
                'position:absolute;pointer-events:none;z-index:1;' +
                'image-rendering:pixelated;background:transparent;cursor:default;';
            // Insertar justo después del canvas principal para herencia de posición
            this.canvas.insertAdjacentElement('afterend', this._gridOverlay);
            this._gridOverlayCtx = this._gridOverlay.getContext('2d', {alpha: true});
        }

        // Sincronizar dimensiones en píxeles
        if (this._gridOverlay.width !== w || this._gridOverlay.height !== h) {
            this._gridOverlay.width = w;
            this._gridOverlay.height = h;
        }

        // Sincronizar tamaño CSS y posición relativa al container
        this._gridOverlay.style.width = (this.canvas.style.width || w + 'px');
        this._gridOverlay.style.height = (this.canvas.style.height || h + 'px');
        this._gridOverlay.style.left = this.canvas.offsetLeft + 'px';
        this._gridOverlay.style.top = this.canvas.offsetTop + 'px';
    }

    /**
     * Elimina el canvas overlay del DOM y libera referencias.
     * Llamado desde destroy() y cuando el renderer es reemplazado.
     */
    _destroyGridOverlay() {
        if (this._gridOverlay) {
            this._gridOverlay.remove();
            this._gridOverlay = null;
            this._gridOverlayCtx = null;
        }
    }

    /**
     * Construye (o reconstruye) el overlay de grilla.
     *
     * Combina dos capas según config:
     *   showGrid           → líneas menores en todas las posiciones (trazo tenue 10%)
     *   showGridHighlights → líneas mayores superpuestas (cada gridMajorInterval)
     *
     * Las líneas mayores usan opacidad 28% si la grilla menor está activa (contraste),
     * o 10% (igual que las menores) si se muestran solas.
     *
     * Después de construirse, el overlay permanece estático sin coste por frame.
     * _subtleGridCache actúa como flag boolean de validez del overlay.
     */
    _buildGridCache() {
        const {
            gridWidth, gridHeight, cellSize, gridMajorInterval,
            showGrid, showGridHighlights
        } = this.config;

        // Sin grilla ni highlights: limpiar overlay si existe y salir
        if (!showGrid && !showGridHighlights) {
            if (this._gridOverlay) {
                this._gridOverlayCtx.clearRect(
                    0, 0, this._gridOverlay.width, this._gridOverlay.height
                );
            }
            this._subtleGridCache = null;
            return;
        }

        this._ensureGridOverlay();

        const ctx = this._gridOverlayCtx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const interval = gridMajorInterval || 10;

        ctx.clearRect(0, 0, cw, ch);

        const minorColor = 'rgba(255, 255, 255, 0.10)';
        const majorColor = showGrid ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.10)';

        if (cellSize <= 2) {
            // ── Pixel-perfect para celdas pequeñas ──────────────────────────
            if (showGrid) {
                ctx.fillStyle = minorColor;
                for (let x = 0; x <= gridWidth; x++) {
                    if (showGridHighlights && x % interval === 0) continue;
                    ctx.fillRect(x * cellSize, 0, 1, ch);
                }
                for (let y = 0; y <= gridHeight; y++) {
                    if (showGridHighlights && y % interval === 0) continue;
                    ctx.fillRect(0, y * cellSize, cw, 1);
                }
            }

            if (showGridHighlights) {
                ctx.fillStyle = majorColor;
                for (let x = 0; x <= gridWidth; x++) {
                    if (x % interval !== 0) continue;
                    ctx.fillRect(x * cellSize, 0, 1, ch);
                }
                for (let y = 0; y <= gridHeight; y++) {
                    if (y % interval !== 0) continue;
                    ctx.fillRect(0, y * cellSize, cw, 1);
                }
            }
        } else {
            // ── Stroke para celdas grandes (más exacto que fillRect) ─────────
            ctx.lineWidth = 1;

            if (showGrid) {
                ctx.strokeStyle = minorColor;
                ctx.beginPath();
                for (let i = 0; i <= gridWidth; i++) {
                    if (showGridHighlights && i % interval === 0) continue;
                    const pos = i * cellSize;
                    ctx.moveTo(pos, 0);
                    ctx.lineTo(pos, ch);
                }
                for (let j = 0; j <= gridHeight; j++) {
                    if (showGridHighlights && j % interval === 0) continue;
                    const pos = j * cellSize;
                    ctx.moveTo(0, pos);
                    ctx.lineTo(cw, pos);
                }
                ctx.stroke();
            }

            if (showGridHighlights) {
                ctx.strokeStyle = majorColor;
                ctx.beginPath();
                for (let i = 0; i <= gridWidth; i++) {
                    if (i % interval !== 0) continue;
                    const pos = i * cellSize;
                    ctx.moveTo(pos, 0);
                    ctx.lineTo(pos, ch);
                }
                for (let j = 0; j <= gridHeight; j++) {
                    if (j % interval !== 0) continue;
                    const pos = j * cellSize;
                    ctx.moveTo(0, pos);
                    ctx.lineTo(cw, pos);
                }
                ctx.stroke();
            }
        }

        // Marcar overlay como válido (flag boolean — ya no guarda un canvas offscreen)
        this._subtleGridCache = true;
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

        if ((state >> 3) && 1) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX, centerY - half + 1);
        }
        if ((state >> 2) && 1) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX, centerY + half - 1);
        }
        if ((state >> 1) && 1) {
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(centerX + half - 1, centerY);
        }
        if (state && 1) {
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

    /**
     * Redimensiona el canvas principal y sincroniza el overlay DOM.
     * El overlay se invalida (_subtleGridCache = null) para forzar
     * reconstrucción en el siguiente render, lo que incluye una nueva
     * llamada a _ensureGridOverlay() que ajusta posición y tamaño.
     */
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
        // Invalidar overlay: se reconstruirá (con nuevas dimensiones) en el próximo render
        this._subtleGridCache = null;
    }
}

window.GridRenderer = GridRenderer;