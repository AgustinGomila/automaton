// Cargador de reglas desde JSON
class RulesLoader {

    constructor() {
        this.RULES = {};
        this.isLoaded = false;
    }

    async load() {
        try {
            const response = await fetch('assets/rules.json');
            const data = await response.json();
            this.RULES = data.rules || {};
            this.isLoaded = true;

            // Ordenar reglas lexicográficamente por B, luego por S
            this.RULES = this._sortRulesLexicographically(this.RULES);

            window.RULES = this.RULES;

            // === Emitir evento ===
            eventBus.emit('rules:loaded', {rules: this.RULES});
            return this.RULES;
        } catch (error) {
            console.warn('⚠️ Fetch fallido, usando embedded:', error.message);
            return this.loadEmbeddedRules();
        }
    }

    async loadEmbeddedRules() {
        this.RULES = {
            custom: {
                name: "Personalizada",
                ruleString: "B.../S...",
                description: "Regla personalizada",
                descriptionLong: "",
                author: "",
                survival: [],
                birth: []
            },
            kauffman: {
                name: "Kauffman",
                ruleString: "B37/S4567",
                description: "Regla de Kauffman",
                descriptionLong: "Regla basada en el trabajo sobre autopoiesis de Francisco Varela",
                author: "Louis Kauffman",
                survival: [4, 5, 6, 7],
                birth: [3, 7]
            },
            conway: {
                name: "Conway's Life",
                ruleString: "B3/S23",
                description: "El autómata celular más famoso",
                descriptionLong: "Este es el autómata celular más famoso jamás inventado. La gente ha estado descubriendo patrones para esta regla desde alrededor de 1970. Grandes colecciones están disponibles en Internet. La definición de la regla es muy simple: una célula viva permanece viva solo cuando está rodeada por 2 o 3 vecinos vivos; de lo contrario, muere de soledad o sobrepoblación. Una célula muerta cobra vida cuando tiene exactamente 3 vecinos vivos.",
                author: "John Conway",
                survival: [2, 3],
                birth: [3]
            },
        };
        this.isLoaded = true;

        // Ordenar reglas lexicográficamente por B, luego por S
        this.RULES = this._sortRulesLexicographically(this.RULES);

        window.RULES = this.RULES;

        // === Emitir evento ===
        eventBus.emit('rules:loaded', {rules: this.RULES});
    }

    /**
     * Ordena las reglas lexicográficamente basándose en los valores de B (birth) y S (survival).
     * Orden: B < B3 < B34 < B345 < B37 < B4 < B5, luego S < S12 < S123 < S2 < S23 < S3
     * @param {Object} rules - Objeto con las reglas
     * @returns {Object} - Objeto con las reglas ordenadas
     * @private
     */
    _sortRulesLexicographically(rules) {
        const sortedEntries = Object.entries(rules).sort((a, b) => {
            const ruleA = a[1];
            const ruleB = b[1];

            // Crear claves de ordenación: strings concatenados de birth y survival
            const bKeyA = (ruleA.birth || []).slice().sort((x, y) => x - y).join('');
            const bKeyB = (ruleB.birth || []).slice().sort((x, y) => x - y).join('');

            // Comparar birth lexicográficamente
            if (bKeyA !== bKeyB) {
                return bKeyA.localeCompare(bKeyB);
            }

            // Si birth es igual, comparar survival
            const sKeyA = (ruleA.survival || []).slice().sort((x, y) => x - y).join('');
            const sKeyB = (ruleB.survival || []).slice().sort((x, y) => x - y).join('');

            return sKeyA.localeCompare(sKeyB);
        });

        // Reconstruir el objeto manteniendo el orden
        const sortedRules = {};
        for (const [key, value] of sortedEntries) {
            sortedRules[key] = value;
        }

        return sortedRules;
    }
}

// Crear instancia global
if (typeof window.eventBus === 'undefined') {
    console.warn('EventBus no disponible, creando instancia temporal');
    window.eventBus = new (class {
        emit() {
        }

        on() {
            return () => {
            };
        }

        destroy() {
        }
    })();
}
window.rulesLoader = new RulesLoader();