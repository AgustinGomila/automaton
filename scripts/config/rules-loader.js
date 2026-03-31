/**
 * scripts/config/rules-loader.js
 *
 * Carga las reglas B/S desde assets/rules.json (con fallback embebido).
 * Emite 'rules:loaded' en el eventBus cuando las reglas están disponibles.
 *
 * El dato canónico vive en la propiedad `.RULES` de la instancia exportada.
 * Los consumidores importan `rulesLoader` y acceden a `rulesLoader.RULES`
 * en lugar de usar `window.RULES`.
 */

import {eventBus} from '../infrastructure/event-bus.js';
import {getLexicographicSortKey} from './rules.js';

class RulesLoader {

    constructor() {
        /** @type {Object.<string, Object>} Mapa de reglas cargadas */
        this.RULES = {};
        this.isLoaded = false;
    }

    /**
     * Carga las reglas desde el servidor.
     * Si el fetch falla, recurre a las reglas embebidas mínimas.
     * @returns {Promise<Object>} — el mapa de reglas ordenado
     */
    async load() {
        try {
            const response = await fetch('assets/rules.json');
            const data = await response.json();
            this.RULES = this._sortRulesLexicographically(data.rules || {});
            this.isLoaded = true;
            eventBus.emit('rules:loaded', {rules: this.RULES});
            return this.RULES;
        } catch (error) {
            console.warn('⚠️ Fetch fallido, usando embedded:', error.message);
            return this._loadEmbeddedRules();
        }
    }

    /** @private */
    _loadEmbeddedRules() {
        this.RULES = this._sortRulesLexicographically({
            custom: {
                name: 'Personalizada',
                ruleString: 'B.../S...',
                description: 'Regla personalizada',
                descriptionLong: '',
                author: '',
                survival: [],
                birth: []
            },
            conway: {
                name: "Conway's Life",
                ruleString: 'B3/S23',
                description: 'El autómata celular más famoso',
                descriptionLong: 'Este es el autómata celular más famoso jamás inventado. La gente ha estado descubriendo patrones para esta regla desde alrededor de 1970. Grandes colecciones están disponibles en Internet. La definición de la regla es muy simple: una célula viva permanece viva solo cuando está rodeada por 2 o 3 vecinos vivos; de lo contrario, muere de soledad o sobrepoblación. Una célula muerta cobra vida cuando tiene exactamente 3 vecinos vivos.',
                author: 'John Conway',
                survival: [2, 3],
                birth: [3]
            },
            kauffman: {
                name: 'Kauffman',
                ruleString: 'B37/S4567',
                description: 'Regla de Kauffman',
                descriptionLong: 'Regla basada en el trabajo sobre autopoiesis de Francisco Varela',
                author: 'Louis Kauffman',
                survival: [4, 5, 6, 7],
                birth: [3, 7]
            }
        });
        this.isLoaded = true;
        eventBus.emit('rules:loaded', {rules: this.RULES});
        return this.RULES;
    }

    /**
     * Ordena las reglas lexicográficamente por B, luego por S.
     * @param   {Object} rules
     * @returns {Object}
     * @private
     */
    _sortRulesLexicographically(rules) {
        const sorted = Object.entries(rules).sort(([, a], [, b]) => {
            const keyA = getLexicographicSortKey(a.birth || [], a.survival || []);
            const keyB = getLexicographicSortKey(b.birth || [], b.survival || []);
            return keyA.localeCompare(keyB);
        });

        const result = {};
        for (const [key, value] of sorted) result[key] = value;
        return result;
    }
}

/** Instancia singleton — importar este símbolo en lugar de `window.rulesLoader`. */
export const rulesLoader = new RulesLoader();
export {RulesLoader};