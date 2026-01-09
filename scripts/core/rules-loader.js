// Cargador de reglas desde JSON

class RulesLoader {
    constructor() {
        this.RULES = {};
        this.isLoaded = false;
    }

    async load() {
        try {
            console.log('Cargando reglas desde rules.json...');

            // Intentar cargar desde el archivo JSON
            const response = await fetch('assets/rules.json');

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();
            this.RULES = data.rules || {};
            this.isLoaded = true;

            console.log(`✓ ${Object.keys(this.RULES).length} reglas cargadas correctamente`);

            // Exportar a ventana global
            window.RULES = this.RULES;

            return this.RULES;

        } catch (error) {
            console.warn('No se pudo cargar rules.json, usando reglas embebidas:', error.message);

            // Cargar reglas embebidas como fallback
            await this.loadEmbeddedRules();

            return this.RULES;
        }
    }

    async loadEmbeddedRules() {
        // Reglas embebidas mínimas como fallback
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

        console.log('✓ Reglas embebidas cargadas como fallback');
    }
}

// Crear instancia global
window.rulesLoader = new RulesLoader();