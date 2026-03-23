/**
 * EditCoordinator — Operaciones de edición del grid.
 *
 * Responsabilidad: encapsular todas las operaciones que modifican el estado
 * del grid (aleatorizar, limpiar, copiar/pegar, importar/exportar, undo/redo,
 * desplazamiento toroidal) junto con la lógica de sincronización hacia los
 * motores especiales activos.
 *
 * Recibe una referencia directa al coordinador principal (CellularAutomaton)
 * para acceder a los subsistemas. Esta dependencia es intencional y equivale
 * a la que estas mismas operaciones tenían cuando vivían en automaton.js.
 * El beneficio es estructural: automaton.js se ocupa de coordinar subsistemas;
 * edit-coordinator.js se ocupa de las operaciones de edición.
 */
class EditCoordinator {

    /** @param {CellularAutomaton} automaton */
    constructor(automaton) {
        this._a = automaton;
    }

    // =========================================
    // HELPERS INTERNOS
    // =========================================

    /**
     * Detiene la simulación y limpia el worker si está procesando.
     * Versión síncrona: úsala cuando la operación no necesita que el worker
     * termine antes de proceder (la edición sobreescribirá el grid igualmente).
     * @returns {boolean} wasRunning
     */
    _haltForEdit() {
        const wasRunning = this._a._loop.isRunning;
        this._a._loop.stop();
        if (this._a._workerManager.isProcessing) {
            this._a._workerManager.cleanup();
        }
        return wasRunning;
    }

    /**
     * Detiene la simulación y espera a que el worker termine antes de limpiar.
     * Versión asíncrona: necesaria al pegar o importar, donde el grid debe
     * estar en un estado consistente antes de continuar.
     * @returns {Promise<boolean>} wasRunning
     */
    async _haltForEditAsync() {
        const wasRunning = this._a._loop.isRunning;
        this._a._loop.stop();
        if (this._a._workerManager.isProcessing) {
            await new Promise(resolve => {
                const check = () => this._a._workerManager.isProcessing
                    ? setTimeout(check, 10)
                    : resolve();
                check();
            });
            this._a._workerManager.cleanup();
        }
        return wasRunning;
    }

    /**
     * Reanuda la simulación si estaba en marcha antes de la edición.
     * Delega en automaton.start() para que se ejecute la inicialización completa
     * (marcado de dirty, etc.) antes de arrancar el loop.
     * @param {boolean} wasRunning
     */
    _restartIfWasRunning(wasRunning) {
        if (wasRunning) {
            requestAnimationFrame(() => this._a.start());
        }
    }

    /**
     * Propaga cambios de celda al renderer y actualiza estadísticas.
     * @param {Array<{x,y}>} changedCells
     * @param {Object}  [opts]
     * @param {boolean} [opts.full=true] — si true: prevFlags + markAllDirty + initWorker
     */
    _commitCells(changedCells, {full = true} = {}) {
        const r = this._a.renderer;
        changedCells.forEach(cell => r.markDirty(cell.x, cell.y));
        this._a.updateStats();
        if (full) r.markAllDirty();
        this._a.render();
        if (full && this._a.gridSize >= this._a.workerThreshold) {
            this._a._initWorker();
        } else {
            this._a._syncWorkerGrid();
        }
    }

    /**
     * Aplica el resultado de undo/redo al estado del autómata.
     * @param {Object|null} result    — devuelto por stateManager.undo/redo
     * @param {string}      eventName — 'automaton:undo' | 'automaton:redo'
     * @returns {boolean}
     */
    _applyHistoryStep(result, eventName) {
        if (!result) return false;
        this._a.generation = result.generation;
        this._a._engineManager.resetActiveEngine();
        this._a.renderer.markAllDirty();
        this._a.updateStats();
        this._a.render();
        this._a._syncWorkerGrid();
        eventBus.emit(eventName, {generation: this._a.generation});
        return true;
    }

    // =========================================
    // ALEATORIZAR / LIMPIAR
    // =========================================

    randomize(density = 0.35) {
        const wasRunning = this._haltForEdit();

        const result = this._a._engineManager.randomizeActiveEngine(density);

        if (result.handled) {
            this._a.generation = 0;
            if (result.resetLimit) this._a._limiter.isLimitReached = false;
            this._a.renderer.resetActivity();
            this._a.updateStats(result.population);
            this._a.render();
            if (wasRunning) setTimeout(() => this._a.start(), 0);
            return;
        }

        // Modo estándar
        const stats = this._a.stateManager.randomize({
            density,
            saveToHistory: true,
            generation: this._a.generation
        });

        this._a.renderer.resetActivity();
        this._a.generation = 0;
        this._a._limiter.isLimitReached = false;
        this._a._engineManager.resetAllEngines();
        this._a.renderer.markAllDirty();
        this._a.updateStats(stats.population);
        this._a.render();
        this._a._initWorker();

        if (wasRunning) setTimeout(() => this._a.start(), 0);
        return stats;
    }

    clear() {
        const wasRunning = this._haltForEdit();
        if (wasRunning) eventBus.emit('automaton:runningChanged', {isRunning: false});

        this._clearBaseGrid();
        this._clearSpecialEngine();
        this._resetCommonState();

        this._a.renderer._isFirstRender = true;
        this._a.renderer.markAllDirty();
        this._a.render();
        this._a.updateStats(0);
        this._a._initWorker();
    }

    _clearBaseGrid() {
        const {grid, gridSize} = this._a;
        for (let x = 0; x < gridSize; x++) {
            for (let y = 0; y < gridSize; y++) {
                grid[x][y] = 0;
            }
        }
    }

    _clearSpecialEngine() {
        const handled = this._a._engineManager.clearActiveEngine();
        if (!handled) {
            this._a.stateManager?.clear({
                saveToHistory: true,
                generation: this._a.generation
            });
        }
    }

    _resetCommonState() {
        this._a.generation = 0;
        this._a._limiter.isLimitReached = false;
        this._a.renderer?.resetActivity();
        this._a._engineManager.resetAllEngines();
    }

    // =========================================
    // OPERACIONES DE ÁREA
    // =========================================

    copyArea(minX, minY, maxX, maxY) {
        return this._a.stateManager.copyArea(minX, minY, maxX, maxY);
    }

    async pasteArea(area, offsetX, offsetY) {
        const wasRunning = await this._haltForEditAsync();

        const result = this._a.stateManager.pasteArea(area, offsetX, offsetY, {
            saveToHistory: true,
            generation: this._a.generation
        });

        if (result.changedCells.length > 0) {
            this._commitCells(result.changedCells);
        }

        this._restartIfWasRunning(wasRunning);
        return result;
    }

    clearPatternCells(area, offsetX, offsetY) {
        const wasRunning = this._haltForEdit();

        const result = this._a.stateManager.clearPatternCells(area, offsetX, offsetY, {
            saveToHistory: true,
            generation: this._a.generation
        });

        if (result.changedCells.length > 0) {
            this._commitCells(result.changedCells, {full: false});
        }

        this._restartIfWasRunning(wasRunning);
        return result;
    }

    clearArea(minX, minY, maxX, maxY) {
        const wasRunning = this._haltForEdit();

        const result = this._a.stateManager.clearArea(minX, minY, maxX, maxY, {
            saveToHistory: true,
            generation: this._a.generation
        });

        if (result.changedCells.length > 0) {
            this._commitCells(result.changedCells, {full: false});
        }

        this._restartIfWasRunning(wasRunning);
        return result;
    }

    // =========================================
    // IMPORTAR / EXPORTAR
    // =========================================

    async importPattern(pattern, centerX, centerY) {
        const wasRunning = await this._haltForEditAsync();

        const result = this._a.stateManager.importPattern(pattern, centerX, centerY, {
            saveToHistory: true,
            generation: this._a.generation
        });

        if (result.changedCells.length > 0) {
            const {specialMode, langtonEngine, rd2dEngine, wireworldEngine, generationsEngine, renderer} = this._a;

            if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) {
                result.changedCells.forEach(cell => {
                    if (this._a.core.getCell(cell.x, cell.y)) {
                        langtonEngine.addAnt(cell.x, cell.y, 0);
                    }
                    renderer.markDirty(cell.x, cell.y);
                });
                this._a.updateStats();
                this._a.render();
                eventBus.emit('automaton:ruleChanged');

            } else if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) {
                rd2dEngine.syncFromGrid();
                result.changedCells.forEach(cell => renderer.markDirty(cell.x, cell.y));
                this._a.updateStats();
                renderer.markAllDirty();
                this._a.render();

            } else if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) {
                wireworldEngine.syncFromGrid();
                result.changedCells.forEach(cell => renderer.markDirty(cell.x, cell.y));
                this._a.updateStats();
                renderer.markAllDirty();
                this._a.render();

            } else if (specialMode === SpecialEngineManager.MODES.GENERATIONS && generationsEngine?.isActive) {
                generationsEngine.syncFromGrid();
                result.changedCells.forEach(cell => renderer.markDirty(cell.x, cell.y));
                this._a.updateStats();
                renderer.markAllDirty();
                this._a.render();

            } else {
                this._commitCells(result.changedCells);
            }
        }

        this._restartIfWasRunning(wasRunning);
        return result;
    }

    exportPattern(bounds = null) {
        return this._a.stateManager.exportPattern(bounds);
    }

    /**
     * Exporta el estado WireWorld completo.
     * @returns {{ stateGrid, gridSize, name, description, wrap } | null}
     */
    exportWireworldState(name, description) {
        const {specialMode, wireworldEngine, gridSize, wrapEdges} = this._a;
        if (specialMode !== SpecialEngineManager.MODES.WIREWORLD || !wireworldEngine?.isActive) return null;
        return {
            stateGrid: wireworldEngine.stateGrid,
            gridSize,
            name: name || `WireWorld ${new Date().toLocaleDateString()}`,
            description: description || 'Exported from cellular automaton',
            wrap: wrapEdges
        };
    }

    /**
     * Importa un stateGrid WireWorld al engine activo, centrado en el grid.
     * @param {Uint8Array[]} stateGrid     — columna-mayor, estados 0..3
     * @param {number}       patternWidth
     * @param {number}       patternHeight
     * @returns {boolean}
     */
    importWireworldState(stateGrid, patternWidth, patternHeight) {
        const {specialMode, wireworldEngine, gridSize, grid, renderer} = this._a;
        if (specialMode !== SpecialEngineManager.MODES.WIREWORLD || !wireworldEngine?.isActive) return false;

        const size = gridSize;
        const offsetX = Math.floor((size - patternWidth) / 2);
        const offsetY = Math.floor((size - patternHeight) / 2);

        // Recrear buffers al tamaño actual del grid (puede diferir tras redimensionado)
        wireworldEngine.stateGrid = Array.from({length: size}, () => new Uint8Array(size));
        wireworldEngine._nextState = Array.from({length: size}, () => new Uint8Array(size));

        for (let x = 0; x < size; x++) grid[x].fill(0);

        for (let px = 0; px < patternWidth; px++) {
            for (let py = 0; py < patternHeight; py++) {
                const gx = offsetX + px;
                const gy = offsetY + py;
                if (gx < 0 || gx >= size || gy < 0 || gy >= size) continue;
                const state = stateGrid[px]?.[py] ?? 0;
                wireworldEngine.stateGrid[gx][gy] = state;
                grid[gx][gy] = state > 0 ? 1 : 0;
            }
        }

        wireworldEngine.generation = 0;
        renderer.markAllDirty();
        this._a.updateStats();
        this._a.render();
        return true;
    }

    // =========================================
    // DESPLAZAMIENTO / UNDO / REDO
    // =========================================

    shiftGrid(dx, dy) {
        this._a.stateManager.saveState(this._a.generation);

        // Seleccionar el grid manager correcto según el modo activo
        const gm = (this._a.specialMode === SpecialEngineManager.MODES.TRIANGLE && this._a.triangleEngine?.isActive)
            ? this._a.triangleEngine.gridManager
            : this._a.core.gridManager;

        gm.shift(dx, dy);

        // Sincronizar grids adicionales de los motores que mantienen estado propio
        const {specialMode, rd2dEngine, langtonEngine, wireworldEngine} = this._a;
        if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) rd2dEngine.shift(dx, dy);
        if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) langtonEngine.shift(dx, dy);
        if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) wireworldEngine.shift(dx, dy);

        // Resetear actividad: las celdas cambiaron de posición, el estado de highlight
        // amarillo quedaría huérfano en las posiciones originales.
        this._a.renderer.resetActivity();
        this._a._syncWorkerGrid();
        this._a.render();
    }

    undo() {
        return this._applyHistoryStep(
            this._a.stateManager.undo(this._a.generation),
            'automaton:undo'
        );
    }

    redo() {
        return this._applyHistoryStep(
            this._a.stateManager.redo(this._a.generation),
            'automaton:redo'
        );
    }
}

window.EditCoordinator = EditCoordinator;