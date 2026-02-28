/**
 * RLECodec - Encoder/decoder del formato RLE (Run-Length Encoding)
 *
 * Formato estándar compatible con Golly, LifeWiki y la mayoría de
 * herramientas del ecosistema Life.
 *
 * Estructura de un archivo RLE:
 *   # Líneas de comentario (opcionales)
 *   #N Nombre del patrón
 *   #O Autor
 *   #C Comentario
 *   x = <width>, y = <height>[, rule = <rulestring>]
 *   <datos codificados>!
 *
 * Datos: secuencias de [<count>]<tag> donde:
 *   b = celda muerta
 *   o = celda viva
 *   $ = fin de fila
 *   ! = fin del patrón
 *   count omitido = 1
 */
class RLECodec {

    // =========================================
    // ENCODE
    // =========================================

    /**
     * Detecta si un string es RLE o JSON.
     * @param {string} text
     * @returns {'rle'|'json'|'unknown'}
     */
    static detectFormat(text) {
        const trimmed = text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
        if (trimmed.startsWith('#') || /^x\s*=/im.test(trimmed)) return 'rle';
        // Intento heurístico: si contiene 'o' o 'b' y '!' probablemente es RLE
        if (/[ob$]/.test(trimmed) && trimmed.includes('!')) return 'rle';
        return 'unknown';
    }

    /**
     * Codifica un patrón al formato RLE.
     * @param {Object} patternData - {pattern, name, description, rule}
     *   pattern: number[][] — filas de 0/1
     *   name: string (opcional)
     *   description: string (opcional)
     *   rule: string (opcional, ej. "B3/S23")
     * @returns {string} Texto RLE completo listo para guardar como .rle
     */
    encode(patternData) {
        const {pattern, name, description, rule} = patternData;
        if (!pattern || pattern.length === 0) return '';

        const height = pattern.length;
        const width = pattern[0].length;
        const rulePart = rule || 'B3/S23';

        const lines = [];

        if (name) lines.push(`#N ${name}`);
        if (description) lines.push(`#C ${description}`);

        lines.push(`x = ${width}, y = ${height}, rule = ${rulePart}`);
        lines.push(this._encodeBody(pattern));

        return lines.join('\n');
    }

    _encodeBody(pattern) {
        const height = pattern.length;
        const runs = [];

        for (let row = 0; row < height; row++) {
            const rowData = pattern[row];
            const width = rowData.length;

            let col = 0;
            while (col < width) {
                const cell = rowData[col] ? 1 : 0;
                let count = 1;
                while (col + count < width && (rowData[col + count] ? 1 : 0) === cell) {
                    count++;
                }
                // Celdas muertas al final de la fila se omiten
                if (cell === 1 || col + count < width) {
                    runs.push((count > 1 ? count : '') + (cell ? 'o' : 'b'));
                }
                col += count;
            }

            if (row < height - 1) runs.push('$');
        }

        runs.push('!');

        // Limitar líneas a 70 caracteres (convención del formato)
        return this._wrapLines(runs.join(''), 70);
    }

    // =========================================
    // DECODE
    // =========================================

    _wrapLines(body, maxLen) {
        const result = [];
        let i = 0;
        while (i < body.length) {
            result.push(body.slice(i, i + maxLen));
            i += maxLen;
        }
        return result.join('\n');
    }

    /**
     * Decodifica un string RLE al formato interno de patrón.
     * @param {string} rleText - Contenido del archivo .rle
     * @returns {Object} {pattern, name, description, rule, width, height}
     *   pattern: number[][] — filas de 0/1
     * @throws {Error} Si el formato es inválido
     */
    decode(rleText) {
        const lines = rleText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        let name = null;
        let description = null;
        let width = 0;
        let height = 0;
        let rule = null;
        let headerFound = false;
        let bodyLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('#N')) {
                name = trimmed.slice(2).trim() || null;
            } else if (trimmed.startsWith('#C') || trimmed.startsWith('#c')) {
                description = trimmed.slice(2).trim() || null;
            } else if (trimmed.startsWith('#')) {
                // Otros comentarios ignorados (#O autor, #P coords, etc.)
            } else if (!headerFound && trimmed.startsWith('x')) {
                // Línea de cabecera: x = w, y = h[, rule = ...]
                const xMatch = trimmed.match(/x\s*=\s*(\d+)/i);
                const yMatch = trimmed.match(/y\s*=\s*(\d+)/i);
                const ruleMatch = trimmed.match(/rule\s*=\s*([^\s,]+)/i);

                if (!xMatch || !yMatch) throw new Error('Cabecera RLE inválida: faltan x o y');

                width = parseInt(xMatch[1]);
                height = parseInt(yMatch[1]);
                rule = ruleMatch ? ruleMatch[1] : 'B3/S23';
                headerFound = true;
            } else if (headerFound) {
                bodyLines.push(trimmed);
                if (trimmed.includes('!')) break;
            }
        }

        if (!headerFound) throw new Error('Cabecera RLE no encontrada');

        const body = bodyLines.join('').split('!')[0];
        const pattern = this._decodeBody(body, width, height);

        return {pattern, name, description, rule, width, height};
    }

    // =========================================
    // DETECCIÓN DE FORMATO
    // =========================================

    _decodeBody(body, width, height) {
        // Inicializar grid con ceros
        const pattern = Array.from({length: height}, () => new Array(width).fill(0));

        let row = 0;
        let col = 0;
        let countStr = '';

        for (let i = 0; i < body.length; i++) {
            const ch = body[i];

            if (ch >= '0' && ch <= '9') {
                countStr += ch;
                continue;
            }

            const count = countStr ? parseInt(countStr) : 1;
            countStr = '';

            if (ch === 'b' || ch === '.') {
                // Celdas muertas — solo avanzar columna
                col += count;
            } else if (ch === 'o' || ch === 'O') {
                // Celdas vivas
                for (let k = 0; k < count; k++) {
                    if (row < height && col < width) {
                        pattern[row][col] = 1;
                    }
                    col++;
                }
            } else if (ch === '$') {
                // Fin de fila(s)
                row += count;
                col = 0;
            } else if (ch === '!') {
                break;
            }
            // Cualquier otro carácter (espacios, etc.) se ignora
        }

        return pattern;
    }
}

window.RLECodec = RLECodec;