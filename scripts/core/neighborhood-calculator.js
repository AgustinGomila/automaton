/**
 * NeighborhoodCalculator - Cálculo de vecindad para autómatas celulares
 * Responsabilidad: Calcular vecinos según tipo (Moore/Neumann) y radio
 * Sin dependencias de estado del grid, solo cálculos geométricos
 */
class NeighborhoodCalculator {
    /**
     * @param {Object} options
     * @param {string} options.type - 'moore' o 'neumann'
     * @param {number} options.radius - Radio de vecindad (default: 1)
     * @param {boolean} options.wrapEdges - Si es toroidal (default: true)
     * @param {number} options.gridSize - Tamaño del grid para cálculo de wrap
     */
    constructor(options = {}) {
        this.type = options.type || 'moore';
        this.radius = Math.max(1, Math.min(options.radius || 1, 10));
        this.wrapEdges = options.wrapEdges !== false;
        this.gridSize = options.gridSize || 200;

        // Pre-calcular offsets para optimización
        this._offsets = this._computeOffsets();
    }

    /**
     * Versión estática: calcula vecinos para un grid específico sin instancia
     * @param {number} x
     * @param {number} y
     * @param {Uint8Array[]} grid
     * @param {string} type
     * @param {number} radius
     * @param {boolean} wrap
     * @returns {number}
     */
    static count(x, y, grid, type = 'moore', radius = 1, wrap = true) {
        const size = grid.length;
        let count = 0;

        const calculator = new NeighborhoodCalculator({
            type, radius, wrapEdges: wrap, gridSize: size
        });

        return calculator.countNeighbors(x, y, (nx, ny) => grid[nx]?.[ny] || 0);
    }

    /**
     * Calcula los offsets de vecinos según tipo y radio
     * @returns {Array<{dx: number, dy: number}>}
     * @private
     */
    _computeOffsets() {
        const offsets = [];

        for (let dx = -this.radius; dx <= this.radius; dx++) {
            for (let dy = -this.radius; dy <= this.radius; dy++) {
                // Saltar la celda central
                if (dx === 0 && dy === 0) continue;

                // Para Neumann, solo celdas donde |dx| + |dy| <= radius
                if (this.type === 'neumann' && Math.abs(dx) + Math.abs(dy) > this.radius) {
                    continue;
                }

                offsets.push({dx, dy});
            }
        }

        return offsets;
    }

    /**
     * Actualiza configuración y recalcula offsets
     * @param {Object} options
     */
    configure(options) {
        if (options.type !== undefined) this.type = options.type;
        if (options.radius !== undefined) this.radius = Math.max(1, Math.min(options.radius, 10));
        if (options.wrapEdges !== undefined) this.wrapEdges = options.wrapEdges;
        if (options.gridSize !== undefined) this.gridSize = options.gridSize;

        this._offsets = this._computeOffsets();
    }

    /**
     * Cuenta vecinos vivos para una celda específica
     * @param {number} x - Coordenada X de la celda
     * @param {number} y - Coordenada Y de la celda
     * @param {Function} getCell - Función (x, y) => state para consultar el grid
     * @returns {number} Cantidad de vecinos vivos
     */
    countNeighbors(x, y, getCell) {
        let count = 0;

        for (const {dx, dy} of this._offsets) {
            let nx = x + dx;
            let ny = y + dy;

            if (this.wrapEdges) {
                // Modo toroidal
                nx = ((nx % this.gridSize) + this.gridSize) % this.gridSize;
                ny = ((ny % this.gridSize) + this.gridSize) % this.gridSize;
                count += getCell(nx, ny);
            } else {
                // Modo paredes duras
                if (nx >= 0 && nx < this.gridSize && ny >= 0 && ny < this.gridSize) {
                    count += getCell(nx, ny);
                }
            }
        }

        return count;
    }

    /**
     * Obtiene las coordenadas de todos los vecinos (útil para visualización)
     * @param {number} x - Coordenada X central
     * @param {number} y - Coordenada Y central
     * @returns {Array<{x: number, y: number}>} Coordenadas de vecinos
     */
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

    /**
     * Obtiene información de la configuración actual
     * @returns {Object}
     */
    getInfo() {
        return {
            type: this.type,
            radius: this.radius,
            wrapEdges: this.wrapEdges,
            neighborCount: this._offsets.length
        };
    }
}

// Exportar global
window.NeighborhoodCalculator = NeighborhoodCalculator;