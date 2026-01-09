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

        // Si es solo números sin separadores (ej.: "37")
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

// Exportar funciones (no exportar RULES aquí)
window.parseRuleString = parseRuleString;
window.parseCustomRule = parseCustomRule;