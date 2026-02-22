/**
 * GridManager - Gestión pura del grid de celdas
 * Responsabilidad: Crear, redimensionar y acceder al grid bidimensional
 * Sin dependencias de UI, renderizado o reglas específicas
 */
class GridManager {
    constructor(size) {
        this.size = size;
        this.grid = this._createEmptyGrid(size);
        this._backGrid = this._createEmptyGrid(size);
    }

    /**
     * Devuelve el buffer trasero para que RuleEngine escriba en él.
     * @returns {Uint8Array[]}
     */
    getBackGrid() {
        return this._backGrid;
    }

    /**
     * Intercambia front y back buffer tras una generación calculada.
     * El resultado de RuleEngine pasa a ser el grid activo sin copiar datos.
     */
    swapBuffers() {
        const tmp = this.grid;
        this.grid = this._backGrid;
        this._backGrid = tmp;
    }

    /**
     * Crea un grid vacío de tamaño específico
     * @param {number} size - Tamaño del grid (size × size)
     * @returns {Uint8Array[]} Grid como array de columnas (column-major)
     * @private
     */
    _createEmptyGrid(size) {
        return Array.from({length: size}, () => new Uint8Array(size));
    }

    /**
     * Redimensiona el grid manteniendo el contenido existente donde sea posible
     * @param {number} newSize - Nuevo tamaño deseado
     * @returns {Object} {grid, wasResized}
     */
    resize(newSize) {
        const oldSize = this.size;
        const oldGrid = this.grid;

        // Crear nuevos grids (front + back)
        const newGrid = this._createEmptyGrid(newSize);

        // Copiar datos existentes (intersección de tamaños)
        const copySize = Math.min(oldSize, newSize);
        for (let x = 0; x < copySize; x++) {
            for (let y = 0; y < copySize; y++) {
                newGrid[x][y] = oldGrid[x][y];
            }
        }

        this.size = newSize;
        this.grid = newGrid;
        this._backGrid = this._createEmptyGrid(newSize);

        return {
            grid: newGrid,
            wasResized: newSize !== oldSize
        };
    }

    /**
     * Obtiene el estado de una celda
     * @param {number} x - Coordenada X
     * @param {number} y - Coordenada Y
     * @returns {number} 0 o 1
     */
    getCell(x, y) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) return 0;
        return this.grid[x][y];
    }

    /**
     * Establece el estado de una celda
     * @param {number} x - Coordenada X
     * @param {number} y - Coordenada Y
     * @param {number} state - 0 o 1
     * @returns {boolean} true si cambió el estado
     */
    setCell(x, y, state) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;

        const current = this.grid[x][y];
        if (current !== state) {
            this.grid[x][y] = state;
            return true;
        }
        return false;
    }

    /**
     * Limpia todo el grid (todas las celdas a 0)
     */
    clear() {
        for (let x = 0; x < this.size; x++) {
            this.grid[x].fill(0);
        }
    }

    /**
     * Cuenta población total
     * @returns {number} Cantidad de celdas vivas
     */
    countPopulation() {
        let count = 0;
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                if (this.grid[x][y]) count++;
            }
        }
        return count;
    }

    /**
     * Serializa el estado actual (para undo/export)
     * @returns {Object} {size, aliveCells: [{x, y}, ...]}
     */
    serialize() {
        const aliveCells = [];
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                if (this.grid[x][y]) {
                    aliveCells.push({x, y});
                }
            }
        }
        return {
            size: this.size,
            aliveCells,
            timestamp: Date.now()
        };
    }

    /**
     * Deserializa estado guardado
     * @param {Object} data - Datos serializados
     * @returns {boolean} true si se restauró correctamente
     */
    deserialize(data) {
        if (!data || !data.size || !Array.isArray(data.aliveCells)) {
            return false;
        }

        // Redimensionar si es necesario
        if (data.size !== this.size) {
            this.resize(data.size);
        }

        this.clear();

        // Restaurar celdas vivas
        for (const {x, y} of data.aliveCells) {
            if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
                this.grid[x][y] = 1;
            }
        }

        return true;
    }

    /**
     * Crea una copia profunda del grid actual
     * @returns {Uint8Array[]} Copia del grid
     */
    clone() {
        const cloned = this._createEmptyGrid(this.size);
        for (let x = 0; x < this.size; x++) {
            cloned[x].set(this.grid[x]);
        }
        return cloned;
    }

    /**
     * Obtiene estadísticas básicas del grid
     * @returns {Object} {size, population, density}
     */
    getStats() {
        const population = this.countPopulation();
        const totalCells = this.size * this.size;
        return {
            size: this.size,
            population,
            density: ((population / totalCells) * 100).toFixed(1)
        };
    }
}

// Exportar global para compatibilidad
window.GridManager = GridManager;