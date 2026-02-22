/**
 * CellularAutomatonCore - Núcleo puro del autómata celular
 * Responsabilidad: Orquestar grid, vecindad y reglas sin conocer UI/renderizado
 *
 * Este es el "cerebro" matemático del autómata. No sabe nada de:
 * - Canvas, colores, renderizado
 * - Eventos de usuario
 * - Motores especiales (Wolfram, RD-2D)
 * - Workers (eso va en el coordinador)
 */
class CellularAutomatonCore {
    /**
     * @param {Object} options
     * @param {number} options.size - Tamaño del grid
     * @param {Object} options.rule - {birth: number[], survival: number[]}
     * @param {string} options.neighborhoodType - 'moore' o 'neumann'
     * @param {number} options.neighborhoodRadius - Radio de vecindad
     * @param {boolean} options.wrapEdges - Modo toroidal
     */
    constructor(options = {}) {
        this.size = Math.min(Math.max(options.size || 200, 20), 400);

        // Componentes
        this.gridManager = new GridManager(this.size);
        this.neighborhood = new NeighborhoodCalculator({
            type: options.neighborhoodType || 'moore',
            radius: options.neighborhoodRadius || 1,
            wrapEdges: options.wrapEdges !== false,
            gridSize: this.size
        });
        this.ruleEngine = new RuleEngine(options.rule || {birth: [3], survival: [2, 3]});

        // Estado
        this.generation = 0;
        this._isRunning = false;

        // Callbacks para notificar cambios (sin depender de eventBus)
        this._callbacks = {
            onGeneration: null,
            onCellChange: null,
            onStateChange: null
        };
    }

    /**
     * Registra callbacks para eventos del core
     * @param {Object} callbacks
     */
    on(callbacks) {
        Object.assign(this._callbacks, callbacks);
    }

    /**
     * Avanza una generación
     * @returns {Object} Estadísticas de la generación
     */
    step() {
        const getCell = (x, y) => this.gridManager.getCell(x, y);
        const countNeighbors = (x, y) => this.neighborhood.countNeighbors(x, y, getCell);

        // Escribir en el back buffer; sin asignación de grid nueva
        const outGrid = this.gridManager.getBackGrid();
        const result = this.ruleEngine.nextGeneration(this.gridManager.grid, countNeighbors, outGrid);

        // Swap O(1): el back buffer pasa a ser el grid activo
        this.gridManager.swapBuffers();
        this.generation++;

        // Notificar cambios: índices planos (Uint32Array) + cantidad válida
        if (this._callbacks.onCellChange && result.changedCount > 0) {
            this._callbacks.onCellChange(result.changedCells, result.changedCount);
        }

        // Notificar nueva generación
        const stats = {
            generation: this.generation,
            population: this.gridManager.countPopulation(),
            density: this.gridManager.getStats().density,
            births: result.generationStats.births,
            deaths: result.generationStats.deaths
        };

        if (this._callbacks.onGeneration) {
            this._callbacks.onGeneration(stats);
        }

        return stats;
    }

    /**
     * Obtiene el estado de una celda
     */
    getCell(x, y) {
        return this.gridManager.getCell(x, y);
    }

    /**
     * Establece el estado de una celda
     */
    setCell(x, y, state) {
        const changed = this.gridManager.setCell(x, y, state);
        if (changed && this._callbacks.onCellChange) {
            this._callbacks.onCellChange([{x, y, from: state ? 0 : 1, to: state}]);
        }
        return changed;
    }

    /**
     * Limpia el grid
     */
    clear() {
        this.gridManager.clear();
        this.generation = 0;
        if (this._callbacks.onStateChange) {
            this._callbacks.onStateChange({type: 'clear'});
        }
    }

    /**
     * Redimensiona el grid
     */
    resize(newSize) {
        const result = this.gridManager.resize(newSize);
        if (result.wasResized) {
            this.size = newSize;
            this.neighborhood.configure({gridSize: newSize});
            this.generation = 0;
            if (this._callbacks.onStateChange) {
                this._callbacks.onStateChange({type: 'resize', size: newSize});
            }
        }
        return result;
    }

    /**
     * Cambia la regla
     */
    setRule(rule) {
        this.ruleEngine.setRule(rule);
        this.generation = 0;
        if (this._callbacks.onStateChange) {
            this._callbacks.onStateChange({type: 'ruleChange', rule: this.ruleEngine.ruleString});
        }
    }

    /**
     * Cambia configuración de vecindad
     */
    setNeighborhood(options) {
        this.neighborhood.configure(options);
        this.generation = 0;
        if (this._callbacks.onStateChange) {
            this._callbacks.onStateChange({
                type: 'neighborhoodChange',
                info: this.neighborhood.getInfo()
            });
        }
    }

    /**
     * Obtiene estadísticas actuales
     */
    getStats() {
        const gridStats = this.gridManager.getStats();
        return {
            ...gridStats,
            generation: this.generation,
            rule: this.ruleEngine.ruleString
        };
    }

    /**
     * Serializa estado completo
     */
    serialize() {
        return {
            grid: this.gridManager.serialize(),
            generation: this.generation,
            rule: {
                birth: this.ruleEngine.birth,
                survival: this.ruleEngine.survival
            },
            neighborhood: this.neighborhood.getInfo()
        };
    }

    /**
     * Deserializa estado
     */
    deserialize(data) {
        if (data.grid) {
            this.gridManager.deserialize(data.grid);
        }
        if (data.generation !== undefined) {
            this.generation = data.generation;
        }
        if (data.rule) {
            this.ruleEngine.setRule(data.rule);
        }
        if (data.neighborhood) {
            this.neighborhood.configure(data.neighborhood);
        }
        if (this._callbacks.onStateChange) {
            this._callbacks.onStateChange({type: 'deserialize'});
        }
    }

    /**
     * Crea patrón aleatorio
     * @param {number} density - Entre 0 y 1
     */
    randomize(density = 0.35) {
        const validDensity = Math.max(0, Math.min(1, density));

        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                const state = Math.random() < validDensity ? 1 : 0;
                this.gridManager.grid[x][y] = state;
            }
        }

        this.generation = 0;

        const stats = this.getStats();
        if (this._callbacks.onStateChange) {
            this._callbacks.onStateChange({type: 'randomize', density: validDensity, stats});
        }

        return stats;
    }

    /**
     * Obtiene información de la vecindad de una celda (para visualización)
     */
    getNeighborhoodInfo(x, y) {
        return {
            coordinates: this.neighborhood.getNeighborCoordinates(x, y),
            count: this.neighborhood.countNeighbors(x, y, (nx, ny) => this.getCell(nx, ny))
        };
    }

    /**
     * Destruye y limpia recursos
     */
    destroy() {
        this._callbacks = {};
        // GridManager y demás serán garbage collected
    }
}

// Exportar global
window.CellularAutomatonCore = CellularAutomatonCore;