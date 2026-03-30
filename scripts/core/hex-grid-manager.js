/**
 * HexGridManager — Gestión de grid hexagonal.
 *
 * Usa coordenadas offset odd-r (pointy-top):
 *   - Las filas impares están desplazadas media celda a la derecha.
 *   - Cada celda tiene exactamente 6 vecinos (E, NE, NW, W, SW, SE).
 *   - Índice interno: grid[col][row], column-major.
 *
 * Geometría por celda (pointy-top, radio = size):
 *   ancho  = size × √3
 *   alto   = size × 2
 *   offset = size × √3/2  (desplazamiento horizontal de filas impares)
 *
 * Canvas dimensions:
 *   canvasW = (cols − 1) × size×√3  + size×√3
 *           = cols × size × √3
 *   canvasH = rows × size × 1.5  + size × 0.5
 *
 * Referencia: redblobgames.com/grids/hexagons/ (offset coordinates)
 */
class HexGridManager {
    /**
     * @param {number} cols — columnas del grid hexagonal
     * @param {number} rows — filas del grid hexagonal
     */
    constructor(cols, rows) {
        this.width = cols;   // alias: columnas
        this.height = rows;   // alias: filas
        this.grid = this._createEmptyGrid();
    }

    /**
     * Vertices del hexágono pointy-top relativo a su centro (0,0).
     * @param {number} size
     * @returns {Array<[number,number]>}
     */
    static hexVertices(size) {
        const verts = [];
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i - 30); // pointy-top: empieza a -30°
            verts.push([size * Math.cos(angle), size * Math.sin(angle)]);
        }
        return verts;
    }

    _createEmptyGrid() {
        return Array.from({length: this.width}, () => new Uint8Array(this.height));
    }

    isValid(col, row) {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    getCell(col, row) {
        if (!this.isValid(col, row)) return 0;
        return this.grid[col][row];
    }

    setCell(col, row, state) {
        if (!this.isValid(col, row)) return false;
        const changed = this.grid[col][row] !== state;
        this.grid[col][row] = state;
        return changed;
    }

    /**
     * Los 6 vecinos de (col, row) en coordenadas offset odd-r.
     * Las filas impares (row & 1 === 1) tienen los vecinos NE/NW desplazados +1 en col.
     * @returns {Array<[number,number]>} pares [col, row] válidos
     */
    getNeighbors(col, row) {
        const isOdd = (row & 1) === 1;
        const d = isOdd
            ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]]   // filas impares
            : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]]; // filas pares

        const result = [];
        for (const [dc, dr] of d) {
            const nc = col + dc;
            const nr = row + dr;
            if (this.isValid(nc, nr)) result.push([nc, nr]);
        }
        return result;
    }

    /**
     * Cuenta vecinos vivos de (col, row) — todos los 6 posibles con wrap toroidal opcional.
     * @param {number}  col
     * @param {number}  row
     * @param {boolean} wrap
     * @returns {number} 0–6
     */
    countLiveNeighbors(col, row, wrap) {
        const w = this.width, h = this.height;
        const isOdd = (row & 1) === 1;
        const d = isOdd
            ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]]
            : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];

        let n = 0;
        for (const [dc, dr] of d) {
            let nc = col + dc;
            let nr = row + dr;
            if (wrap) {
                nc = ((nc % w) + w) % w;
                nr = ((nr % h) + h) % h;
            } else if (nc < 0 || nc >= w || nr < 0 || nr >= h) {
                continue;
            }
            n += this.grid[nc][nr];
        }
        return n;
    }

    /**
     * Convierte coordenadas de celda (col, row) a píxeles del canvas.
     * Pointy-top, odd-r offset.
     * @param {number} col
     * @param {number} row
     * @param {number} size — radio del hexágono (centro a vértice)
     * @returns {{x: number, y: number}} — esquina superior izquierda del bounding box
     */
    toPixel(col, row, size) {
        const w = size * Math.sqrt(3);      // ancho del hexágono
        const h = size * 2;                 // alto del hexágono
        const offset = (row & 1) === 1 ? w / 2 : 0;  // desplazamiento filas impares

        return {
            x: col * w + offset,
            y: row * (h * 0.75)
        };
    }

    /**
     * Convierte píxeles del canvas a coordenadas de celda.
     * Usa una aproximación con corrección por vecindad.
     * @param {number} px
     * @param {number} py
     * @param {number} size
     * @returns {{col: number, row: number}|null}
     */
    fromPixel(px, py, size) {
        const w = size * Math.sqrt(3);
        const h3 = size * 1.5;               // h * 0.75 = size * 3/2 = paso vertical

        // Estimación inicial de fila/columna
        const rowEst = py / h3;
        const row = Math.floor(rowEst);
        const offset = (row & 1) === 1 ? w / 2 : 0;
        const colEst = (px - offset) / w;
        const col = Math.floor(colEst);

        // Buscar la celda más cercana en una vecindad 3×3
        let best = null, bestDist = Infinity;
        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const nc = col + dc;
                const nr = row + dr;
                if (!this.isValid(nc, nr)) continue;

                const {x, y} = this.toPixel(nc, nr, size);
                // Centro del hexágono
                const cx = x + w / 2;
                const cy = y + size;

                const dx = px - cx, dy = py - cy;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                    bestDist = dist;
                    best = {col: nc, row: nr};
                }
            }
        }
        return best;
    }

    resize(newCols, newRows) {
        const newGrid = Array.from({length: newCols}, () => new Uint8Array(newRows));
        const copyC = Math.min(this.width, newCols);
        const copyR = Math.min(this.height, newRows);

        for (let c = 0; c < copyC; c++) {
            for (let r = 0; r < copyR; r++) {
                newGrid[c][r] = this.grid[c][r];
            }
        }

        this.width = newCols;
        this.height = newRows;
        this.grid = newGrid;
        return {grid: newGrid, wasResized: true};
    }

    clear() {
        for (let c = 0; c < this.width; c++) this.grid[c].fill(0);
    }

    countPopulation() {
        let count = 0;
        for (let c = 0; c < this.width; c++)
            for (let r = 0; r < this.height; r++)
                if (this.grid[c][r]) count++;
        return count;
    }

    shift(dx, dy) {
        const w = this.width, h = this.height;
        const dst = Array.from({length: w}, () => new Uint8Array(h));
        for (let c = 0; c < w; c++) {
            const srcC = ((c - dx) % w + w) % w;
            const srcCol = this.grid[srcC];
            const dstCol = dst[c];
            for (let r = 0; r < h; r++) {
                dstCol[r] = srcCol[((r - dy) % h + h) % h];
            }
        }
        this.grid = dst;
    }
}

window.HexGridManager = HexGridManager;