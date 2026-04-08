import {AppConfig} from '../utils/config.js';

/**
 * NeighborhoodCalculator — Cálculo de vecindad para autómatas celulares.
 *
 * Tipos soportados:
 *   'moore'   — cuadrado completo de (2R+1)² − 1 celdas
 *   'neumann' — diamante (|dx|+|dy| ≤ R)
 *   'custom'  — lista arbitraria de offsets [{dx,dy}]
 *
 * Modos de borde (wrapMode):
 *   'both'       — toroidal: wrap en X e Y  (clásico ∞)
 *   'horizontal' — cilíndrico: wrap solo en X (↔)
 *   'vertical'   — cilíndrico: wrap solo en Y (↕)
 *   'none'       — plano: sin wrap en ningún eje (□)
 *
 * Soporta grids rectangulares: gridWidth para el eje X, gridHeight para Y.
 */

/** Valores válidos de wrapMode. */
const WRAP_MODES = Object.freeze(['both', 'horizontal', 'vertical', 'none']);

class NeighborhoodCalculator {
    /**
     * @param {Object}  options
     * @param {string}  options.type          — 'moore' | 'neumann' | 'custom'
     * @param {number}  options.radius        — 1..10 (default 1)
     * @param {string}  [options.wrapMode]    — 'both'|'horizontal'|'vertical'|'none' (default 'both')
     * @param {boolean} [options.wrapEdges]   — legacy: true='both', false='none'
     * @param {number}  options.gridWidth     — ancho del grid
     * @param {number}  options.gridHeight    — alto del grid
     */
    constructor(options = {}) {
        this.type = options.type || 'moore';
        this.radius = Math.max(1, Math.min(options.radius || AppConfig.NEIGHBORHOOD.MIN_RADIUS, AppConfig.NEIGHBORHOOD.MAX_RADIUS));

        this.gridWidth = options.gridWidth || AppConfig.GRID.DEFAULT_WIDTH;
        this.gridHeight = options.gridHeight || AppConfig.GRID.DEFAULT_HEIGHT;

        this.wrapMode = NeighborhoodCalculator.resolveWrapMode(options);

        this._offsets = this._computeOffsets();
    }

    /** true cuando se puede usar el fastpath Moore radio-1 de RuleEngine. */
    get isFastPath() {
        return this.type === 'moore' && this.radius === 1;
    }

    /** Copia de los offsets activos. */
    get offsets() {
        return this._offsets.slice();
    }

    /** Backward-compat: true si hay wrap en ambos ejes. */
    get wrapEdges() {
        return this.wrapMode === 'both';
    }

    get wrapX() {
        return this.wrapMode === 'both' || this.wrapMode === 'horizontal';
    }

    get wrapY() {
        return this.wrapMode === 'both' || this.wrapMode === 'vertical';
    }

    /**
     * Resuelve el wrapMode desde opciones, con compatibilidad hacia atrás con wrapEdges boolean.
     * Prioridad: wrapMode explícito > wrapEdges boolean > 'both' por defecto.
     */
    static resolveWrapMode(options) {
        if (options.wrapMode !== undefined && WRAP_MODES.includes(options.wrapMode)) {
            return options.wrapMode;
        }
        if (options.wrapEdges !== undefined) {
            return options.wrapEdges ? 'both' : 'none';
        }
        return 'both';
    }

    _computeOffsets() {
        const offsets = [];
        for (let dx = -this.radius; dx <= this.radius; dx++) {
            for (let dy = -this.radius; dy <= this.radius; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (this.type === 'neumann' && Math.abs(dx) + Math.abs(dy) > this.radius) continue;
                offsets.push({dx, dy});
            }
        }
        return offsets;
    }

    /**
     * Reconfigura la vecindad.
     *
     * @param {Object} options
     * @param {string}  [options.type]
     * @param {number}  [options.radius]
     * @param {string}  [options.wrapMode]   — 'both'|'horizontal'|'vertical'|'none'
     * @param {boolean} [options.wrapEdges]  — legacy: true='both', false='none'
     * @param {number}  [options.gridWidth]
     * @param {number}  [options.gridHeight]
     * @param {Array<{dx:number,dy:number}>} [options.offsets]
     */
    configure(options) {
        if (options.gridWidth !== undefined) this.gridWidth = options.gridWidth;
        if (options.gridHeight !== undefined) this.gridHeight = options.gridHeight;

        if (options.offsets !== undefined) {
            this._offsets = options.offsets.map(o => ({dx: o.dx | 0, dy: o.dy | 0}));
            this.type = 'custom';
            const newMode = NeighborhoodCalculator.resolveWrapMode(options);
            if (options.wrapMode !== undefined || options.wrapEdges !== undefined) this.wrapMode = newMode;
            return;
        }

        if (options.type !== undefined) this.type = options.type;
        if (options.radius !== undefined) this.radius = Math.max(1, Math.min(options.radius, 10));
        if (options.wrapMode !== undefined || options.wrapEdges !== undefined) {
            this.wrapMode = NeighborhoodCalculator.resolveWrapMode(options);
        }

        if (this.type !== 'custom') this._offsets = this._computeOffsets();
    }

    countNeighbors(x, y, getCell) {
        let count = 0;
        const {gridWidth, gridHeight, wrapX, wrapY} = this;
        for (const {dx, dy} of this._offsets) {
            let nx = x + dx;
            let ny = y + dy;
            if (wrapX) nx = ((nx % gridWidth) + gridWidth) % gridWidth;
            else if (nx < 0 || nx >= gridWidth) continue;
            if (wrapY) ny = ((ny % gridHeight) + gridHeight) % gridHeight;
            else if (ny < 0 || ny >= gridHeight) continue;
            count += getCell(nx, ny);
        }
        return count;
    }

    getNeighborCoordinates(x, y) {
        const neighbors = [];
        const {gridWidth, gridHeight, wrapX, wrapY} = this;
        for (const {dx, dy} of this._offsets) {
            let nx = x + dx;
            let ny = y + dy;
            if (wrapX) nx = ((nx % gridWidth) + gridWidth) % gridWidth;
            else if (nx < 0 || nx >= gridWidth) continue;
            if (wrapY) ny = ((ny % gridHeight) + gridHeight) % gridHeight;
            else if (ny < 0 || ny >= gridHeight) continue;
            neighbors.push({x: nx, y: ny});
        }
        return neighbors;
    }

    getInfo() {
        return {
            type: this.type,
            radius: this.radius,
            wrapMode: this.wrapMode,
            wrapEdges: this.wrapEdges,   // backward-compat
            neighborCount: this._offsets.length
        };
    }
}

export {NeighborhoodCalculator, WRAP_MODES};