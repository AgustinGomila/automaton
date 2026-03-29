/**
 * NeighborhoodCalculator — Cálculo de vecindad para autómatas celulares.
 *
 * Tipos soportados:
 *   'moore'   — cuadrado completo de (2R+1)² − 1 celdas
 *   'neumann' — diamante (|dx|+|dy| ≤ R)
 *   'custom'  — lista arbitraria de offsets [{dx,dy}]
 *
 * Soporta grids rectangulares: gridWidth para el eje X, gridHeight para Y.
 */
class NeighborhoodCalculator {
    /**
     * @param {Object}  options
     * @param {string}  options.type          — 'moore' | 'neumann' | 'custom'
     * @param {number}  options.radius        — 1..10 (default 1)
     * @param {boolean} options.wrapEdges     — modo toroidal (default true)
     * @param {number}  options.gridWidth     — ancho del grid
     * @param {number}  options.gridHeight    — alto del grid
     */
    constructor(options = {}) {
        this.type = options.type || 'moore';
        this.radius = Math.max(1, Math.min(options.radius || AppConfig.NEIGHBORHOOD.MIN_RADIUS, AppConfig.NEIGHBORHOOD.MAX_RADIUS));
        this.wrapEdges = options.wrapEdges !== false;

        this.gridWidth = options.gridWidth || AppConfig.GRID.DEFAULT_WIDTH;
        this.gridHeight = options.gridHeight || AppConfig.GRID.DEFAULT_HEIGHT;

        this._offsets = this._computeOffsets();
    }

    /**
     * true cuando se puede usar el fastpath Moore radio-1 de RuleEngine.
     * Excluye 'custom' aunque tenga los mismos 8 offsets.
     */
    get isFastPath() {
        return this.type === 'moore' && this.radius === 1;
    }

    /** Copia de los offsets activos. */
    get offsets() {
        return this._offsets.slice();
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
     * Para presets (moore/neumann): pasar type y/o radius.
     * Para personalizada: pasar offsets como [{dx,dy}].
     * gridWidth/gridHeight actualizan las dimensiones.
     *
     * @param {Object} options
     * @param {string}  [options.type]
     * @param {number}  [options.radius]
     * @param {boolean} [options.wrapEdges]
     * @param {number}  [options.gridWidth]
     * @param {number}  [options.gridHeight]
     * @param {Array<{dx:number,dy:number}>} [options.offsets]
     */
    configure(options) {
        if (options.gridWidth !== undefined) this.gridWidth = options.gridWidth;
        if (options.gridHeight !== undefined) this.gridHeight = options.gridHeight;

        if (options.offsets !== undefined) {
            // Vecindad personalizada: offsets directos desde la UI.
            this._offsets = options.offsets.map(o => ({dx: o.dx | 0, dy: o.dy | 0}));
            this.type = 'custom';
            if (options.wrapEdges !== undefined) this.wrapEdges = options.wrapEdges;
            return;
        }

        if (options.type !== undefined) this.type = options.type;
        if (options.radius !== undefined) this.radius = Math.max(1, Math.min(options.radius, 10));
        if (options.wrapEdges !== undefined) this.wrapEdges = options.wrapEdges;

        if (this.type !== 'custom') this._offsets = this._computeOffsets();
    }

    countNeighbors(x, y, getCell) {
        let count = 0;
        const {gridWidth, gridHeight, wrapEdges} = this;
        for (const {dx, dy} of this._offsets) {
            let nx = x + dx;
            let ny = y + dy;
            if (wrapEdges) {
                nx = ((nx % gridWidth) + gridWidth) % gridWidth;
                ny = ((ny % gridHeight) + gridHeight) % gridHeight;
                count += getCell(nx, ny);
            } else if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
                count += getCell(nx, ny);
            }
        }
        return count;
    }

    getNeighborCoordinates(x, y) {
        const neighbors = [];
        const {gridWidth, gridHeight, wrapEdges} = this;
        for (const {dx, dy} of this._offsets) {
            let nx = x + dx;
            let ny = y + dy;
            if (wrapEdges) {
                nx = ((nx % gridWidth) + gridWidth) % gridWidth;
                ny = ((ny % gridHeight) + gridHeight) % gridHeight;
            }
            if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
                neighbors.push({x: nx, y: ny});
            }
        }
        return neighbors;
    }

    getInfo() {
        return {
            type: this.type,
            radius: this.radius,
            wrapEdges: this.wrapEdges,
            neighborCount: this._offsets.length
        };
    }
}

window.NeighborhoodCalculator = NeighborhoodCalculator;