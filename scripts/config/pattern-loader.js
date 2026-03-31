/**
 * scripts/config/pattern-loader.js
 *
 * Carga los patrones desde assets/patterns.json (con fallback a los patrones
 * embebidos mínimos definidos en patterns.js).
 * Emite 'patterns:loaded' cuando los datos están disponibles.
 *
 * El dato canónico vive en la propiedad `.PATTERNS` de la instancia exportada.
 * Los consumidores importan `patternLoader` y acceden a `patternLoader.PATTERNS`
 * en lugar de usar `window.PATTERNS`.
 */

import {eventBus} from '../infrastructure/event-bus.js';

/** Patrones mínimos de fallback — usados cuando el fetch falla. */
const DEFAULT_PATTERNS = {
    single: {
        name: 'Punto',
        description: 'Celda individual',
        category: 'general',
        rule: 'general',
        cellCount: 1,
        color: '#10b981',
        pattern: [[1]]
    },
    block: {
        name: 'Bloque',
        description: 'Bloque 2x2 - vida estable',
        category: 'general',
        rule: 'general',
        cellCount: 4,
        color: '#3b82f6',
        pattern: [[1, 1], [1, 1]]
    },
    random: {
        name: 'Aleatorio',
        description: 'Patrón aleatorio',
        category: 'general',
        rule: 'general',
        cellCount: 0,
        color: '#8b5cf6',
        pattern: 'random'
    }
};

class PatternLoader {

    constructor() {
        /** @type {Object.<string, Object>} Mapa de patrones cargados */
        this.PATTERNS = {};
        this.isLoaded = false;
    }

    /**
     * Carga los patrones desde el servidor.
     * Si el fetch falla, recurre a los patrones embebidos mínimos.
     * @returns {Promise<Object>}
     */
    async load() {
        try {
            const response = await fetch('assets/patterns.json');
            const data = await response.json();
            this.PATTERNS = data.patterns || {};
            this.isLoaded = true;
            eventBus.emit('patterns:loaded', {patterns: this.PATTERNS});
            return this.PATTERNS;
        } catch (error) {
            console.error('Error cargando patrones:', error);
            return this._loadEmbeddedPatterns();
        }
    }

    /** @private */
    _loadEmbeddedPatterns() {
        this.PATTERNS = DEFAULT_PATTERNS;
        this.isLoaded = true;
        eventBus.emit('patterns:loaded', {patterns: this.PATTERNS});
        return this.PATTERNS;
    }
}

/** Instancia singleton — importar este símbolo en lugar de `window.patternLoader`. */
export const patternLoader = new PatternLoader();
export {PatternLoader};