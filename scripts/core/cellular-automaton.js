/**
 * CellularAutomatonCore — Núcleo puro del autómata celular.
 *
 * Responsabilidad: orquestar grid, vecindad y reglas sin conocer UI,
 * renderizado, motores especiales ni workers.
 *
 * No gestiona estado de ejecución (eso es AnimationLoop) ni
 * randomización (eso es StateManager, que soporta undo).
 */
class CellularAutomatonCore {
    /**
     * @param {Object}  options
     * @param {number}  options.size
     * @param {Object}  options.rule              — { birth: number[], survival: number[] }
     * @param {string}  options.neighborhoodType  — 'moore' | 'neumann'
     * @param {number}  options.neighborhoodRadius
     * @param {boolean} options.wrapEdges
     */
    constructor(options = {}) {
        this.size = Math.min(Math.max(options.size || 500, 20), 1000);

        this.gridManager = new GridManager(this.size);
        this.neighborhood = new NeighborhoodCalculator({
            type: options.neighborhoodType || 'moore',
            radius: options.neighborhoodRadius || 1,
            wrapEdges: options.wrapEdges !== false,
            gridSize: this.size
        });
        this.ruleEngine = new RuleEngine(options.rule || {birth: [3], survival: [2, 3]});

        this.generation = 0;

        this._callbacks = {
            onGeneration: null,
            onCellChange: null,
            onStateChange: null
        };
    }

    on(callbacks) {
        Object.assign(this._callbacks, callbacks);
    }

    // =========================================
    // PASO DE GENERACIÓN
    // =========================================

    /**
     * Avanza una generación y notifica al coordinador.
     * Usa el fastpath Moore-1 cuando corresponde (~5× más rápido).
     * @returns {Object} stats — { generation, population, density, births, deaths }
     */
    step() {
        const outGrid = this.gridManager.getBackGrid();

        const result = this.neighborhood.isFastPath
            ? this.ruleEngine.nextGenerationMoore(
                this.gridManager.grid, outGrid, this.neighborhood.wrapEdges)
            : this.ruleEngine.nextGeneration(
                this.gridManager.grid,
                (x, y) => this.neighborhood.countNeighbors(x, y,
                    (nx, ny) => this.gridManager.getCell(nx, ny)),
                outGrid);

        this.gridManager.swapBuffers();
        this.generation++;

        if (this._callbacks.onCellChange && result.changedCount > 0) {
            this._callbacks.onCellChange(result.changedCells, result.changedCount);
        }

        const population = this.gridManager.countPopulation();
        const stats = {
            generation: this.generation,
            population,
            density: ((population / (this.size * this.size)) * 100).toFixed(1),
            births: result.generationStats.births,
            deaths: result.generationStats.deaths,
            // Exponer el buffer de cambios para que el coordinador pueda pasarlo
            // directamente a updateActivityAges sin conversión intermedia.
            // IMPORTANTE: este buffer es reutilizado por RuleEngine en el próximo step();
            // el caller debe consumirlo antes de la siguiente llamada a step().
            changedCells: result.changedCells,
            changedCount: result.changedCount
        };

        if (this._callbacks.onGeneration) {
            this._callbacks.onGeneration(stats);
        }

        return stats;
    }

    // =========================================
    // ACCESO A CELDAS
    // =========================================

    getCell(x, y) {
        return this.gridManager.getCell(x, y);
    }

    setCell(x, y, state) {
        const changed = this.gridManager.setCell(x, y, state);
        if (changed && this._callbacks.onCellChange) {
            this._callbacks.onCellChange([{x, y, from: state ? 0 : 1, to: state}]);
        }
        return changed;
    }

    // =========================================
    // CONFIGURACIÓN
    // =========================================

    clear() {
        this.gridManager.clear();
        this.generation = 0;
        this._callbacks.onStateChange?.({type: 'clear'});
    }

    resize(newSize) {
        const result = this.gridManager.resize(newSize);
        if (result.wasResized) {
            this.size = newSize;
            this.neighborhood.configure({gridSize: newSize});
            this.generation = 0;
            this._callbacks.onStateChange?.({type: 'resize', size: newSize});
        }
        return result;
    }

    setRule(rule) {
        this.ruleEngine.setRule(rule);
        this.generation = 0;
        this._callbacks.onStateChange?.({type: 'ruleChange', rule: this.ruleEngine.ruleString});
    }

    setNeighborhood(options) {
        this.neighborhood.configure(options);
        this.generation = 0;
        this._callbacks.onStateChange?.({
            type: 'neighborhoodChange',
            info: this.neighborhood.getInfo()
        });
    }

    // =========================================
    // ESTADÍSTICAS / SERIALIZACIÓN
    // =========================================

    getStats() {
        return {
            ...this.gridManager.getStats(),
            generation: this.generation,
            rule: this.ruleEngine.ruleString
        };
    }

    getNeighborhoodInfo(x, y) {
        return {
            coordinates: this.neighborhood.getNeighborCoordinates(x, y),
            count: this.neighborhood.countNeighbors(x, y, (nx, ny) => this.getCell(nx, ny))
        };
    }

    serialize() {
        return {
            grid: this.gridManager.serialize(),
            generation: this.generation,
            rule: {birth: this.ruleEngine.birth, survival: this.ruleEngine.survival},
            neighborhood: this.neighborhood.getInfo()
        };
    }

    deserialize(data) {
        if (data.grid) this.gridManager.deserialize(data.grid);
        if (data.generation !== undefined) this.generation = data.generation;
        if (data.rule) this.ruleEngine.setRule(data.rule);
        if (data.neighborhood) this.neighborhood.configure(data.neighborhood);
        this._callbacks.onStateChange?.({type: 'deserialize'});
    }

    destroy() {
        this._callbacks = {};
    }
}

window.CellularAutomatonCore = CellularAutomatonCore;