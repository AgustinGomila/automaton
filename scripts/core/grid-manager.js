import {AppConfig} from '../utils/config.js';

/**
 * GridManager - Gestión pura del grid de celdas.
 *
 * Soporta grids rectangulares (width × height).
 * El almacenamiento es column-major: grid[x] es una columna Uint8Array de
 * longitud `height`. El índice plano transferible es x * height + y.
 *
 * Compatibilidad hacia atrás:
 *   • Constructor acepta (size) → grid cuadrado size×size.
 *   • Getter `size` devuelve Math.max(width, height) para código legacy.
 */
class GridManager {
    /**
     * @param {number} width
     * @param {number} [height=width] — omitir para grid cuadrado
     */
    constructor(width, height = width) {
        this.width = Math.max(AppConfig.GRID.MIN_CELLS, Math.min(AppConfig.GRID.MAX_CELLS, width));
        this.height = Math.max(AppConfig.GRID.MIN_CELLS, Math.min(AppConfig.GRID.MAX_CELLS, height));
        this.grid = this._createEmptyGrid(this.width, this.height);
        this._backGrid = this._createEmptyGrid(this.width, this.height);
    }

    /** Dimensión mayor — sólo para código legacy que necesite un único número. */
    get size() {
        return Math.max(this.width, this.height);
    }

    // =========================================
    // DOBLE BUFFER
    // =========================================

    /** Devuelve el back-buffer para que RuleEngine escriba en él. */
    getBackGrid() {
        return this._backGrid;
    }

    /** Intercambia front ↔ back buffer sin copiar datos. */
    swapBuffers() {
        const tmp = this.grid;
        this.grid = this._backGrid;
        this._backGrid = tmp;
    }

    // =========================================
    // DESPLAZAMIENTO TOROIDAL
    // =========================================

    /**
     * Desplaza el contenido del grid toroidalmente.
     * @param {number} dx — celdas en X (positivo = derecha)
     * @param {number} dy — celdas en Y (positivo = abajo)
     */
    shift(dx, dy) {
        const {width, height} = this;
        const src = this.grid, dst = this._backGrid;

        for (let x = 0; x < width; x++) {
            const srcX = ((x - dx) % width + width) % width;
            const srcCol = src[srcX];
            const dstCol = dst[x];
            for (let y = 0; y < height; y++) {
                dstCol[y] = srcCol[((y - dy) % height + height) % height];
            }
        }

        // Swap: dst pasa a ser el grid activo
        this.grid = dst;
        this._backGrid = src;
    }

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Crea un grid vacío width × height (column-major).
     * @returns {Uint8Array[]} Array de `width` columnas de `height` celdas
     */
    _createEmptyGrid(width, height) {
        return Array.from({length: width}, () => new Uint8Array(height));
    }

    // =========================================
    // REDIMENSIONADO
    // =========================================

    /**
     * Redimensiona conservando el contenido en la intersección de tamaños.
     * @param {number} newWidth
     * @param {number} [newHeight=newWidth]
     * @returns {{ grid: Uint8Array[], wasResized: boolean }}
     */
    resize(newWidth, newHeight = newWidth) {
        const w = Math.max(AppConfig.GRID.MIN_CELLS, Math.min(AppConfig.GRID.MAX_CELLS, newWidth));
        const h = Math.max(AppConfig.GRID.MIN_CELLS, Math.min(AppConfig.GRID.MAX_CELLS, newHeight));

        const oldGrid = this.grid;
        const oldW = this.width;
        const oldH = this.height;

        const newGrid = this._createEmptyGrid(w, h);
        const copyW = Math.min(oldW, w);
        const copyH = Math.min(oldH, h);
        for (let x = 0; x < copyW; x++) {
            for (let y = 0; y < copyH; y++) {
                newGrid[x][y] = oldGrid[x][y];
            }
        }

        this.width = w;
        this.height = h;
        this.grid = newGrid;
        this._backGrid = this._createEmptyGrid(w, h);

        return {grid: newGrid, wasResized: w !== oldW || h !== oldH};
    }

    // =========================================
    // ACCESO A CELDAS
    // =========================================

    /** @returns {number} 0 o 1, o 0 si (x,y) está fuera de rango */
    getCell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
        return this.grid[x][y];
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} state — 0 o 1
     * @returns {boolean} true si cambió el estado
     */
    setCell(x, y, state) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        const current = this.grid[x][y];
        if (current !== state) {
            this.grid[x][y] = state;
            return true;
        }
        return false;
    }

    /** Pone todas las celdas a 0. */
    clear() {
        for (let x = 0; x < this.width; x++) this.grid[x].fill(0);
    }

    /** @returns {number} Total de celdas vivas */
    countPopulation() {
        let count = 0;
        for (let x = 0; x < this.width; x++) {
            const col = this.grid[x];
            for (let y = 0; y < this.height; y++) {
                if (col[y]) count++;
            }
        }
        return count;
    }

    // =========================================
    // SERIALIZACIÓN
    // =========================================

    /**
     * Serializa el estado actual para undo/export.
     * @returns {{ width, height, aliveCells: {x,y}[], timestamp }}
     */
    serialize() {
        const aliveCells = [];
        for (let x = 0; x < this.width; x++) {
            const col = this.grid[x];
            for (let y = 0; y < this.height; y++) {
                if (col[y]) aliveCells.push({x, y});
            }
        }
        return {width: this.width, height: this.height, aliveCells, timestamp: Date.now()};
    }

    /**
     * Restaura estado guardado.
     * Acepta tanto el formato nuevo {width, height} como el legado {size}.
     * @returns {boolean} true si se restauró correctamente
     */
    deserialize(data) {
        if (!data || !Array.isArray(data.aliveCells)) return false;

        // Compatibilidad con formato legacy {size}
        const w = data.width ?? data.size;
        const h = data.height ?? data.size;
        if (!w || !h) return false;

        if (w !== this.width || h !== this.height) this.resize(w, h);
        this.clear();

        for (const {x, y} of data.aliveCells) {
            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                this.grid[x][y] = 1;
            }
        }
        return true;
    }

    /**
     * Copia profunda del grid activo.
     * @returns {Uint8Array[]}
     */
    clone() {
        const cloned = this._createEmptyGrid(this.width, this.height);
        for (let x = 0; x < this.width; x++) cloned[x].set(this.grid[x]);
        return cloned;
    }

    /**
     * @returns {{ width, height, size, population, density }}
     */
    getStats() {
        const population = this.countPopulation();
        const totalCells = this.width * this.height;
        return {
            width: this.width,
            height: this.height,
            size: this.size,
            population,
            density: ((population / totalCells) * 100).toFixed(1)
        };
    }
}

export {GridManager};