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
            window.RULES = this.RULES;

            // === Emitir evento ===
            eventBus.emit('rules:loaded', {rules: this.RULES});
            return this.RULES;

        } catch (error) {
            await this.loadEmbeddedRules();
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
        window.RULES = this.RULES;

        // === Emitir evento ===
        eventBus.emit('rules:loaded', {rules: this.RULES});
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