/**
 * scripts/config/rules.js
 *
 * Utilidades de parseo y comparación de reglas B/S.
 * Sin dependencias externas — importable desde cualquier módulo.
 */

/**
 * Parsea una cadena canónica "B{digits}/S{digits}" en arrays de números.
 * @param   {string} ruleString — ej. "B3/S23"
 * @returns {{ survival: number[], birth: number[] }}
 */
function parseRuleString(ruleString) {
    // Normalizar a mayúsculas para aceptar "b3/s23" igual que "B3/S23"
    const parts = ruleString.toUpperCase().split('/');
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

/**
 * Parsea los campos de regla personalizada del formulario.
 * Acepta dígitos separados por comas, espacios o sin separador.
 * @param   {string} birthStr
 * @param   {string} survivalStr
 * @returns {{ survival: number[], birth: number[] }}
 * @throws  {Error} si los campos no tienen contenido válido
 */
function parseCustomRule(birthStr, survivalStr) {
    if (!birthStr && !survivalStr) {
        throw new Error('Al menos uno de los campos debe contener valores');
    }

    const isValid = str => /^[\d,\s]*$/.test(str);
    if (!isValid(birthStr) || !isValid(survivalStr)) {
        throw new Error('Solo se permiten números, comas y espacios');
    }

    function parseNumbers(str) {
        if (!str) return [];
        if (/^\d+$/.test(str)) return str.split('').map(Number);
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

/**
 * Genera una clave de ordenación lexicográfica para una regla.
 * @param   {number[]} birth
 * @param   {number[]} survival
 * @returns {string} — formato "B{key}|S{key}"
 */
function getLexicographicSortKey(birth, survival) {
    const bKey = (birth || []).slice().sort((a, b) => a - b).join('');
    const sKey = (survival || []).slice().sort((a, b) => a - b).join('');
    return `B${bKey}|S${sKey}`;
}

/**
 * Compara dos reglas lexicográficamente.
 * @param   {{ birth: number[], survival: number[] }} ruleA
 * @param   {{ birth: number[], survival: number[] }} ruleB
 * @returns {number} — negativo si A < B, 0 si iguales, positivo si A > B
 */
function compareRulesLexicographically(ruleA, ruleB) {
    const keyA = getLexicographicSortKey(ruleA.birth, ruleA.survival);
    const keyB = getLexicographicSortKey(ruleB.birth, ruleB.survival);
    return keyA.localeCompare(keyB);
}

export {
    parseRuleString,
    parseCustomRule,
    getLexicographicSortKey,
    compareRulesLexicographically
};