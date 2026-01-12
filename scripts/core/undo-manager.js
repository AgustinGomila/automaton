/**
 * UndoManager para Autómata Celular
 * Guarda estados completos del grid usando serialización eficiente
 * Limitado a 50 estados por defecto para control de memoria
 */
class UndoManager {
    constructor(maxHistory = 50) {
        this.maxHistory = maxHistory;
        this.undoStack = [];
        this.redoStack = [];
        this.isTracking = false;
    }

    /**
     * @returns {number} Número de estados guardados
     */
    get undoCount() {
        return this.undoStack.length;
    }

    /**
     * @returns {number} Número de estados redo disponibles
     */
    get redoCount() {
        return this.redoStack.length;
    }

    /**
     * Guarda el estado actual antes de una modificación
     * @param {Uint8Array[][]} grid - Grid del autómata
     * @param {number} generation - Número de generación actual
     */
    saveState(grid, generation) {
        if (!this.isTracking || !grid) return;

        try {
            const serialized = this._serializeGrid(grid);

            // Guardar en undoStack
            this.undoStack.push({
                grid: serialized,
                generation: generation
            });

            // Limpiar redoStack (nueva rama de historial)
            this.redoStack = [];

            // Limitar tamaño (elimina el más antiguo)
            if (this.undoStack.length > this.maxHistory) {
                this.undoStack.shift();
                console.debug(`UndoManager: límite de historial alcanzado (${this.maxHistory})`);
            }

            console.debug(`UndoManager: estado guardado (undoStack: ${this.undoStack.length})`);

        } catch (error) {
            console.error('UndoManager: error al guardar estado:', error);
        }
    }

    /**
     * Serializa solo las celdas vivas para ahorrar memoria
     * @private
     */
    _serializeGrid(grid) {
        const size = grid.length;
        const aliveCells = [];

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (grid[x][y]) {
                    aliveCells.push({x, y});
                }
            }
        }

        return {
            size,
            aliveCells,
            timestamp: Date.now()
        };
    }

    /**
     * Deshace la última acción
     * @param {Uint8Array[][]} currentGrid - Grid actual (para guardar en redo)
     * @param {number} currentGeneration - Generación actual
     * @returns {object|null} - {grid, generation} o null si no hay historia
     */
    undo(currentGrid, currentGeneration) {
        if (this.undoStack.length === 0) {
            console.debug('UndoManager: no hay estados para deshacer');
            return null;
        }

        try {
            // Guardar estado actual en redoStack
            const currentSerialized = this._serializeGrid(currentGrid);
            this.redoStack.push({
                grid: currentSerialized,
                generation: currentGeneration
            });

            // Obtener estado anterior
            const previousState = this.undoStack.pop();
            const deserialized = this._deserializeState(previousState);

            console.debug(`UndoManager: deshacer ejecutado (undoStack: ${this.undoStack.length}, redoStack: ${this.redoStack.length})`);

            return deserialized;

        } catch (error) {
            console.error('UndoManager: error al deshacer:', error);
            return null;
        }
    }

    /**
     * Rehace la última acción deshecha
     * @param {Uint8Array[][]} currentGrid - Grid actual (para guardar en undo)
     * @param {number} currentGeneration - Generación actual
     * @returns {object|null} - {grid, generation} o null si no hay redo
     */
    redo(currentGrid, currentGeneration) {
        if (this.redoStack.length === 0) {
            console.debug('UndoManager: no hay estados para rehacer');
            return null;
        }

        try {
            // Guardar estado actual en undoStack
            const currentSerialized = this._serializeGrid(currentGrid);
            this.undoStack.push({
                grid: currentSerialized,
                generation: currentGeneration
            });

            // Obtener estado siguiente
            const nextState = this.redoStack.pop();
            const deserialized = this._deserializeState(nextState);

            console.debug(`UndoManager: rehacer ejecutado (undoStack: ${this.undoStack.length}, redoStack: ${this.redoStack.length})`);

            return deserialized;

        } catch (error) {
            console.error('UndoManager: error al rehacer:', error);
            return null;
        }
    }

    /**
     * Deserializa un estado guardado a grid completo
     * @private
     */
    _deserializeState(state) {
        const {grid: serialized, generation} = state;
        const {size, aliveCells} = serialized;

        // Crear grid vacío
        const newGrid = Array.from({length: size}, () =>
            new Uint8Array(size)
        );

        // Marcar celdas vivas
        aliveCells.forEach(({x, y}) => {
            if (x < size && y < size) {
                newGrid[x][y] = 1;
            }
        });

        return {grid: newGrid, generation};
    }

    /**
     * Limpia todo el historial
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        console.debug('UndoManager: historial limpiado');
    }

    /**
     * Activa el seguimiento de estados
     */
    startTracking() {
        this.isTracking = true;
        console.debug('UndoManager: seguimiento activado');
    }

    /**
     * Desactiva el seguimiento de estados
     */
    stopTracking() {
        this.isTracking = false;
        console.debug('UndoManager: seguimiento desactivado');
    }
}

// Exportar global
window.UndoManager = UndoManager;