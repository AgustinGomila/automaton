/**
 * TriangleGridManager - Gestión de grid triangular
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
        // Sistema correcto: alternancia por (q + r)
        // (0,0)=up, (0,1)=down, (0,2)=up...
        // (1,0)=down, (1,1)=up, (1,2)=down...
        return ((q + r) & 1) === 0 ? 'up' : 'down';
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

    toCartesian(q, r, size) {
        const h = size * Math.sqrt(3) / 2;
        const isUp = this.getOrientation(q, r) === 'up';

        const x = q * (size / 2);
        const y = r * h;

        return {
            x: x,
            y: y,
            orientation: isUp ? 'up' : 'down'
        };
    }

    fromCartesian(x, y, size) {
        const h = size * Math.sqrt(3) / 2;

        const qApprox = x / (size / 2);
        const rApprox = y / h;

        const q = Math.floor(qApprox);
        const r = Math.floor(rApprox);

        // Buscar mejor celda en vecindad
        let best = null, bestDist = Infinity;

        for (let dq = -1; dq <= 1; dq++) {
            for (let dr = -1; dr <= 1; dr++) {
                const cq = q + dq, cr = r + dr;
                if (!this.isValid(cq, cr)) continue;

                const pos = this.toCartesian(cq, cr, size);
                const orient = this.getOrientation(cq, cr);

                // Centro del triángulo
                const cx = pos.x + size / 2;
                const cy = pos.y + (orient === 'up' ? h / 3 : 2 * h / 3);

                const dx = x - cx, dy = y - cy;
                const dist = dx * dx + dy * dy;

                if (dist < bestDist) {
                    bestDist = dist;
                    best = [cq, cr];
                }
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
        for (let q = 0; q < this.width; q++) this.grid[q].fill(0);
    }

    countPopulation() {
        let count = 0;
        for (let q = 0; q < this.width; q++)
            for (let r = 0; r < this.height; r++)
                if (this.grid[q][r]) count++;
        return count;
    }
}

window.TriangleGridManager = TriangleGridManager;