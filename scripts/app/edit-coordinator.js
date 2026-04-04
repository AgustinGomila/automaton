/**
 * scripts/app/edit-coordinator.js
 *
 * Operaciones de edición del grid (aleatorizar, limpiar, copiar/pegar,
 * importar/exportar, undo/redo, desplazamiento toroidal).
 *
 * Recibe una referencia directa al coordinador principal (CellularAutomaton)
 * para acceder a los subsistemas. Esta dependencia es intencional y equivale
 * a la que estas mismas operaciones tenían cuando vivían en automaton.js.
 *
 * Cambios ESM: eventBus y SpecialEngineManager importados; sin window.*.
 */

import {eventBus} from '../infrastructure/event-bus.js';
import {SpecialEngineManager} from '../core/engines/special-engine-manager.js';

class EditCoordinator {

    /** @param {CellularAutomaton} automaton */
    constructor(automaton) {
        this._a = automaton;
    }

    // =========================================
    // HELPERS INTERNOS
    // =========================================

    _haltForEdit() {
        const wasRunning = this._a._loop.isRunning;
        this._a._loop.stop();
        if (this._a._workerManager.isProcessing) {
            this._a._workerManager.cleanup();
        }
        return wasRunning;
    }

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

    _restartIfWasRunning(wasRunning) {
        if (wasRunning) requestAnimationFrame(() => this._a.start());
    }

    /**
     * Propaga cambios de celda al renderer y actualiza estadísticas.
     * @param {Array<{x,y}>} changedCells
     * @param {Object}  [opts]
     * @param {boolean} [opts.full=true] — si true: markAllDirty + reinit worker
     */
    _commitCells(changedCells, {full = true} = {}) {
        const r = this._a.renderer;
        changedCells.forEach(cell => r.markDirty(cell.x, cell.y));
        this._a.updateStats();
        if (full) r.markAllDirty();
        this._a.render();
        if (full && Math.max(this._a.gridWidth, this._a.gridHeight) >= this._a.workerThreshold) {
            this._a._initWorker();
        } else {
            this._a._syncWorkerGrid();
        }
    }

    /**
     * Aplica el resultado de undo/redo al autómata.
     * @param {Object|null} result
     * @param {string}      eventName
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

        const stats = this._a.stateManager.randomize({
            density,
            saveToHistory: true,
            generation: this._a.generation
        });

        this._a.renderer.resetActivity();
        this._a.generation = 0;
        this._a._limiter.isLimitReached = false;
        this._a._engineManager.resetAllEngines();
        this._a.renderer.setColorProvider(null);
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
        const {grid, gridWidth: gw, gridHeight: gh} = this._a;
        for (let x = 0; x < gw; x++) {
            for (let y = 0; y < gh; y++) {
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
        this._a.core.generation = 0;
        this._a._limiter.isLimitReached = false;
        this._a.renderer?.resetActivity();
        this._a._engineManager.resetAllEngines();
    }

    // =========================================
    // OPERACIONES DE ÁREA
    // =========================================

    /**
     * Copia un área incluyendo los estados extendidos del engine activo.
     */
    copyArea(minX, minY, maxX, maxY) {
        const area = this._a.stateManager.copyArea(minX, minY, maxX, maxY);

        const stateGrid = this._getEngineStateGrid();
        if (stateGrid) {
            const {width, height} = area;
            const gw = this._a.gridWidth;
            const gh = this._a.gridHeight;
            const engineStates = Array.from({length: width}, () => new Array(height).fill(0));
            for (let x = 0; x < width; x++) {
                const gx = minX + x;
                if (gx < 0 || gx >= gw) continue;
                for (let y = 0; y < height; y++) {
                    const gy = minY + y;
                    if (gy < 0 || gy >= gh) continue;
                    const s = stateGrid[gx]?.[gy] ?? 0;
                    engineStates[x][y] = s;
                    if (s > 0) area.grid[x][y] = true;
                }
            }
            area.engineStates = engineStates;
        }

        return area;
    }

    async pasteArea(area, offsetX, offsetY) {
        const wasRunning = await this._haltForEditAsync();

        const result = this._a.stateManager.pasteArea(area, offsetX, offsetY, {
            saveToHistory: true,
            generation: this._a.generation
        });

        if (result.changedCells.length > 0) {
            const stateGrid = this._getEngineStateGrid();
            if (stateGrid && area.engineStates) {
                const gw = this._a.gridWidth;
                const gh = this._a.gridHeight;
                const grid = this._a.grid;
                for (let x = 0; x < area.width; x++) {
                    const gx = offsetX + x;
                    if (gx < 0 || gx >= gw) continue;
                    for (let y = 0; y < area.height; y++) {
                        const gy = offsetY + y;
                        if (gy < 0 || gy >= gh) continue;
                        const s = area.engineStates[x]?.[y] ?? 0;
                        if (s > 0) {
                            stateGrid[gx][gy] = s;
                            grid[gx][gy] = s === 1 ? 1 : 0;
                        }
                    }
                }
            }
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

        const stateGrid = this._getEngineStateGrid();
        if (stateGrid && area.engineStates) {
            const gw = this._a.gridWidth;
            const gh = this._a.gridHeight;
            for (let x = 0; x < area.width; x++) {
                const gx = offsetX + x;
                if (gx < 0 || gx >= gw) continue;
                for (let y = 0; y < area.height; y++) {
                    const s = area.engineStates[x]?.[y] ?? 0;
                    if (s <= 0) continue;
                    const gy = offsetY + y;
                    if (gy < 0 || gy >= gh) continue;
                    stateGrid[gx][gy] = 0;
                    this._a.renderer.markDirty(gx, gy);
                }
            }
        } else if (stateGrid && result.changedCells.length > 0) {
            const gw = this._a.gridWidth;
            const gh = this._a.gridHeight;
            for (const {x, y} of result.changedCells) {
                if (x >= 0 && x < gw && y >= 0 && y < gh) stateGrid[x][y] = 0;
            }
        }

        if (result.changedCells.length > 0) {
            this._commitCells(result.changedCells, {full: false});
        } else if (stateGrid && area.engineStates) {
            this._a.render();
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
                    if (this._a.core.getCell(cell.x, cell.y)) langtonEngine.addAnt(cell.x, cell.y, 0);
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
                // NO llamar syncFromGrid() — destruiría los estados moribundos.
                result.changedCells.forEach(cell => {
                    if (generationsEngine.stateGrid?.[cell.x]) {
                        generationsEngine.stateGrid[cell.x][cell.y] = 1;
                    }
                    renderer.markDirty(cell.x, cell.y);
                });
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
     * @returns {{ stateGrid, gridWidth, gridHeight, name, description, wrap } | null}
     */
    exportWireworldState(name, description) {
        const {specialMode, wireworldEngine, gridWidth, gridHeight, wrapEdges} = this._a;
        if (specialMode !== SpecialEngineManager.MODES.WIREWORLD || !wireworldEngine?.isActive) return null;
        return {
            stateGrid: wireworldEngine.stateGrid,
            gridWidth,
            gridHeight,
            name: name || `WireWorld ${new Date().toLocaleDateString()}`,
            description: description || 'Exported from cellular automaton',
            wrap: wrapEdges
        };
    }

    /**
     * Importa un stateGrid WireWorld al engine activo, centrado en el grid.
     * @param {Uint8Array[]} stateGrid     — column-major, estados 0..3
     * @param {number}       patternWidth
     * @param {number}       patternHeight
     * @returns {boolean}
     */
    importWireworldState(stateGrid, patternWidth, patternHeight) {
        const {specialMode, wireworldEngine, gridWidth, gridHeight, grid, renderer} = this._a;
        if (specialMode !== SpecialEngineManager.MODES.WIREWORLD || !wireworldEngine?.isActive) return false;

        const gw = gridWidth;
        const gh = gridHeight;
        const offsetX = Math.floor((gw - patternWidth) / 2);
        const offsetY = Math.floor((gh - patternHeight) / 2);

        wireworldEngine.stateGrid = Array.from({length: gw}, () => new Uint8Array(gh));
        wireworldEngine._nextState = Array.from({length: gw}, () => new Uint8Array(gh));

        for (let x = 0; x < gw; x++) grid[x].fill(0);

        for (let px = 0; px < patternWidth; px++) {
            for (let py = 0; py < patternHeight; py++) {
                const gx = offsetX + px;
                const gy = offsetY + py;
                if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue;
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

        const gm = (this._a.specialMode === SpecialEngineManager.MODES.TRIANGLE && this._a.triangleEngine?.isActive)
            ? this._a.triangleEngine.gridManager
            : this._a.core.gridManager;

        gm.shift(dx, dy);

        const {specialMode, rd2dEngine, langtonEngine, wireworldEngine} = this._a;
        if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) rd2dEngine.shift(dx, dy);
        if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) langtonEngine.shift(dx, dy);
        if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) wireworldEngine.shift(dx, dy);

        this._a.renderer.resetActivity();
        this._a._workerManager.markShiftDuringStep();
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

    // =========================================
    // HELPER PRIVADO
    // =========================================

    /**
     * Devuelve el stateGrid del motor activo si tiene estados extendidos, o null.
     * Centraliza el acceso para copyArea, pasteArea y clearPatternCells.
     * @returns {Array|null}
     */
    _getEngineStateGrid() {
        const {specialMode} = this._a;
        const M = SpecialEngineManager.MODES;
        if (specialMode === M.GENERATIONS && this._a.generationsEngine?.isActive)
            return this._a.generationsEngine.stateGrid;
        if (specialMode === M.WIREWORLD && this._a.wireworldEngine?.isActive)
            return this._a.wireworldEngine.stateGrid;
        if (specialMode === M.LANGTON && this._a.langtonEngine?.isActive)
            return this._a.langtonEngine.stateGrid;
        if (specialMode === M.RD2D && this._a.rd2dEngine?.isActive)
            return this._a.rd2dEngine.stateGrid;
        return null;
    }
}

export {EditCoordinator};