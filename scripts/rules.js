// rules.js
const RULES = {
    custom: {
        name: "Personalizada",
        ruleString: "B.../S...",
        description: "Regla personalizada",
        survival: [],
        birth: []
    },
    kauffman: {
        name: "Kauffman",
        ruleString: "B37/S4567",
        description: "Regla de Kauffman",
        survival: [4, 5, 6, 7],
        birth: [3, 7]
    },
    conway: {
        name: "Conway's Life",
        ruleString: "B3/S23",
        description: "El autómata celular más famoso",
        survival: [2, 3],
        birth: [3]
    },
    '2x2': {
        name: "2x2",
        ruleString: "B36/S125",
        description: "Similar a Conway's Life, pero con diferentes patrones",
        survival: [1, 2, 5],
        birth: [3, 6]
    },
    '34life': {
        name: "34 Life",
        ruleString: "B34/S34",
        description: "Universo explosivo con osciladores y nave periodo-3",
        survival: [3, 4],
        birth: [3, 4]
    },
    amoeba: {
        name: "Amoeba",
        ruleString: "B357/S1358",
        description: "Forma áreas aleatorias que se asemejan a amebas",
        survival: [1, 3, 5, 8],
        birth: [3, 5, 7]
    },
    assimilation: {
        name: "Assimilation",
        ruleString: "B345/S4567",
        description: "Similar a Diamoeba, pero más estable",
        survival: [4, 5, 6, 7],
        birth: [3, 4, 5]
    },
    coagulations: {
        name: "Coagulations",
        ruleString: "B378/S235678",
        description: "Crea coagulaciones pegajosas que se expanden para siempre",
        survival: [2, 3, 5, 6, 7, 8],
        birth: [3, 7, 8]
    },
    coral: {
        name: "Coral",
        ruleString: "B3/S45678",
        description: "Produce patrones con textura de coral",
        survival: [4, 5, 6, 7, 8],
        birth: [3]
    },
    daynight: {
        name: "Day & Night",
        ruleString: "B3678/S34678",
        description: "Simétrico: células muertas en campos vivos actúan igual que vivas en campos muertos",
        survival: [3, 4, 6, 7, 8],
        birth: [3, 6, 7, 8]
    },
    diamoeba: {
        name: "Diamoeba",
        ruleString: "B35678/S5678",
        description: "Crea patrones de diamante en forma de ameba",
        survival: [5, 6, 7, 8],
        birth: [3, 5, 6, 7, 8]
    },
    flakes: {
        name: "Flakes",
        ruleString: "B3/S012345678",
        description: "También conocido como Life without Death (LwoD)",
        survival: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        birth: [3]
    },
    gnarl: {
        name: "Gnarl",
        ruleString: "B1/S1",
        description: "Regla simple que produce patrones complejos desde un solo punto",
        survival: [1],
        birth: [1]
    },
    highlife: {
        name: "HighLife",
        ruleString: "B36/S23",
        description: "Similar a Conway's Life, pero con un replicador",
        survival: [2, 3],
        birth: [3, 6]
    },
    inverselife: {
        name: "InverseLife",
        ruleString: "B0123478/S34678",
        description: "Muestra osciladores y planeadores similares a GOL, pero en negativo",
        survival: [3, 4, 6, 7, 8],
        birth: [0, 1, 2, 3, 4, 7, 8]
    },
    longlife: {
        name: "Long life",
        ruleString: "B345/S5",
        description: "Produce patrones de período extremadamente alto",
        survival: [5],
        birth: [3, 4, 5]
    },
    maze: {
        name: "Maze",
        ruleString: "B3/S12345",
        description: "Cristaliza en patrones tipo laberinto",
        survival: [1, 2, 3, 4, 5],
        birth: [3]
    },
    mazectric: {
        name: "Mazectric",
        ruleString: "B3/S1234",
        description: "Variación de Maze que produce pasillos más largos",
        survival: [1, 2, 3, 4],
        birth: [3]
    },
    move: {
        name: "Move",
        ruleString: "B368/S245",
        description: "Universo muy calmado con nave lenta común",
        survival: [2, 4, 5],
        birth: [3, 6, 8]
    },
    pseudolife: {
        name: "Pseudo life",
        ruleString: "B357/S238",
        description: "Variación cercana a Conway's Life, pero casi ningún patrón diseñado funciona",
        survival: [2, 3, 8],
        birth: [3, 5, 7]
    },
    replicator: {
        name: "Replicator",
        ruleString: "B1357/S1357",
        description: "Cada patrón es un replicador",
        survival: [1, 3, 5, 7],
        birth: [1, 3, 5, 7]
    },
    seeds: {
        name: "Seeds",
        ruleString: "B2/S",
        description: "Toda célula viva muere cada generación, pero la mayoría de patrones explotan",
        survival: [],
        birth: [2]
    },
    serviettes: {
        name: "Serviettes",
        ruleString: "B234/S",
        description: "Como Seeds, produce patrones con belleza tipo tejido",
        survival: [],
        birth: [2, 3, 4]
    },
    stains: {
        name: "Stains",
        ruleString: "B3678/S235678",
        description: "Variación que no se expande para siempre",
        survival: [2, 3, 5, 6, 7, 8],
        birth: [3, 6, 7, 8]
    },
    walledcities: {
        name: "Walled Cities",
        ruleString: "B45678/S2345",
        description: "Crea ciudades amuralladas de actividad",
        survival: [2, 3, 4, 5],
        birth: [4, 5, 6, 7, 8]
    }
};

// Función para parsear una regla en notación estándar (ej. "B3/S23")
function parseRuleString(ruleString) {
    const parts = ruleString.split('/');
    let birth = [];
    let survival = [];

    if (parts[0].startsWith('B')) {
        birth = parts[0].substring(1).split('').map(Number);
    }

    if (parts[1] && parts[1].startsWith('S')) {
        survival = parts[1].substring(1).split('').map(Number);
    }

    return {survival, birth};
}

function parseCustomRule(birthStr, survivalStr) {
    // Validar entrada vacía
    if (!birthStr && !survivalStr) {
        throw new Error('Al menos uno de los campos debe contener valores');
    }

    // Validar formato
    const isValid = str => /^[\d,\s]*$/.test(str);
    if (!isValid(birthStr) || !isValid(survivalStr)) {
        throw new Error('Solo se permiten números, comas y espacios');
    }

    // Convertir strings como "3,7" o "3 7" o "37" a arrays de números
    function parseNumbers(str) {
        if (!str) return [];

        // Si es solo números sin separadores (ej: "37")
        if (/^\d+$/.test(str)) {
            return str.split('').map(Number);
        }

        // Si usa comas, espacios, o ambos
        return str.split(/[,\s]+/)
            .filter(s => s.trim() !== '')
            .map(Number)
            .filter(n => !isNaN(n) && n >= 0 && n <= 8);
    }

    return {
        survival: parseNumbers(survivalStr),
        birth: parseNumbers(birthStr)
    };
}

// Exportar
window.RULES = RULES;
window.parseRuleString = parseRuleString;
window.parseCustomRule = parseCustomRule;