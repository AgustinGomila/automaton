/**
 * StateManager - Gestión completa del estado del autómata.
 *
 * Actualizado para grids rectangulares:
 *   • copyArea, pasteArea, clearArea, clearPatternCells,
 *     importPattern y exportPattern usan width/height en lugar de un size único.
 *   • Serialización guarda {width, height}; acepta el formato legacy {size}.
 */
class StateManager {
    constructor(gridManager, options = {}) {
        this.gridManager = gridManager;

        this.maxHistory = options.maxHistory || 50;
        this.maxPopulationHistory = options.maxPopulationHistory || 100;

        this.undoStack = [];
        this.redoStack = [];
        this.isTracking = false;

        this.populationHistory = new CircularArray(this.maxPopulationHistory);

        this._callbacks = {
            onStateChange: null,
            onHistoryChange: null,
            onPopulationChange: null
        };
    }

    // =========================================
    // PROPIEDADES
    // =========================================

    get undoCount() {
        return this.undoStack.length;
    }

    get redoCount() {
        return this.redoStack.length;
    }

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
    // TRACKING
    // =========================================

    _emit(type, data) {
        if (this._callbacks[type]) this._callbacks[type](data);
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
    // UNDO / REDO
    // =========================================

    saveState(generation = 0) {
        if (!this.isTracking || !this.gridManager) return false;
        try {
            const serialized = this.gridManager.serialize();
            this.undoStack.push({...serialized, generation});
            if (this.redoStack.length > 0) {
                this.redoStack = [];
                this._emit('onHistoryChange', {undoCount: this.undoStack.length, redoCount: 0});
            }
            if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
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

    undo(currentGeneration = 0) {
        if (this.undoStack.length === 0) return null;
        try {
            const currentState = this.gridManager.serialize();
            this.redoStack.push({...currentState, generation: currentGeneration});
            if (this.redoStack.length > this.maxHistory) this.redoStack.shift();

            const previousState = this.undoStack.pop();
            this.gridManager.deserialize(previousState);

            this._emit('onStateChange', {type: 'undo', generation: previousState.generation});
            this._emit('onHistoryChange', {undoCount: this.undoStack.length, redoCount: this.redoStack.length});

            return {grid: this.gridManager.grid, generation: previousState.generation};
        } catch (error) {
            console.error('StateManager: Error al deshacer:', error);
            return null;
        }
    }

    redo(currentGeneration = 0) {
        if (this.redoStack.length === 0) return null;
        try {
            const currentState = this.gridManager.serialize();
            this.undoStack.push({...currentState, generation: currentGeneration});

            const nextState = this.redoStack.pop();
            this.gridManager.deserialize(nextState);

            this._emit('onStateChange', {type: 'redo', generation: nextState.generation});
            this._emit('onHistoryChange', {undoCount: this.undoStack.length, redoCount: this.redoStack.length});

            return {grid: this.gridManager.grid, generation: nextState.generation};
        } catch (error) {
            console.error('StateManager: Error al rehacer:', error);
            return null;
        }
    }

    clearHistory() {
        this.undoStack = [];
        this.redoStack = [];
        this.populationHistory.clear();
        this._emit('onHistoryChange', {undoCount: 0, redoCount: 0});
        return this;
    }

    // =========================================
    // OPERACIONES DE ESTADO
    // =========================================

    clear(options = {}) {
        const {saveToHistory = true, generation = 0} = options;
        if (saveToHistory && this.isTracking) this.saveState(generation);
        this.gridManager.clear();
        this._emit('onStateChange', {type: 'clear', generation: 0});
        return {grid: this.gridManager.grid, population: 0, generation: 0};
    }

    randomize(options = {}) {
        const {density = 0.35, saveToHistory = true, generation = 0} = options;
        const validDensity = Math.max(0, Math.min(1, density));
        if (saveToHistory && this.isTracking) this.saveState(generation);

        const {width, height} = this.gridManager;
        const grid = this.gridManager.grid;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                grid[x][y] = Math.random() < validDensity ? 1 : 0;
            }
        }

        const stats = this.gridManager.getStats();
        this.populationHistory.clear();
        this._emit('onStateChange', {type: 'randomize', density: validDensity, stats});
        return stats;
    }

    // =========================================
    // EDICIÓN DE ÁREAS
    // =========================================

    /**
     * Copia un área del grid.
     * @returns {{ grid: boolean[][], width, height }}
     */
    copyArea(minX, minY, maxX, maxY) {
        const {width: gw, height: gh} = this.gridManager;
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const grid = Array.from({length: width}, () => Array(height).fill(false));

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (x >= 0 && x < gw && y >= 0 && y < gh) {
                    grid[x - minX][y - minY] = this.gridManager.getCell(x, y);
                }
            }
        }
        return {grid, width, height};
    }

    pasteArea(area, offsetX, offsetY, options = {}) {
        const {saveToHistory = true, generation = 0} = options;
        if (!area?.grid) return {changedCells: [], stats: this.gridManager.getStats()};
        if (saveToHistory && this.isTracking) this.saveState(generation);

        const {width: gw, height: gh} = this.gridManager;
        const changedCells = [];

        for (let x = 0; x < area.width; x++) {
            const gridX = offsetX + x;
            if (gridX < 0 || gridX >= gw) continue;
            for (let y = 0; y < area.height; y++) {
                const gridY = offsetY + y;
                if (gridY < 0 || gridY >= gh) continue;
                if (!area.grid[x][y]) continue;
                const currentState = this.gridManager.getCell(gridX, gridY);
                if (currentState !== 1) {
                    this.gridManager.setCell(gridX, gridY, 1);
                    changedCells.push({x: gridX, y: gridY, from: currentState, to: 1});
                }
            }
        }

        const stats = this.gridManager.getStats();
        this._emit('onStateChange', {type: 'paste', changedCount: changedCells.length, stats});
        return {changedCells, stats};
    }

    clearPatternCells(area, offsetX, offsetY, options = {}) {
        const {saveToHistory = true, generation = 0} = options;
        if (!area?.grid) return {changedCells: []};
        if (saveToHistory && this.isTracking) this.saveState(generation);

        const {width: gw, height: gh} = this.gridManager;
        const changedCells = [];

        for (let x = 0; x < area.width; x++) {
            const gridX = offsetX + x;
            if (gridX < 0 || gridX >= gw) continue;
            for (let y = 0; y < area.height; y++) {
                if (!area.grid[x][y]) continue;
                const gridY = offsetY + y;
                if (gridY < 0 || gridY >= gh) continue;
                if (this.gridManager.getCell(gridX, gridY)) {
                    this.gridManager.setCell(gridX, gridY, 0);
                    changedCells.push({x: gridX, y: gridY, from: 1, to: 0});
                }
            }
        }
        return {changedCells};
    }

    clearArea(minX, minY, maxX, maxY, options = {}) {
        const {saveToHistory = true, generation = 0} = options;
        if (saveToHistory && this.isTracking) this.saveState(generation);

        const {width: gw, height: gh} = this.gridManager;
        const startX = Math.max(0, minX), endX = Math.min(maxX, gw - 1);
        const startY = Math.max(0, minY), endY = Math.min(maxY, gh - 1);
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
        this._emit('onStateChange', {type: 'clearArea', changedCount: changedCells.length, stats});
        return {changedCells, stats};
    }

    // =========================================
    // IMPORT / EXPORT
    // =========================================

    /**
     * Exporta el patrón actual como objeto JSON.
     * @param {Object} [bounds] — {minX, minY, maxX, maxY} o null para auto-bounds
     */
    exportPattern(bounds = null) {
        const {width: gw, height: gh} = this.gridManager;
        let minX, minY, maxX, maxY;

        if (bounds) {
            minX = Math.max(0, bounds.minX);
            minY = Math.max(0, bounds.minY);
            maxX = Math.min(gw - 1, bounds.maxX);
            maxY = Math.min(gh - 1, bounds.maxY);
        } else {
            minX = gw;
            minY = gh;
            maxX = 0;
            maxY = 0;
            for (let x = 0; x < gw; x++) {
                for (let y = 0; y < gh; y++) {
                    if (this.gridManager.getCell(x, y)) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
        }

        if (minX > maxX || minY > maxY) return null;

        const pattern = [];
        for (let y = minY; y <= maxY; y++) {
            const row = [];
            for (let x = minX; x <= maxX; x++) {
                row.push(this.gridManager.getCell(x, y) ? 1 : 0);
            }
            pattern.push(row);
        }

        if (bounds && pattern.every(row => row.every(v => v === 0))) return null;

        return {
            pattern,
            name: `Pattern ${new Date().toLocaleDateString()}`,
            description: 'Exported from cellular automaton',
            bounds: {minX, minY, maxX, maxY}
        };
    }

    importPattern(patternData, centerX, centerY, options = {}) {
        const {saveToHistory = true, generation = 0} = options;

        if (patternData?.pattern === 'random') {
            return this.randomize({density: options.density ?? 0.35, saveToHistory, generation});
        }
        if (!patternData?.pattern || !Array.isArray(patternData.pattern)) {
            return {changedCells: [], stats: this.gridManager.getStats()};
        }

        if (saveToHistory && this.isTracking) this.saveState(generation);

        const pattern = patternData.pattern;
        const offsetX = Math.floor(pattern[0].length / 2);
        const offsetY = Math.floor(pattern.length / 2);
        const {width: gw, height: gh} = this.gridManager;
        const changedCells = [];

        for (let row = 0; row < pattern.length; row++) {
            for (let col = 0; col < pattern[row].length; col++) {
                if (pattern[row][col] === 1) {
                    const gridX = centerX - offsetX + col;
                    const gridY = centerY - offsetY + row;
                    if (gridX >= 0 && gridX < gw && gridY >= 0 && gridY < gh) {
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

    // =========================================
    // HISTORIAL DE POBLACIÓN
    // =========================================

    recordPopulation(population) {
        this.populationHistory.push(population);
        return this;
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

window.StateManager = StateManager;