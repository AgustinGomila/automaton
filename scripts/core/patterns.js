// Definición de patrones predefinidos
const PATTERNS = {
    // === PATRONES PEQUEÑOS (hasta 10 células) ===
    single: {
        name: "Punto",
        description: "Celda individual",
        category: "básico",
        cellCount: 1,
        color: "#10b981",
        pattern: [[1]]
    },
    block: {
        name: "Bloque",
        description: "Bloque 2x2 - vida estable",
        category: "vida estable",
        cellCount: 4,
        color: "#3b82f6",
        pattern: [
            [1, 1],
            [1, 1]
        ]
    },
    beehive: {
        name: "Colmena",
        description: "Patrón estable común",
        category: "vida estable",
        cellCount: 6,
        color: "#f59e0b",
        pattern: [
            [0, 1, 1, 0],
            [1, 0, 0, 1],
            [0, 1, 1, 0]
        ]
    },
    loaf: {
        name: "Pan",
        description: "Patrón estable",
        category: "vida estable",
        cellCount: 7,
        color: "#8b5cf6",
        pattern: [
            [0, 1, 1, 0],
            [1, 0, 0, 1],
            [0, 1, 0, 1],
            [0, 0, 1, 0]
        ]
    },
    boat: {
        name: "Bote",
        description: "Patrón estable",
        category: "vida estable",
        cellCount: 5,
        color: "#06b6d4",
        pattern: [
            [1, 1, 0],
            [1, 0, 1],
            [0, 1, 0]
        ]
    },
    tub: {
        name: "Tubo",
        description: "Patrón estable",
        category: "vida estable",
        cellCount: 4,
        color: "#d406ab",
        pattern: [
            [0, 1, 0],
            [1, 0, 1],
            [0, 1, 0]
        ]
    },

    // === OSCILADORES ===
    blinker: {
        name: "Parpadeador",
        description: "Oscilador periodo 2 (3 células)",
        category: "oscilador",
        cellCount: 3,
        color: "#ef4444",
        pattern: [
            [1, 1, 1]
        ]
    },
    toad: {
        name: "Sapo",
        description: "Oscilador periodo 2",
        category: "oscilador",
        cellCount: 6,
        color: "#f50b49",
        pattern: [
            [0, 1, 1, 1],
            [1, 1, 1, 0]
        ]
    },
    beacon: {
        name: "Baliza",
        description: "Oscilador periodo 2",
        category: "oscilador",
        cellCount: 8,
        color: "#10b981",
        pattern: [
            [1, 1, 0, 0],
            [1, 1, 0, 0],
            [0, 0, 1, 1],
            [0, 0, 1, 1]
        ]
    },
    pulsar: {
        name: "Pulsar",
        description: "Oscilador periodo 3 (48 células)",
        category: "oscilador",
        cellCount: 48,
        color: "#8b5cf6",
        pattern: [
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
        ]
    },
    pentadecathlon: {
        name: "Pentadecathlon",
        description: "Oscilador periodo 15 (22 células)",
        category: "oscilador",
        cellCount: 22,
        color: "#f59e0b",
        pattern: [
            [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
            [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1],
            [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
        ]
    },

    // === PLANEADORES (GLIDERS) ===
    glider: {
        name: "Planeador",
        description: "Nave que se mueve diagonalmente",
        category: "planeador",
        cellCount: 5,
        color: "#3b82f6",
        pattern: [
            [0, 1, 0],
            [0, 0, 1],
            [1, 1, 1]
        ]
    },
    lwss: {
        name: "Nave Ligera",
        description: "Lightweight spaceship (nave espacial ligera)",
        category: "nave",
        cellCount: 9,
        color: "#06b6d4",
        pattern: [
            [1, 0, 0, 1, 0],
            [0, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 1],
        ]
    },
    mwss: {
        name: "Nave Media",
        description: "Middleweight spaceship (nave espacial media)",
        category: "nave",
        cellCount: 11,
        color: "#8b5cf6",
        pattern: [
            [0, 0, 1, 0, 0, 0],
            [1, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1],
            [0, 1, 1, 1, 1, 1],
        ]
    },
    hwss: {
        name: "Nave Pesada",
        description: "Heavyweight spaceship (nave espacial pesada)",
        category: "nave",
        cellCount: 13,
        color: "#d406ab",
        pattern: [
            [0, 0, 1, 1, 0, 0, 0],
            [1, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 0, 1],
            [0, 1, 1, 1, 1, 1, 1],
        ]
    },

    // === PATRONES DE CRECIMIENTO LENTO ===
    rpentomino: {
        name: "R-pentominó",
        description: "Patrón que crece por 1103 generaciones",
        category: "metuselah",
        cellCount: 5,
        color: "#ef4444",
        pattern: [
            [0, 1, 1],
            [1, 1, 0],
            [0, 1, 0]
        ]
    },
    diehard: {
        name: "Diehard",
        description: "Desaparece después de 130 generaciones",
        category: "metuselah",
        cellCount: 8,
        color: "#f59e0b",
        pattern: [
            [0, 0, 0, 0, 0, 0, 1, 0],
            [1, 1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 1, 1, 1]
        ]
    },
    acorn: {
        name: "Bellota",
        description: "Crece por 5206 generaciones",
        category: "metuselah",
        cellCount: 7,
        color: "#10b981",
        pattern: [
            [0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 1, 0, 0, 0],
            [1, 1, 0, 0, 1, 1, 1]
        ]
    },

    // === PATRONES COMPLEJOS ===
    gosperglidergun: {
        name: "Cañón de Planeadores",
        description: "Genera planeadores indefinidamente (Gosper Glider Gun)",
        category: "generador",
        cellCount: 36,
        color: "#8b5cf6",
        pattern: [
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ]
    },
    simkinglide: {
        name: "Simkin Glider Gun",
        description: "Generador de planeadores compacto",
        category: "generador",
        cellCount: 21,
        color: "#f59e0b",
        pattern: [
            [1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ]
    },
    gospergliderguneater: {
        name: "Cañón de Planeadores con Devorador",
        description: "Genera planeadores indefinidamente (Gosper Glider Gun)",
        category: "generador",
        cellCount: 46,
        color: "#5c8df6",
        pattern: [
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
        ]
    },

    // === PATRONES ORIGINALES ===
    pattern1: {
        name: "KI",
        description: "---",
        category: "oscilador",
        cellCount: 8,
        color: "#0666d4",
        pattern: [
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ]
    },
    pattern2: {
        name: "KII",
        description: "---",
        category: "oscilador",
        cellCount: 7,
        color: "#8b5cf6",
        pattern: [
            [1, 1, 0],
            [1, 1, 1],
            [0, 1, 1],
        ]
    },
    pattern3: {
        name: "KIII",
        description: "Cruz simple de 5 células",
        category: "oscilador",
        cellCount: 5,
        color: "#f5bb0b",
        pattern: [
            [0, 1, 0],
            [1, 1, 1],
            [0, 1, 0]
        ]
    },
    pattern4: {
        name: "KIV",
        description: "---",
        category: "oscilador",
        cellCount: 8,
        color: "#f59e0b",
        pattern: [
            [1, 0, 0, 0],
            [0, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 0, 1, 1]
        ]
    },
    pattern5: {
        name: "KV",
        description: "---",
        category: "oscilador",
        cellCount: 9,
        color: "#d45506",
        pattern: [
            [0, 1, 1, 1, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 1, 0, 0],
        ]
    },
    pattern6: {
        name: "KVI",
        description: "---",
        category: "oscilador",
        cellCount: 10,
        color: "#06b6d4",
        pattern: [
            [1, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 1, 1, 1],
            [0, 0, 0, 1],
        ]
    },
    pattern7: {
        name: "KVII",
        description: "---",
        category: "oscilador",
        cellCount: 14,
        color: "#3b82f6",
        pattern: [
            [0, 1, 0, 1, 0],
            [1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1],
            [0, 1, 0, 1, 0]
        ]
    },
    pattern8: {
        name: "KVIII",
        description: "---",
        category: "oscilador",
        cellCount: 10,
        color: "#ef4444",
        pattern: [
            [0, 0, 0, 1, 0],
            [1, 1, 1, 0, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 0, 1, 0],
        ]
    },
    pattern9: {
        name: "KIX",
        description: "---",
        category: "oscilador",
        cellCount: 11,
        color: "#f50b49",
        pattern: [
            [0, 0, 1, 1, 0],
            [0, 1, 1, 1, 0],
            [0, 1, 1, 1, 1],
            [1, 0, 0, 1, 0],
        ]
    },
    pattern10: {
        name: "KX",
        description: "---",
        category: "oscilador",
        cellCount: 12,
        color: "#3b82f6",
        pattern: [
            [0, 0, 0, 1, 0],
            [0, 0, 0, 1, 1],
            [1, 1, 1, 1, 1],
            [0, 1, 1, 0, 1],
            [0, 1, 0, 0, 0]
        ]
    },
    pattern11: {
        name: "KXI",
        description: "---",
        category: "oscilador",
        cellCount: 16,
        color: "#f5bb0b",
        pattern: [
            [1, 1, 1, 1, 0],
            [1, 1, 1, 1, 0],
            [1, 1, 0, 1, 1],
            [1, 1, 1, 0, 0],
            [0, 0, 1, 0, 0]
        ]
    },
    pattern12: {
        name: "KXII",
        description: "---",
        category: "oscilador",
        cellCount: 10,
        color: "#63d406",
        pattern: [
            [1, 0, 0, 0, 0],
            [1, 1, 0, 0, 0],
            [0, 1, 1, 0, 0],
            [0, 0, 1, 1, 0],
            [0, 0, 0, 1, 1],
            [0, 0, 0, 0, 1],
        ]
    },
    pattern13: {
        name: "KXIII",
        description: "---",
        category: "oscilador",
        cellCount: 32,
        color: "#10b981",
        pattern: [
            [0, 1, 0, 0, 0, 1, 0],
            [1, 1, 1, 1, 1, 1, 1],
            [0, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 0, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 0],
            [1, 1, 1, 1, 1, 1, 1],
            [0, 1, 0, 0, 0, 1, 0]
        ]
    },
    pattern14: {
        name: "KXIV",
        description: "---",
        category: "oscilador",
        cellCount: 26,
        color: "#d4069a",
        pattern: [
            [0, 1, 0, 0, 0, 0, 0],
            [1, 1, 1, 1, 1, 0, 0],
            [0, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 0, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 0],
            [0, 0, 1, 1, 1, 1, 1],
            [0, 0, 0, 0, 0, 1, 0]
        ]
    },
    pattern15: {
        name: "KXV",
        description: "---",
        category: "oscilador",
        cellCount: 36,
        color: "#d44e06",
        pattern: [
            [0, 0, 0, 0, 0, 1, 0, 0],
            [0, 1, 1, 1, 1, 1, 1, 0],
            [1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 0, 0, 1, 1, 0],
            [0, 1, 1, 0, 0, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1],
            [0, 1, 1, 1, 1, 1, 1, 0],
            [0, 0, 1, 0, 0, 0, 0, 0]
        ]
    },
    pattern16: {
        name: "KXVI",
        description: "---",
        category: "vida estable",
        cellCount: 38,
        color: "#d4b906",
        pattern: [
            [0, 0, 0, 0, 1, 0, 0, 0, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [1, 0, 0, 1, 0, 1, 0, 0, 1],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0]
        ]
    },
    pattern17: {
        name: "KXVII",
        description: "---",
        category: "vida estable",
        cellCount: 44,
        color: "#0636d4",
        pattern: [
            [0, 0, 0, 0, 1, 0, 0, 0, 0],
            [0, 1, 1, 1, 0, 1, 1, 1, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [1, 1, 0, 1, 0, 1, 0, 1, 1],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 1, 1, 1, 0, 1, 1, 1, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0]
        ]
    },
    pattern18: {
        name: "KXVIII",
        description: "---",
        category: "vida estable",
        cellCount: 42,
        color: "#d406ab",
        pattern: [
            [0, 0, 0, 0, 1, 0, 0, 0, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [1, 0, 0, 1, 0, 1, 0, 0, 1],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0]
        ]
    },
    pattern19: {
        name: "KXIX",
        description: "---",
        category: "vida estable",
        cellCount: 50,
        color: "#06d42f",
        pattern: [
            [0, 0, 0, 1, 0, 1, 0, 0, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 1, 0, 1, 0, 1, 0, 1, 0],
            [1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 1, 1, 1],
            [0, 1, 0, 1, 0, 1, 0, 1, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 0, 0, 1, 0, 1, 0, 0, 0]
        ]
    },

    // === ALEATORIO ===
    random: {
        name: "Aleatorio",
        description: "Patrón aleatorio con densidad ~30%",
        category: "especial",
        cellCount: 0, // No aplica
        color: "#8b5cf6",
        pattern: "random"
    },
};

// Función para contar células en un patrón
function countPatternCells(pattern) {
    if (!pattern || pattern === 'random') return 0;

    let count = 0;
    for (let row = 0; row < pattern.length; row++) {
        for (let col = 0; col < pattern[row].length; col++) {
            if (pattern[row][col] === 1) count++;
        }
    }
    return count;
}

// Calcular cellCount para patrones que no lo tengan
Object.keys(PATTERNS).forEach(key => {
    const pattern = PATTERNS[key];
    if (pattern.pattern !== 'random' && !pattern.cellCount) {
        pattern.cellCount = countPatternCells(pattern.pattern);
    }
});

// Función para rotar una matriz 90° en sentido horario
function rotateMatrix(matrix) {
    if (!matrix || matrix === 'random') return matrix;

    const rows = matrix.length;
    const cols = matrix[0].length;
    const rotated = [];

    for (let col = 0; col < cols; col++) {
        const newRow = [];
        for (let row = rows - 1; row >= 0; row--) {
            newRow.push(matrix[row][col]);
        }
        rotated.push(newRow);
    }

    return rotated;
}

// Función para obtener patrón con rotación aplicada
function getPatternWithRotation(patternKey, rotation = 0) {
    if (!PATTERNS[patternKey]) return null;

    const original = PATTERNS[patternKey];

    // Si es random o rotación 0, devolver original
    if (original.pattern === 'random' || rotation === 0) {
        return {
            name: original.name,
            description: original.description,
            color: original.color,
            pattern: original.pattern,
            rotation: 0
        };
    }

    // Aplicar rotaciones sucesivas
    let rotatedPattern = original.pattern;
    const rotations = rotation / 90;

    for (let i = 0; i < rotations; i++) {
        rotatedPattern = rotateMatrix(rotatedPattern);
    }

    return {
        name: original.name,
        description: original.description,
        color: original.color,
        pattern: rotatedPattern,
        rotation: rotation
    };
}

// Variables globales para estado
window.selectedPatternKey = null;
window.selectedPatternRotation = 0;

function renderPatterns() {
    const container = document.getElementById('patternsContainer');
    if (!container) return;

    container.innerHTML = '';

    // Ordenar patrones por cantidad de células (de menor a mayor)
    const sortedPatterns = Object.keys(PATTERNS).sort((a, b) => {
        const patternA = PATTERNS[a];
        const patternB = PATTERNS[b];

        // El aleatorio va al final
        if (patternA.pattern === 'random') return 1;
        if (patternB.pattern === 'random') return -1;

        return patternA.cellCount - patternB.cellCount;
    });

    sortedPatterns.forEach(key => {
        if (!PATTERNS[key]) return;

        const pattern = PATTERNS[key];
        const patternBtn = document.createElement('button');
        patternBtn.className = 'pattern-btn-horizontal';
        patternBtn.dataset.patternKey = key;

        // Crear tooltip informativo
        const categoryText = pattern.category ? `[${pattern.category}]\n` : '';
        const cellCountText = pattern.cellCount ? `\nCélulas: ${pattern.cellCount}` : '';
        patternBtn.dataset.tooltip = `${categoryText}${pattern.description}${cellCountText}\n\nClic derecho para rotar 90°`;

        // Miniatura
        const thumbnail = document.createElement('div');
        thumbnail.className = 'pattern-thumb-horizontal';

        if (pattern.pattern === 'random') {
            thumbnail.innerHTML = '🎲';
            thumbnail.style.fontSize = '1.5rem';
            thumbnail.style.color = '#8b5cf6';
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = 40;
            canvas.height = 40;
            canvas.className = 'pattern-canvas-horizontal';
            const ctx = canvas.getContext('2d');
            renderPatternToCanvas(ctx, pattern.pattern, pattern.color);
            thumbnail.appendChild(canvas);
        }

        // Etiqueta
        const label = document.createElement('div');
        label.className = 'pattern-label-horizontal';
        label.textContent = pattern.name;

        // Añadir badge de tamaño celular
        if (pattern.cellCount && pattern.pattern !== 'random') {
            const sizeBadge = document.createElement('div');
            sizeBadge.className = 'pattern-size-badge';
            sizeBadge.textContent = pattern.cellCount;
            patternBtn.appendChild(sizeBadge);
        }

        patternBtn.appendChild(thumbnail);
        patternBtn.appendChild(label);

        // Clic izquierdo - seleccionar
        patternBtn.addEventListener('click', (e) => {
            if (e.button !== 0) return;

            e.preventDefault();
            e.stopPropagation();

            // Deseleccionar todos
            document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
                btn.classList.remove('active');
            });

            // Seleccionar este
            patternBtn.classList.add('active');

            // Resetear rotación al seleccionar nuevo patrón
            window.selectedPatternRotation = 0;
            window.selectedPatternKey = key;

            // Actualizar vista previa e información
            updatePatternInfo();

            // Disparar un evento personalizado para notificar el cambio
            document.dispatchEvent(new CustomEvent('patternSelected', {
                detail: {
                    patternKey: key,
                    pattern: PATTERNS[key]
                }
            }));
        });

        // Clic derecho - rotar
        patternBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Solo rotar si es el patrón seleccionado
            if (patternBtn.classList.contains('active') && pattern.pattern !== 'random') {
                window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;

                // Actualizar miniatura
                const canvas = thumbnail.querySelector('canvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, 40, 40);
                    const rotatedPattern = getPatternWithRotation(key, window.selectedPatternRotation);
                    renderPatternToCanvas(ctx, rotatedPattern.pattern, pattern.color);
                }

                // Actualizar info
                updatePatternInfo();
            }

            return false;
        });

        container.appendChild(patternBtn);
    });

    // Dejar que el usuario empiece dibujando libremente
    window.selectedPatternKey = null;
    window.selectedPattern = null;
    window.selectedPatternRotation = 0;

    // Actualizar la información del patrón para mostrar "Selecciona un patrón"
    updatePatternInfo();
}

function renderPatternToCanvas(ctx, patternData, color) {
    if (!patternData || patternData === 'random') return;

    // Fondo
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 40, 40);

    const rows = patternData.length;
    const cols = patternData[0].length;

    // Tamaño de celda
    const maxDim = Math.max(rows, cols);
    const cellSize = Math.min(30 / maxDim, 5);

    // Centrar
    const offsetX = (40 - cols * cellSize) / 2;
    const offsetY = (40 - rows * cellSize) / 2;

    // Color
    ctx.fillStyle = color || '#10b981';

    // Dibujar
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (patternData[row][col] === 1) {
                ctx.fillRect(
                    offsetX + col * cellSize,
                    offsetY + row * cellSize,
                    cellSize,
                    cellSize
                );
            }
        }
    }
}

function updatePatternInfo() {
    // Si no hay patrón seleccionado
    if (!window.selectedPatternKey) {
        const nameEl = document.getElementById('patternNameMini');
        const detailsEl = document.getElementById('patternDetailsMini');
        if (nameEl) nameEl.textContent = 'Selecciona un patrón';
        if (detailsEl) detailsEl.textContent = 'Clic en un patrón para seleccionarlo';
        window.selectedPattern = null;

        // Disparar evento de patrón de-seleccionado
        document.dispatchEvent(new CustomEvent('patternDeselected'));
        return;
    }

    // Si hay patrón seleccionado
    const pattern = getPatternWithRotation(window.selectedPatternKey, window.selectedPatternRotation);
    const nameEl = document.getElementById('patternNameMini');
    const detailsEl = document.getElementById('patternDetailsMini');

    if (nameEl && detailsEl && pattern) {
        const originalPattern = PATTERNS[window.selectedPatternKey];
        const rotationText = window.selectedPatternRotation > 0 ? ` (${window.selectedPatternRotation}°)` : '';
        nameEl.textContent = `${pattern.name}${rotationText}`;

        const categoryText = originalPattern.category ? `Categoría: ${originalPattern.category}` : '';
        const cellCountText = originalPattern.cellCount ? ` | Células: ${originalPattern.cellCount}` : '';
        detailsEl.textContent = `${categoryText}${cellCountText}`;
    }

    // Actualizar patrón seleccionado globalmente
    window.selectedPattern = pattern;

    // Disparar evento de patrón actualizado
    document.dispatchEvent(new CustomEvent('patternUpdated', {
        detail: {pattern: pattern}
    }));
}

function showPatternPreview(x, y) {
    const preview = document.getElementById('patternPreview');
    const pattern = window.selectedPattern;

    if (!pattern || !pattern.pattern || pattern.pattern === 'random') {
        preview.style.display = 'none';
        return;
    }

    if (!automaton) return;

    const canvas = document.getElementById('canvas');
    const container = document.getElementById('canvas-container');
    const cellSize = automaton.cellSize;

    // Obtener dimensiones reales del contenedor (sin padding)
    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    // Calcular offset del canvas dentro del contenedor
    const offsetX = canvasRect.left - containerRect.left;
    const offsetY = canvasRect.top - containerRect.top;

    const patternData = pattern.pattern;
    const patternOffsetX = Math.floor(patternData[0].length / 2);
    const patternOffsetY = Math.floor(patternData.length / 2);

    preview.innerHTML = '';
    preview.style.position = 'absolute';
    preview.style.left = offsetX + 'px';
    preview.style.top = offsetY + 'px';
    preview.style.width = canvasRect.width + 'px';
    preview.style.height = canvasRect.height + 'px';
    preview.style.display = 'block';
    preview.style.pointerEvents = 'none';
    preview.style.zIndex = '3';

    // Calcular escala del canvas
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;

    for (let row = 0; row < patternData.length; row++) {
        for (let col = 0; col < patternData[row].length; col++) {
            if (patternData[row][col] === 1) {
                const gridX = x - patternOffsetX + col;
                const gridY = y - patternOffsetY + row;

                // Solo mostrar celdas dentro del grid
                if (gridX >= 0 && gridX < automaton.gridSize &&
                    gridY >= 0 && gridY < automaton.gridSize) {

                    const cell = document.createElement('div');
                    cell.className = 'pattern-preview-cell';
                    cell.style.position = 'absolute';
                    // Aplicar escala CSS inversa para posicionamiento correcto
                    cell.style.left = (gridX * cellSize / scaleX) + 'px';
                    cell.style.top = (gridY * cellSize / scaleY) + 'px';
                    cell.style.width = (cellSize / scaleX) + 'px';
                    cell.style.height = (cellSize / scaleY) + 'px';
                    cell.style.borderRadius = '2px';

                    preview.appendChild(cell);
                }
            }
        }
    }
}

function hidePatternPreview() {
    const preview = document.getElementById('patternPreview');
    preview.innerHTML = '';
    preview.style.display = 'none';
}

function showInfluenceArea(x, y) {
    const influenceDiv = document.getElementById('influenceArea');
    if (!influenceDiv || !automaton) return;

    influenceDiv.innerHTML = '';
    influenceDiv.style.display = 'block';

    const canvas = document.getElementById('canvas');
    const container = document.getElementById('canvas-container');
    const cellSize = automaton.cellSize;
    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const offsetX = canvasRect.left - containerRect.left;
    const offsetY = canvasRect.top - containerRect.top;
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;

    influenceDiv.style.position = 'absolute';
    influenceDiv.style.left = offsetX + 'px';
    influenceDiv.style.top = offsetY + 'px';
    influenceDiv.style.width = canvasRect.width + 'px';
    influenceDiv.style.height = canvasRect.height + 'px';

    const radius = automaton.neighborhoodRadius;
    const type = automaton.neighborhoodType;

    // Función para calcular vecindad de una celda
    function getNeighborhood(cx, cy) {
        const neighbors = [];
        for (let i = -radius; i <= radius; i++) {
            for (let j = -radius; j <= radius; j++) {
                if (i === 0 && j === 0) continue;

                if (type === 'moore' ||
                    (type === 'neumann' && Math.abs(i) + Math.abs(j) <= radius)) {

                    const nx = cx + i;
                    const ny = cy + j;

                    if (nx >= 0 && nx < automaton.gridSize &&
                        ny >= 0 && ny < automaton.gridSize) {
                        neighbors.push({x: nx, y: ny});
                    }
                }
            }
        }
        return neighbors;
    }

    // Para una sola celda
    if (!window.selectedPattern || !window.selectedPattern.pattern || window.selectedPattern.pattern === 'random') {
        const neighbors = getNeighborhood(x, y);
        neighbors.forEach(neighbor => {
            const cell = document.createElement('div');
            cell.className = `influence-cell ${type} radius-${radius}`;
            cell.style.position = 'absolute';
            cell.style.left = (neighbor.x * cellSize / scaleX) + 'px';
            cell.style.top = (neighbor.y * cellSize / scaleY) + 'px';
            cell.style.width = (cellSize / scaleX) + 'px';
            cell.style.height = (cellSize / scaleY) + 'px';
            influenceDiv.appendChild(cell);
        });
    } else {
        // Para un patrón
        const pattern = window.selectedPattern.pattern;
        const patternOffsetX = Math.floor(pattern[0].length / 2);
        const patternOffsetY = Math.floor(pattern.length / 2);

        // Crear un mapa de las celdas del patrón
        const patternMap = new Set();
        const patternCells = [];

        for (let row = 0; row < pattern.length; row++) {
            for (let col = 0; col < pattern[row].length; col++) {
                if (pattern[row][col] === 1) {
                    const gridX = x - patternOffsetX + col;
                    const gridY = y - patternOffsetY + row;

                    if (gridX >= 0 && gridX < automaton.gridSize &&
                        gridY >= 0 && gridY < automaton.gridSize) {
                        patternCells.push({x: gridX, y: gridY});
                        patternMap.add(`${gridX},${gridY}`);
                    }
                }
            }
        }

        // Calcular vecindad total (sin duplicados y excluyendo celdas del patrón)
        const influenceMap = new Set();

        patternCells.forEach(cell => {
            const neighbors = getNeighborhood(cell.x, cell.y);
            neighbors.forEach(neighbor => {
                const key = `${neighbor.x},${neighbor.y}`;
                if (!patternMap.has(key)) {
                    influenceMap.add(key);
                }
            });
        });

        // Dibujar área de influencia
        influenceMap.forEach(key => {
            const [gridX, gridY] = key.split(',').map(Number);
            const cell = document.createElement('div');
            cell.className = `influence-cell ${type} radius-${radius}`;
            cell.style.position = 'absolute';
            cell.style.left = (gridX * cellSize / scaleX) + 'px';
            cell.style.top = (gridY * cellSize / scaleY) + 'px';
            cell.style.width = (cellSize / scaleX) + 'px';
            cell.style.height = (cellSize / scaleY) + 'px';
            influenceDiv.appendChild(cell);
        });

        // Dibujar borde del área de influencia
        if (influenceMap.size > 0 || patternCells.length > 0) {
            // Calcular área total (patrón + influencia)
            const allCells = [
                ...patternCells,
                ...Array.from(influenceMap).map(key => {
                    const [x, y] = key.split(',').map(Number);
                    return {x, y};
                })
            ];

            if (allCells.length > 0) {
                let minX = Math.min(...allCells.map(c => c.x));
                let minY = Math.min(...allCells.map(c => c.y));
                let maxX = Math.max(...allCells.map(c => c.x));
                let maxY = Math.max(...allCells.map(c => c.y));

                const borderDiv = document.createElement('div');
                borderDiv.className = 'influence-border';
                borderDiv.style.position = 'absolute';
                borderDiv.style.left = (minX * cellSize / scaleX - 1) + 'px';
                borderDiv.style.top = (minY * cellSize / scaleY - 1) + 'px';
                borderDiv.style.width = ((maxX - minX + 1) * cellSize / scaleX + 2) + 'px';
                borderDiv.style.height = ((maxY - minY + 1) * cellSize / scaleY + 2) + 'px';
                borderDiv.style.border = '1px dashed rgba(59, 130, 246, 0.5)';
                influenceDiv.appendChild(borderDiv);
            }
        }
    }
}

function hideInfluenceArea() {
    const influenceDiv = document.getElementById('influenceArea');
    if (influenceDiv) {
        influenceDiv.innerHTML = '';
        influenceDiv.style.display = 'none';
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', renderPatterns);

// Exportar funciones
window.getPatternWithRotation = getPatternWithRotation;

// Función para colocar un patrón en la cuadrícula
function placePattern(grid, pattern, centerX, centerY) {
    if (!pattern || !pattern.pattern) return grid;

    const newGrid = [...grid.map(row => [...row])];
    const patternData = pattern.pattern;

    if (patternData === 'random') {
        // Manejar patrón aleatorio
        for (let x = 0; x < grid.length; x++) {
            for (let y = 0; y < grid[0].length; y++) {
                newGrid[x][y] = Math.random() < 0.3;
            }
        }
        return newGrid;
    }

    // Calcular desplazamiento para centrar
    const offsetX = Math.floor(patternData[0].length / 2);
    const offsetY = Math.floor(patternData.length / 2);

    console.log(`Placing pattern at ${centerX},${centerY} with offset ${offsetX},${offsetY}`);

    // Colocar cada célula del patrón
    for (let row = 0; row < patternData.length; row++) {
        for (let col = 0; col < patternData[row].length; col++) {
            if (patternData[row][col] === 1) {
                const gridX = centerX - offsetX + col;
                const gridY = centerY - offsetY + row;

                // Verificar que esté dentro de los límites
                if (gridX >= 0 && gridX < newGrid.length &&
                    gridY >= 0 && gridY < newGrid[0].length) {
                    newGrid[gridX][gridY] = true;
                }
            }
        }
    }

    return newGrid;
}

// Llamar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPatterns);
} else {
    renderPatterns();
}

// Exportar funciones
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {PATTERNS, renderPatterns, placePattern, showPatternPreview};
}