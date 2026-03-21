/**
 * NeighborhoodCalculator — Cálculo de vecindad para autómatas celulares.
 *
 * Responsabilidad: calcular vecinos según tipo (Moore/Neumann) y radio.
 * Sin dependencias de estado del grid, solo cálculos geométricos.
 */
class NeighborhoodCalculator {
    /**
     * @param {Object}  options
     * @param {string}  options.type        — 'moore' | 'neumann'
     * @param {number}  options.radius      — 1..10 (default 1)
     * @param {boolean} options.wrapEdges   — modo toroidal (default true)
     * @param {number}  options.gridSize
     */
    constructor(options = {}) {
        this.type = options.type || 'moore';
        this.radius = Math.max(1, Math.min(options.radius || 1, 10));
        this.wrapEdges = options.wrapEdges !== false;
        this.gridSize = options.gridSize || 200;

        this._offsets = this._computeOffsets();
    }

    /**
     * true cuando se puede usar el fastpath Moore radio-1 de RuleEngine.
     * Condición: tipo Moore, radio 1. El wrapEdges lo maneja el fastpath
     * con dos ramas separadas (wrap / bounded).
     */
    get isFastPath() {
        return this.type === 'moore' && this.radius === 1;
    }

    /**
     * Versión estática — instancia temporal solo para el conteo.
     * No usar en hot paths; existe únicamente para tests o utilidades.
     */
    static count(x, y, grid, type = 'moore', radius = 1, wrap = true) {
        const size = grid.length;
        const calc = new NeighborhoodCalculator({type, radius, wrapEdges: wrap, gridSize: size});
        return calc.countNeighbors(x, y, (nx, ny) => grid[nx]?.[ny] || 0);
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

    configure(options) {
        if (options.type !== undefined) this.type = options.type;
        if (options.radius !== undefined) this.radius = Math.max(1, Math.min(options.radius, 10));
        if (options.wrapEdges !== undefined) this.wrapEdges = options.wrapEdges;
        if (options.gridSize !== undefined) this.gridSize = options.gridSize;
        this._offsets = this._computeOffsets();
    }

    countNeighbors(x, y, getCell) {
        let count = 0;
        for (const {dx, dy} of this._offsets) {
            let nx = x + dx;
            let ny = y + dy;
            if (this.wrapEdges) {
                nx = ((nx % this.gridSize) + this.gridSize) % this.gridSize;
                ny = ((ny % this.gridSize) + this.gridSize) % this.gridSize;
                count += getCell(nx, ny);
            } else {
                if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
                    count += getCell(nx, ny);
                }
            }
        }
        return count;
    }

    getNeighborCoordinates(x, y) {
        const neighbors = [];
        for (const {dx, dy} of this._offsets) {
            let nx = x + dx;
            let ny = y + dy;
            if (this.wrapEdges) {
                nx = ((nx % this.gridSize) + this.gridSize) % this.gridSize;
                ny = ((ny % this.gridSize) + this.gridSize) % this.gridSize;
            }
            if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
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