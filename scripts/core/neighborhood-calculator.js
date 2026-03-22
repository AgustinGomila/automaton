/**
 * NeighborhoodCalculator — Cálculo de vecindad para autómatas celulares.
 *
 * Tipos soportados:
 *   'moore'   — cuadrado completo de (2R+1)² − 1 celdas
 *   'neumann' — diamante (|dx|+|dy| ≤ R)
 *   'custom'  — lista arbitraria de offsets [{dx,dy}] definida por el usuario
 *
 * Responsabilidad: calcular vecinos según tipo y radio.
 * Sin dependencias de estado del grid, solo cálculos geométricos.
 */
class NeighborhoodCalculator {
    /**
     * @param {Object}  options
     * @param {string}  options.type        — 'moore' | 'neumann' | 'custom'
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
     * Excluye 'custom' aunque tenga los mismos 8 offsets, para garantizar
     * que la lista exacta sea la esperada por el fastpath.
     */
    get isFastPath() {
        return this.type === 'moore' && this.radius === 1;
    }

    /**
     * Copia de los offsets activos. Uso: UI, worker, serialización.
     * @returns {Array<{dx:number,dy:number}>}
     */
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
     * Para presets (moore/neumann): pasar type y/o radius; los offsets se
     * recalculan automáticamente.
     *
     * Para vecindad personalizada: pasar offsets como array [{dx,dy}].
     * El tipo se establece a 'custom'; el radio NO cambia (la UI lo controla
     * para determinar el tamaño de la grilla visual).
     *
     * @param {Object}  options
     * @param {string}  [options.type]
     * @param {number}  [options.radius]
     * @param {boolean} [options.wrapEdges]
     * @param {number}  [options.gridSize]
     * @param {Array<{dx:number,dy:number}>} [options.offsets]  — activa tipo 'custom'
     */
    configure(options) {
        if (options.offsets !== undefined) {
            // Path de vecindad personalizada: offsets directos desde la UI.
            // Solo actualizamos type y _offsets; el radius lo conservamos
            // para que la grilla visual siga mostrando el tamaño correcto.
            this._offsets = options.offsets.map(o => ({dx: o.dx | 0, dy: o.dy | 0}));
            this.type = 'custom';
            if (options.wrapEdges !== undefined) this.wrapEdges = options.wrapEdges;
            if (options.gridSize !== undefined) this.gridSize = options.gridSize;
            return;
        }

        if (options.type !== undefined) this.type = options.type;
        if (options.radius !== undefined) this.radius = Math.max(1, Math.min(options.radius, 10));
        if (options.wrapEdges !== undefined) this.wrapEdges = options.wrapEdges;
        if (options.gridSize !== undefined) this.gridSize = options.gridSize;

        // Recalcular para presets (moore / neumann)
        if (this.type !== 'custom') {
            this._offsets = this._computeOffsets();
        }
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