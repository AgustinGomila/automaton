import {AppConfig} from '../utils/config.js';
import {GridManager} from './grid-manager.js';
import {NeighborhoodCalculator} from './neighborhood-calculator.js';
import {RuleEngine} from './engines/rule-engine.js';

/**
 * Tipos de cambio de estado que el núcleo notifica vía `onStateChange`.
 * Centralizar el literal evita que un typo entre productor (aquí) y consumidor
 * (`automaton._handleCoreStateChange`) silencie un caso del switch sin error.
 */
export const CoreStateChange = Object.freeze({
    CLEAR: 'clear',
    RESIZE: 'resize',
    RULE_CHANGE: 'ruleChange',
    NEIGHBORHOOD_CHANGE: 'neighborhoodChange',
    DESERIALIZE: 'deserialize',
});

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
     * @param {Object}  options.rule                — { birth: number[], survival: number[] }
     * @param {string}  options.neighborhoodType    — 'moore' | 'neumann'
     * @param {number}  options.neighborhoodRadius
     * @param {boolean} options.wrapEdges
     */
    constructor(options = {}) {
        const w = Math.min(Math.max(options.width ?? AppConfig.GRID.DEFAULT_WIDTH, AppConfig.GRID.MIN_CELLS), AppConfig.GRID.MAX_CELLS);
        const h = Math.min(Math.max(options.height ?? AppConfig.GRID.DEFAULT_HEIGHT, AppConfig.GRID.MIN_CELLS), AppConfig.GRID.MAX_CELLS);

        this.width = w;
        this.height = h;

        this.gridManager = new GridManager(this.width, this.height);

        this.neighborhood = new NeighborhoodCalculator({
            type: options.neighborhoodType || 'moore',
            radius: options.neighborhoodRadius || 1,
            // Acepta wrapMode (nuevo) o wrapEdges boolean (backward-compat)
            ...(options.wrapMode !== undefined
                ? {wrapMode: options.wrapMode}
                : {wrapEdges: options.wrapEdges !== false}),
            gridWidth: this.width,
            gridHeight: this.height
        });

        this.ruleEngine = new RuleEngine(options.rule || {birth: [3], survival: [2, 3]});

        this.generation = 0;

        // Población cacheada — evita la 2ª pasada N² de countPopulation() en cada
        // step(). step() la mantiene incrementalmente (+= births - deaths); cualquier
        // mutación del grid fuera de step() invalida el baseline para forzar un
        // recuento único en la próxima lectura.
        this._population = 0;
        this._populationValid = false;

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
                this.gridManager.grid, outGrid,
                this.neighborhood.wrapX, this.neighborhood.wrapY,
                width, height)
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

        // Población incremental: con baseline válido basta sumar el delta del paso
        // (births - deaths). Si es inválido, el recuento post-swap ya es la población
        // de la nueva generación, así que NO se le suma el delta. Elimina el
        // full-scan por generación cuando el baseline se mantiene válido.
        if (this._populationValid) {
            this._population += result.generationStats.births - result.generationStats.deaths;
        } else {
            this._population = this.gridManager.countPopulation();
            this._populationValid = true;
        }
        const population = this._population;
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
        if (changed) {
            // El grid cambió fuera de step(): invalidar el baseline de población.
            this._populationValid = false;
            if (this._callbacks.onCellChange) {
                this._callbacks.onCellChange([{x, y, from: state ? 0 : 1, to: state}]);
            }
        }
        return changed;
    }

    // =========================================
    // POBLACIÓN CACHEADA
    // =========================================

    /**
     * Marca el baseline de población como inválido. Lo llama el coordinador
     * (vía automaton.updateStats) tras cualquier edición que mute el grid sin
     * pasar por step(): randomize, paste, import, shift, clear de área, etc.
     */
    invalidatePopulation() {
        this._populationValid = false;
    }

    /**
     * Devuelve la población viva, recontando una sola vez si el baseline es
     * inválido y cacheando el resultado. O(1) mientras el baseline siga válido.
     * @returns {number}
     */
    getPopulation() {
        if (!this._populationValid) {
            this._population = this.gridManager.countPopulation();
            this._populationValid = true;
        }
        return this._population;
    }

    // =========================================
    // CONFIGURACIÓN
    // =========================================

    clear() {
        this.gridManager.clear();
        this.generation = 0;
        this._population = 0;
        this._populationValid = true;
        this._callbacks.onStateChange?.({type: CoreStateChange.CLEAR});
    }

    /**
     * Redimensiona el grid.
     * @param {number} newWidth
     * @param {number} [newHeight=newWidth]
     */
    resize(newWidth, newHeight = newWidth) {
        const result = this.gridManager.resize(newWidth, newHeight);
        if (result.wasResized) {
            this._populationValid = false;
            this.width = this.gridManager.width;
            this.height = this.gridManager.height;
            this.neighborhood.configure({
                gridWidth: this.width,
                gridHeight: this.height
            });
            this.generation = 0;
            this._callbacks.onStateChange?.({
                type: CoreStateChange.RESIZE, width: this.width, height: this.height
            });
        }
        return result;
    }

    setRule(rule) {
        this.ruleEngine.setRule(rule);
        this.generation = 0;
        this._callbacks.onStateChange?.({type: CoreStateChange.RULE_CHANGE, rule: this.ruleEngine.ruleString});
    }

    setNeighborhood(options) {
        this.neighborhood.configure(options);
        this.generation = 0;
        this._callbacks.onStateChange?.({
            type: CoreStateChange.NEIGHBORHOOD_CHANGE,
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
        this._populationValid = false;
        if (data.generation !== undefined) this.generation = data.generation;
        if (data.rule) this.ruleEngine.setRule(data.rule);
        if (data.neighborhood) this.neighborhood.configure(data.neighborhood);
        this._callbacks.onStateChange?.({type: CoreStateChange.DESERIALIZE});
    }

    destroy() {
        this._callbacks = {};
    }
}

export {CellularAutomatonCore};