/**
 * StateManager - Gestión completa del estado del autómata
 *
 * Responsabilidades:
 * - Undo/Redo con historial de estados
 * - Import/Export de patrones (JSON)
 * - Copiar/Pegar áreas del grid
 * - Operaciones de estado: clear, randomize
 * - Historial de población
 */

class StateManager {
    constructor(gridManager, options = {}) {
        this.gridManager = gridManager;

        // Configuración
        this.maxHistory = options.maxHistory || 50;
        this.maxPopulationHistory = options.maxPopulationHistory || 100;

        // Undo/Redo
        this.undoStack = [];
        this.redoStack = [];
        this.isTracking = false;

        // Historial de población para análisis
        this.populationHistory = new CircularArray(this.maxPopulationHistory);

        // Callbacks para notificar cambios
        this._callbacks = {
            onStateChange: null,      // {type, data}
            onHistoryChange: null,    // {undoCount, redoCount}
            onPopulationChange: null  // {population, density}
        };
    }

    // =========================================
    // CALLBACKS
    // =========================================

    get undoCount() {
        return this.undoStack.length;
    }

    get redoCount() {
        return this.redoStack.length;
    }

    // =========================================
    // TRACKING DE ESTADO
    // =========================================

    get canUndo() {
        return this.undoStack.length > 0;
    }

    get canRedo() {
        return this.redoStack.length > 0;
    }

    on(callbacks) {
        Object.assign(this._callbacks, callbacks);
        return this;
    }

    // =========================================
    // UNDO / REDO
    // =========================================

    _emit(type, data) {
        if (this._callbacks[type]) {
            this._callbacks[type](data);
        }
    }

    startTracking() {
        this.isTracking = true;
        return this;
    }

    stopTracking() {
        this.isTracking = false;
        return this;
    }

    // =========================================
    // PROPIEDADES DE HISTORIAL
    // =========================================

    /**
     * Guarda el estado actual en el historial de undo
     */
    saveState(generation = 0) {
        if (!this.isTracking || !this.gridManager) return false;

        try {
            const serialized = this.gridManager.serialize();

            this.undoStack.push({
                ...serialized,
                generation
            });

            // Limpiar redoStack (nueva rama de historial)
            if (this.redoStack.length > 0) {
                this.redoStack = [];
                this._emit('onHistoryChange', {
                    undoCount: this.undoStack.length,
                    redoCount: 0
                });
            }

            // Limitar tamaño
            if (this.undoStack.length > this.maxHistory) {
                this.undoStack.shift();
            }

            this._emit('onHistoryChange', {
                undoCount: this.undoStack.length,
                redoCount: this.redoStack.length
            });

            return true;
        } catch (error) {
            console.error('StateManager: Error al guardar estado:', error);
            return false;
        }
    }

    /**
     * @returns {Object|null} {grid, generation} o null si no hay historial
     */
    undo(currentGeneration = 0) {
        if (this.undoStack.length === 0) {
            return null;
        }

        try {
            // Guardar estado actual en redoStack
            const currentState = this.gridManager.serialize();
            this.redoStack.push({
                ...currentState,
                generation: currentGeneration
            });

            // Limitar redoStack
            if (this.redoStack.length > this.maxHistory) {
                this.redoStack.shift();
            }

            // Restaurar estado anterior
            const previousState = this.undoStack.pop();
            this.gridManager.deserialize(previousState);

            this._emit('onStateChange', {
                type: 'undo',
                generation: previousState.generation
            });

            this._emit('onHistoryChange', {
                undoCount: this.undoStack.length,
                redoCount: this.redoStack.length
            });

            return {
                grid: this.gridManager.grid,
                generation: previousState.generation
            };

        } catch (error) {
            console.error('StateManager: Error al deshacer:', error);
            return null;
        }
    }

    /**
     * @returns {Object|null} {grid, generation} o null si no hay redo
     */
    redo(currentGeneration = 0) {
        if (this.redoStack.length === 0) {
            return null;
        }

        try {
            // Guardar estado actual en undoStack
            const currentState = this.gridManager.serialize();
            this.undoStack.push({
                ...currentState,
                generation: currentGeneration
            });

            // Restaurar estado siguiente
            const nextState = this.redoStack.pop();
            this.gridManager.deserialize(nextState);

            this._emit('onStateChange', {
                type: 'redo',
                generation: nextState.generation
            });

            this._emit('onHistoryChange', {
                undoCount: this.undoStack.length,
                redoCount: this.redoStack.length
            });

            return {
                grid: this.gridManager.grid,
                generation: nextState.generation
            };

        } catch (error) {
            console.error('StateManager: Error al rehacer:', error);
            return null;
        }
    }

    /**
     * Limpia todo el historial
     */
    clearHistory() {
        this.undoStack = [];
        this.redoStack = [];
        this.populationHistory.clear();

        this._emit('onHistoryChange', {
            undoCount: 0,
            redoCount: 0
        });

        return this;
    }

    // =========================================
    // OPERACIONES DE ESTADO
    // =========================================

    /**
     * Limpia todo el grid
     * @param {Object} options
     * @param {boolean} options.saveToHistory - Guardar estado anterior
     * @param {number} options.generation - Generación actual para historial
     */
    clear(options = {}) {
        const {saveToHistory = true, generation = 0} = options;

        if (saveToHistory && this.isTracking) {
            this.saveState(generation);
        }

        this.gridManager.clear();

        this._emit('onStateChange', {
            type: 'clear',
            generation: 0
        });

        return {
            grid: this.gridManager.grid,
            population: 0,
            generation: 0
        };
    }

    /**
     * Genera estado aleatorio
     * @param {Object} options
     * @param {number} options.density - Densidad entre 0 y 1
     * @param {boolean} options.saveToHistory - Guardar estado anterior
     * @param {number} options.generation - Generación actual
     */
    randomize(options = {}) {
        const {
            density = 0.35,
            saveToHistory = true,
            generation = 0
        } = options;

        const validDensity = Math.max(0, Math.min(1, density));

        if (saveToHistory && this.isTracking) {
            this.saveState(generation);
        }

        // Generar estado aleatorio
        const size = this.gridManager.size;
        const grid = this.gridManager.grid;

        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                grid[x][y] = Math.random() < validDensity ? 1 : 0;
            }
        }

        const stats = this.gridManager.getStats();
        this.populationHistory.clear();

        this._emit('onStateChange', {
            type: 'randomize',
            density: validDensity,
            stats
        });

        return stats;
    }

    // =========================================
    // EDICIÓN DE ÁREAS
    // =========================================

    /**
     * Copia un área del grid
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @returns {Object} {grid, width, height}
     */
    copyArea(minX, minY, maxX, maxY) {
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const grid = Array.from({length: width}, () => Array(height).fill(false));

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (x >= 0 && x < this.gridManager.size && y >= 0 && y < this.gridManager.size) {
                    grid[x - minX][y - minY] = this.gridManager.getCell(x, y);
                }
            }
        }

        return {grid, width, height};
    }

    /**
     * Pega un área en el grid
     * @param {Object} area - {grid, width, height}
     * @param {number} offsetX
     * @param {number} offsetY
     * @param {Object} options
     * @param {boolean} options.saveToHistory
     * @param {number} options.generation
     * @returns {Object} {changedCells, stats}
     */
    pasteArea(area, offsetX, offsetY, options = {}) {
        const {saveToHistory = true, generation = 0} = options;

        if (!area?.grid) {
            return {changedCells: [], stats: this.gridManager.getStats()};
        }

        if (saveToHistory && this.isTracking) {
            this.saveState(generation);
        }

        const width = area.width;
        const height = area.height;
        const size = this.gridManager.size;
        const changedCells = [];

        for (let x = 0; x < width; x++) {
            const gridX = offsetX + x;
            if (gridX < 0 || gridX >= size) continue;

            for (let y = 0; y < height; y++) {
                const gridY = offsetY + y;
                if (gridY < 0 || gridY >= size) continue;

                const newState = area.grid[x][y] ? 1 : 0;
                const currentState = this.gridManager.getCell(gridX, gridY);

                if (currentState !== newState) {
                    this.gridManager.setCell(gridX, gridY, newState);
                    changedCells.push({x: gridX, y: gridY, from: currentState, to: newState});
                }
            }
        }

        const stats = this.gridManager.getStats();

        this._emit('onStateChange', {
            type: 'paste',
            changedCount: changedCells.length,
            stats
        });

        return {changedCells, stats};
    }

    /**
     * Limpia un área del grid
     * @param {number} minX
     * @param {number} minY
     * @param {number} maxX
     * @param {number} maxY
     * @param {Object} options
     * @param {boolean} options.saveToHistory
     * @param {number} options.generation
     * @returns {Object} {changedCells, stats}
     */
    clearArea(minX, minY, maxX, maxY, options = {}) {
        const {saveToHistory = true, generation = 0} = options;

        if (saveToHistory && this.isTracking) {
            this.saveState(generation);
        }

        const startX = Math.max(0, minX);
        const endX = Math.min(maxX, this.gridManager.size - 1);
        const startY = Math.max(0, minY);
        const endY = Math.min(maxY, this.gridManager.size - 1);

        const changedCells = [];

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                if (this.gridManager.getCell(x, y)) {
                    this.gridManager.setCell(x, y, 0);
                    changedCells.push({x, y, from: 1, to: 0});
                }
            }
        }

        const stats = this.gridManager.getStats();

        this._emit('onStateChange', {
            type: 'clearArea',
            changedCount: changedCells.length,
            stats
        });

        return {changedCells, stats};
    }

    // =========================================
    // IMPORT / EXPORT
    // =========================================

    /**
     * Exporta el patrón actual como objeto JSON
     * @returns {Object|null} {pattern, name, description} o null si está vacío
     */
    exportPattern() {
        const size = this.gridManager.size;
        let minX = size, minY = size;
        let maxX = 0, maxY = 0;

        // Encontrar bounds del patrón
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (this.gridManager.getCell(x, y)) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        }

        if (minX > maxX || minY > maxY) return null;

        // Extraer patrón
        const pattern = [];
        for (let y = minY; y <= maxY; y++) {
            const row = [];
            for (let x = minX; x <= maxX; x++) {
                row.push(this.gridManager.getCell(x, y) ? 1 : 0);
            }
            pattern.push(row);
        }

        return {
            pattern,
            name: `Pattern ${new Date().toLocaleDateString()}`,
            description: 'Exported from cellular automaton',
            bounds: {minX, minY, maxX, maxY}
        };
    }

    /**
     * Importa un patrón al grid
     * @param {Object} patternData - {pattern, name, description, ...}
     * @param {number} centerX - Centro X donde colocar
     * @param {number} centerY - Centro Y donde colocar
     * @param {Object} options
     * @param {boolean} options.saveToHistory
     * @param {number} options.generation
     * @returns {Object} {changedCells, stats}
     */
    importPattern(patternData, centerX, centerY, options = {}) {
        const {saveToHistory = true, generation = 0} = options;

        // Manejar patrón aleatorio especial
        if (patternData?.pattern === 'random') {
            return this.randomize({
                density: 0.35,
                saveToHistory,
                generation
            });
        }

        if (!patternData?.pattern || !Array.isArray(patternData.pattern)) {
            return {changedCells: [], stats: this.gridManager.getStats()};
        }

        if (saveToHistory && this.isTracking) {
            this.saveState(generation);
        }

        const pattern = patternData.pattern;
        const offsetX = Math.floor(pattern[0].length / 2);
        const offsetY = Math.floor(pattern.length / 2);
        const size = this.gridManager.size;
        const changedCells = [];

        for (let row = 0; row < pattern.length; row++) {
            for (let col = 0; col < pattern[row].length; col++) {
                if (pattern[row][col] === 1) {
                    const gridX = centerX - offsetX + col;
                    const gridY = centerY - offsetY + row;

                    if (gridX >= 0 && gridX < size && gridY >= 0 && gridY < size) {
                        if (!this.gridManager.getCell(gridX, gridY)) {
                            this.gridManager.setCell(gridX, gridY, 1);
                            changedCells.push({x: gridX, y: gridY, from: 0, to: 1});
                        }
                    }
                }
            }
        }

        const stats = this.gridManager.getStats();

        this._emit('onStateChange', {
            type: 'import',
            patternName: patternData.name,
            changedCount: changedCells.length,
            stats
        });

        return {changedCells, stats};
    }

    /**
     * Descarga el patrón actual como archivo JSON
     */
    downloadPattern(filename = null) {
        const pattern = this.exportPattern();
        if (!pattern) {
            console.warn('No hay patrón para exportar');
            return false;
        }

        const blob = new Blob([JSON.stringify(pattern, null, 2)], {
            type: 'application/json'
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `pattern-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return true;
    }

    // =========================================
    // HISTORIAL DE POBLACIÓN
    // =========================================

    recordPopulation(population) {
        this.populationHistory.push(population);
        return this;
    }

    getPopulationHistory() {
        return this.populationHistory.toArray();
    }

    getPopulationTrend() {
        const history = this.populationHistory.toArray();
        if (history.length < 2) return 'stable';

        const recent = history.slice(-10);
        const first = recent[0];
        const last = recent[recent.length - 1];

        if (last > first * 1.1) return 'growing';
        if (last < first * 0.9) return 'shrinking';
        return 'stable';
    }

    // =========================================
    // SERIALIZACIÓN COMPLETA
    // =========================================

    /**
     * Serializa todo el estado incluyendo historial
     */
    serializeFull() {
        return {
            grid: this.gridManager.serialize(),
            undoStack: [...this.undoStack],
            redoStack: [...this.redoStack],
            populationHistory: this.populationHistory.toArray(),
            timestamp: Date.now()
        };
    }

    /**
     * Restaura estado completo incluyendo historial
     */
    deserializeFull(data) {
        if (!data) return false;

        if (data.grid) {
            this.gridManager.deserialize(data.grid);
        }

        if (Array.isArray(data.undoStack)) {
            this.undoStack = [...data.undoStack];
        }

        if (Array.isArray(data.redoStack)) {
            this.redoStack = [...data.redoStack];
        }

        if (Array.isArray(data.populationHistory)) {
            this.populationHistory.clear();
            data.populationHistory.forEach(p => this.populationHistory.push(p));
        }

        this._emit('onStateChange', {type: 'restore'});

        return true;
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        this.clearHistory();
        this.gridManager = null;
        this._callbacks = {};
    }
}

// Exportar global
window.StateManager = StateManager;