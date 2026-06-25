/**
 * Modos de límite de la simulación. El productor (select#limitType en index.html,
 * leído por ui-controller) y el consumidor (SimulationLimiter) comparten estos valores.
 */
export const LimitType = Object.freeze({
    NONE: 'none',
    GENERATIONS: 'generations',
    POPULATION: 'population',
});

/**
 * SimulationLimiter - Gestiona los límites de ejecución de la simulación.
 *
 * Responsabilidad: controlar si se ha alcanzado un límite de generaciones
 * o población, y notificarlo para que el coordinador detenga la simulación.
 *
 * No conoce nada de grids, motores ni renderizado.
 */
class SimulationLimiter {
    /**
     * @param {Object} options
     * @param {Function} options.onLimitReached - Llamado cuando se alcanza el límite.
     */
    constructor({onLimitReached}) {
        this._onLimitReached = onLimitReached;

        this.limitType = LimitType.NONE;
        this.limitValue = 100;
        this.maxGenerations = null;
        this.maxPopulation = null;
        this.isLimitReached = false;
    }

    /**
     * Configura el límite activo.
     * @param {string} type - Uno de los valores de {@link LimitType}.
     * @param {number} value
     */
    setLimit(type, value) {
        this.limitType = type;
        this.limitValue = value;

        switch (type) {
            case LimitType.NONE:
                this.maxGenerations = null;
                this.maxPopulation = null;
                break;
            case LimitType.GENERATIONS:
                this.maxGenerations = parseInt(value);
                this.maxPopulation = null;
                break;
            case LimitType.POPULATION:
                this.maxPopulation = parseInt(value);
                this.maxGenerations = null;
                break;
        }

        this.isLimitReached = false;
    }

    /**
     * Comprueba si se ha alcanzado el límite activo.
     * @param {number} generation - Generación actual.
     * @param {Function} getPopulation - Callback que devuelve la población actual.
     * @returns {boolean}
     */
    check(generation, getPopulation) {
        if (this.limitType === LimitType.NONE) {
            this.isLimitReached = false;
            return false;
        }

        if (this.limitType === LimitType.GENERATIONS && this.maxGenerations !== null) {
            this.isLimitReached = generation >= this.maxGenerations;
        } else if (this.limitType === LimitType.POPULATION && this.maxPopulation !== null) {
            this.isLimitReached = getPopulation() >= this.maxPopulation;
        }

        if (this.isLimitReached) {
            this._onLimitReached();
        }

        return this.isLimitReached;
    }

    reset() {
        this.isLimitReached = false;
    }

    destroy() {
        this._onLimitReached = null;
    }
}

export {SimulationLimiter};