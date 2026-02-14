/**
 * TriangleGridManager - Gestión de grid triangular
 *
 * Usa coordenadas "doubled" para simplificar:
 * - Celdas apuntando arriba (△): (q, r) donde q + r es par
 * - Celdas apuntando abajo (▽): (q, r) donde q + r es impar
 */
class TriangleGridManager {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.grid = this._createEmptyGrid();
    }

    _createEmptyGrid() {
        return Array.from({length: this.width}, () => new Uint8Array(this.height));
    }

    getOrientation(q, r) {
        return ((q + r) & 1) === 0 ? 'up' : 'down';
    }

    /**
     * 3 vecinos: comparten arista
     */
    getEdgeNeighbors(q, r) {
        const orientation = this.getOrientation(q, r);
        const offsets = orientation === 'up'
            ? [[-1, 0], [1, 0], [0, 1]]   // NW, NE, S
            : [[0, -1], [-1, 0], [1, 0]]; // N, SW, SE

        return this._applyOffsets(q, r, offsets);
    }

    /**
     * 6 vecinos: aristas + vértices
     */
    getVertexNeighbors(q, r) {
        const orientation = this.getOrientation(q, r);
        const offsets = orientation === 'up'
            ? [[-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [1, 1]]
            : [[0, -1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, 1]];

        return this._applyOffsets(q, r, offsets);
    }

    _applyOffsets(q, r, offsets) {
        return offsets
            .map(([dq, dr]) => [q + dq, r + dr])
            .filter(([nq, nr]) => this.isValid(nq, nr));
    }

    isValid(q, r) {
        return q >= 0 && q < this.width && r >= 0 && r < this.height;
    }

    getCell(q, r) {
        if (!this.isValid(q, r)) return 0;
        return this.grid[q][r];
    }

    setCell(q, r, state) {
        if (!this.isValid(q, r)) return false;
        const changed = this.grid[q][r] !== state;
        this.grid[q][r] = state;
        return changed;
    }

    /**
     * Convierte a cartesianas para renderizado
     */
    toCartesian(q, r, size) {
        const x = q * size * 0.5;
        const y = r * size * Math.sqrt(3) / 2;
        const xOffset = (r & 1) * (size * 0.25);

        return {
            x: x + xOffset,
            y: y,
            orientation: this.getOrientation(q, r)
        };
    }

    /**
     * Hit-testing para mouse
     */
    fromCartesian(x, y, size) {
        const height = size * Math.sqrt(3) / 2;
        const r = Math.floor(y / height);
        const xOffset = (r & 1) * (size * 0.25);
        const q = Math.floor((x - xOffset) / (size * 0.5));

        // Encontrar triángulo más cercano
        const candidates = [[q, r], [q + 1, r], [q, r + 1], [q - 1, r], [q, r - 1]];
        let best = null, bestDist = Infinity;

        for (const [cq, cr] of candidates) {
            if (!this.isValid(cq, cr)) continue;
            const center = this.toCartesian(cq, cr, size);
            center.y += height / 3 * (center.orientation === 'up' ? 1 : -1);

            const dx = x - center.x, dy = y - center.y;
            const dist = dx * dx + dy * dy;

            if (dist < bestDist) {
                bestDist = dist;
                best = [cq, cr];
            }
        }

        return best ? {q: best[0], r: best[1]} : null;
    }

    resize(newWidth, newHeight) {
        const newGrid = this._createEmptyGrid();
        const copyW = Math.min(this.width, newWidth);
        const copyH = Math.min(this.height, newHeight);

        for (let q = 0; q < copyW; q++) {
            for (let r = 0; r < copyH; r++) {
                newGrid[q][r] = this.grid[q][r];
            }
        }

        this.width = newWidth;
        this.height = newHeight;
        this.grid = newGrid;

        return {grid: newGrid, wasResized: true};
    }

    clear() {
        for (let q = 0; q < this.width; q++) {
            this.grid[q].fill(0);
        }
    }

    countPopulation() {
        let count = 0;
        for (let q = 0; q < this.width; q++) {
            for (let r = 0; r < this.height; r++) {
                if (this.grid[q][r]) count++;
            }
        }
        return count;
    }
}

window.TriangleGridManager = TriangleGridManager;