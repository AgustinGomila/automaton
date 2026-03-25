/**
 * CellularAutomatonCore — Núcleo puro del autómata celular.
 *
 * Soporta grids rectangulares (width × height).
 * El getter `size` mantiene compatibilidad con código legacy
 * devolviendo Math.max(width, height).
 */
class CellularAutomatonCore {
    /**
     * @param {Object}  options
     * @param {number}  [options.width]             — columnas (default 500)
     * @param {number}  [options.height]            — filas    (default width)
     * @param {number}  [options.size]              — alias legacy (cuadrado)
     * @param {Object}  options.rule                — { birth: number[], survival: number[] }
     * @param {string}  options.neighborhoodType    — 'moore' | 'neumann'
     * @param {number}  options.neighborhoodRadius
     * @param {boolean} options.wrapEdges
     */
    constructor(options = {}) {
        const legacySize = options.size || 500;
        const w = Math.min(Math.max(options.width ?? legacySize, 20), 1000);
        const h = Math.min(Math.max(options.height ?? w, 20), 1000);

        this.width = w;
        this.height = h;

        this.gridManager = new GridManager(this.width, this.height);

        this.neighborhood = new NeighborhoodCalculator({
            type: options.neighborhoodType || 'moore',
            radius: options.neighborhoodRadius || 1,
            wrapEdges: options.wrapEdges !== false,
            gridWidth: this.width,
            gridHeight: this.height
        });

        this.ruleEngine = new RuleEngine(options.rule || {birth: [3], survival: [2, 3]});

        this.generation = 0;

        this._callbacks = {
            onGeneration: null,
            onCellChange: null,
            onStateChange: null
        };
    }

    /** Dimensión mayor — compatibilidad con código legacy. */
    get size() {
        return Math.max(this.width, this.height);
    }

    on(callbacks) {
        Object.assign(this._callbacks, callbacks);
    }

    // =========================================
    // PASO DE GENERACIÓN
    // =========================================

    /**
     * Avanza una generación y notifica al coordinador.
     * Usa el fastpath Moore-1 cuando corresponde.
     * @returns {Object} stats — { generation, population, density, births, deaths, changedCells, changedCount }
     */
    step() {
        const outGrid = this.gridManager.getBackGrid();
        const {width, height} = this.gridManager;

        const result = this.neighborhood.isFastPath
            ? this.ruleEngine.nextGenerationMoore(
                this.gridManager.grid, outGrid, this.neighborhood.wrapEdges, width, height)
            : this.ruleEngine.nextGeneration(
                this.gridManager.grid,
                (x, y) => this.neighborhood.countNeighbors(x, y,
                    (nx, ny) => this.gridManager.getCell(nx, ny)),
                outGrid, width, height);

        this.gridManager.swapBuffers();
        this.generation++;

        if (this._callbacks.onCellChange && result.changedCount > 0) {
            this._callbacks.onCellChange(result.changedCells, result.changedCount);
        }

        const population = this.gridManager.countPopulation();
        const stats = {
            generation: this.generation,
            population,
            density: ((population / (width * height)) * 100).toFixed(1),
            births: result.generationStats.births,
            deaths: result.generationStats.deaths,
            // Buffer interno reutilizado por RuleEngine; consumir antes del próximo step().
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

    /**
     * Redimensiona el grid.
     * @param {number} newWidth
     * @param {number} [newHeight=newWidth]
     */
    resize(newWidth, newHeight = newWidth) {
        const result = this.gridManager.resize(newWidth, newHeight);
        if (result.wasResized) {
            this.width = this.gridManager.width;
            this.height = this.gridManager.height;
            this.neighborhood.configure({
                gridWidth: this.width,
                gridHeight: this.height
            });
            this.generation = 0;
            this._callbacks.onStateChange?.({
                type: 'resize', width: this.width, height: this.height
            });
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
            count: this.neighborhood.countNeighbors(x, y,
                (nx, ny) => this.getCell(nx, ny))
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