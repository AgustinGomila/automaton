/**
 * MCLCodec - Encoder/decoder del formato MCL (MCell Cellular Automata)
 *
 * Formato ASCII introducido en MCLife 1.20, continuado en MCell for Windows
 * y MCell for Web. Especialmente usado para WireWorld.
 *
 * Estructura de un archivo MCL:
 *   #MCell 4.20         — versión (obligatorio)
 *   #GAME WireWorld     — familia CA
 *   #RULE ...           — regla (opcional en WireWorld)
 *   #SPEED n            — velocidad 0..5000
 *   #BOARD NNNxMMM      — tamaño del tablero
 *   #CCOLORS n          — número de estados (WireWorld = 4)
 *   #WRAP 0|1           — bordes toroidales
 *   #D texto            — líneas de descripción (ilimitadas)
 *   #L <datos>          — líneas de datos en RLE extendido
 *
 * Codificación de datos (#L) — RLE extendido:
 *   .  → estado 0 (Empty)
 *   A  → estado 1 (Electron Head)
 *   B  → estado 2 (Electron Tail)
 *   C  → estado 3 (Conductor)
 *   $  → salto de línea en el patrón
 *   nX → n repeticiones de X
 *
 * Mapeo WireWorld:
 *   0 (Empty)         → '.'
 *   1 (Electron Head) → 'A'
 *   2 (Electron Tail) → 'B'
 *   3 (Conductor)     → 'C'
 */
class MCLCodec {

    // Mapeo estado numérico → char MCL (estados 0..3 de WireWorld)
    static STATE_TO_CHAR = ['.', 'A', 'B', 'C'];

    // Mapeo char MCL → estado numérico
    static CHAR_TO_STATE = {
        '.': 0,
        'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6,
        'G': 7, 'H': 8, 'I': 9, 'J': 10, 'K': 11, 'L': 12,
        'M': 13, 'N': 14, 'O': 15, 'P': 16, 'Q': 17, 'R': 18,
        'S': 19, 'T': 20, 'U': 21, 'V': 22, 'W': 23, 'X': 24
    };

    // =========================================
    // DETECCIÓN
    // =========================================

    /**
     * Detecta si un string es formato MCL.
     * @param {string} text
     * @returns {boolean}
     */
    static isFormat(text) {
        return text.trimStart().startsWith('#MCell') ||
            text.trimStart().startsWith('#MCELL');
    }

    // =========================================
    // ENCODE
    // =========================================

    /**
     * Codifica un grid de estados WireWorld al formato MCL.
     *
     * @param {Object}     options
     * @param {number[][]} options.stateGrid    — grid [x][y] con estados 0..3
     *   (columna-mayor, igual que wireworldEngine.stateGrid)
     * @param {number}     options.gridWidth    — ancho del grid
     * @param {number}     options.gridHeight   — alto del grid
     * @param {string}     [options.name]       — nombre del patrón
     * @param {string}     [options.description] — descripción
     * @param {boolean}    [options.wrap]       — bordes toroidales
     * @returns {string} Texto MCL completo
     */
    encode({stateGrid, gridWidth, gridHeight, name, description, wrap = false}) {
        // Calcular bounding box de celdas no vacías
        const bounds = this._boundingBox(stateGrid, gridWidth, gridHeight);
        if (!bounds) return ''; // grid vacío

        const {minX, minY, maxX, maxY} = bounds;
        const width = maxX - minX + 1;
        const height = maxY - minY + 1;

        const lines = [];

        lines.push('#MCell 4.20');
        lines.push('#GAME WireWorld');
        lines.push('#CCOLORS 4');
        lines.push(`#BOARD ${gridWidth}x${gridHeight}`);
        lines.push(`#WRAP ${wrap ? 1 : 0}`);

        if (name) lines.push(`#D ${name}`);
        if (description) lines.push(`#D ${description}`);

        // Construir filas de datos (grid es columna-mayor: stateGrid[x][y])
        const rows = [];
        for (let y = minY; y <= maxY; y++) {
            const row = [];
            for (let x = minX; x <= maxX; x++) {
                row.push(stateGrid[x]?.[y] ?? 0);
            }
            rows.push(row);
        }

        // Codificar en RLE extendido y emitir líneas #L
        const encoded = this._encodeRows(rows, width);
        const wrapped = this._wrapLines(encoded, 68); // máx 70 chars con '#L '
        for (const segment of wrapped) {
            lines.push(`#L ${segment}`);
        }

        return lines.join('\n');
    }

    /**
     * Calcula el bounding box de celdas con estado > 0 (no vacías).
     * @private
     */
    _boundingBox(stateGrid, gridWidth, gridHeight) {
        let minX = gridWidth, minY = gridHeight, maxX = -1, maxY = -1;
        for (let x = 0; x < gridWidth; x++) {
            for (let y = 0; y < gridHeight; y++) {
                if ((stateGrid[x]?.[y] ?? 0) > 0) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return null;
        return {minX, minY, maxX, maxY};
    }

    /**
     * Codifica filas de estados en RLE extendido MCL.
     * Trailing dots (vacíos al final de fila) se omiten.
     * @private
     */
    _encodeRows(rows, width) {
        const runs = [];

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];

            // Encontrar último estado no-vacío en la fila
            let lastNonEmpty = -1;
            for (let c = width - 1; c >= 0; c--) {
                if (row[c] !== 0) {
                    lastNonEmpty = c;
                    break;
                }
            }

            let c = 0;
            while (c <= lastNonEmpty) {
                const state = row[c];
                let count = 1;
                while (c + count <= lastNonEmpty && row[c + count] === state) {
                    count++;
                }
                const ch = MCLCodec.STATE_TO_CHAR[state] ?? '.';
                runs.push((count > 1 ? String(count) : '') + ch);
                c += count;
            }

            // Salto de fila (omitir el último)
            if (r < rows.length - 1) {
                runs.push('$');
            }
        }

        return runs.join('');
    }

    /**
     * Divide el cuerpo codificado en segmentos de maxLen caracteres.
     * Respeta los tokens RLE (no corta en medio de un número).
     * @private
     */
    _wrapLines(body, maxLen) {
        const segments = [];
        let i = 0;
        while (i < body.length) {
            segments.push(body.slice(i, i + maxLen));
            i += maxLen;
        }
        return segments.length ? segments : [''];
    }

    // =========================================
    // DECODE
    // =========================================

    /**
     * Decodifica un archivo MCL.
     *
     * @param {string} mclText — contenido del archivo .mcl
     * @returns {Object} {
     *   stateGrid,   — number[][] [x][y], columna-mayor, estados 0..3
     *   width,       — ancho del patrón (columnas)
     *   height,      — alto del patrón (filas)
     *   game,        — cadena #GAME (ej. 'WireWorld')
     *   name,        — primer #D o null
     *   description, — #D concatenados (todos)
     *   wrap,        — boolean
     *   board        — {width, height} del #BOARD o null
     * }
     * @throws {Error} Si el formato es inválido o no hay datos #L
     */
    decode(mclText) {
        const lines = mclText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        let game = 'WireWorld';
        let wrap = false;
        let board = null;
        const descLines = [];
        const dataLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.toUpperCase().startsWith('#MCELL')) {
                // versión — ignorar valor
            } else if (trimmed.toUpperCase().startsWith('#GAME')) {
                game = trimmed.slice(5).trim();
            } else if (trimmed.toUpperCase().startsWith('#WRAP')) {
                wrap = trimmed.slice(5).trim() === '1';
            } else if (trimmed.toUpperCase().startsWith('#BOARD')) {
                const m = trimmed.slice(6).trim().match(/^(\d+)x(\d+)/i);
                if (m) board = {width: parseInt(m[1]), height: parseInt(m[2])};
            } else if (trimmed.toUpperCase().startsWith('#D')) {
                descLines.push(trimmed.slice(2).trim());
            } else if (trimmed.toUpperCase().startsWith('#L')) {
                dataLines.push(trimmed.slice(2).trim());
            }
            // #RULE, #SPEED, #CCOLORS, #COLORING, #PALETTE, #DIV — ignorados
        }

        if (dataLines.length === 0) {
            throw new Error('MCL: no se encontraron líneas de datos (#L)');
        }

        const body = dataLines.join('');
        const {rows, width, height} = this._decodeBody(body);

        // Convertir filas (row-major: rows[y][x]) → stateGrid[x][y] (columna-mayor)
        const stateGrid = Array.from({length: width}, (_, x) =>
            new Uint8Array(height).map((_, y) => rows[y]?.[x] ?? 0)
        );

        return {
            stateGrid,
            width,
            height,
            game,
            name: descLines[0] || null,
            description: descLines.join(' ') || null,
            wrap,
            board
        };
    }

    /**
     * Decodifica el cuerpo RLE extendido MCL.
     * Devuelve rows[y][x] (row-major) y dimensiones.
     * @private
     */
    _decodeBody(body) {
        // Prefijos de estado extendido (estados > 24): 'a'=+24, 'b'=+48, ...
        const PREFIX_OFFSET = {
            a: 24, b: 48, c: 72, d: 96, e: 120,
            f: 144, g: 168, h: 192, i: 216, j: 240
        };

        const rows = [[]];
        let countStr = '';
        let i = 0;

        while (i < body.length) {
            const ch = body[i];

            // Dígito: acumular contador
            if (ch >= '0' && ch <= '9') {
                countStr += ch;
                i++;
                continue;
            }

            const count = countStr ? parseInt(countStr) : 1;
            countStr = '';

            // Prefijo de estado extendido (minúscula a..j)
            if (ch >= 'a' && ch <= 'j' && i + 1 < body.length) {
                const nextCh = body[i + 1];
                const base = PREFIX_OFFSET[ch] ?? 0;
                const state = base + (MCLCodec.CHAR_TO_STATE[nextCh] ?? 0);
                const curRow = rows[rows.length - 1];
                for (let k = 0; k < count; k++) curRow.push(state);
                i += 2;
                continue;
            }

            if (ch === '$') {
                // Salto de fila: count filas vacías intermedias
                for (let k = 0; k < count; k++) rows.push([]);
                i++;
                continue;
            }

            if (ch === '.') {
                // Estado 0 (vacío)
                const curRow = rows[rows.length - 1];
                for (let k = 0; k < count; k++) curRow.push(0);
                i++;
                continue;
            }

            if (ch >= 'A' && ch <= 'X') {
                const state = MCLCodec.CHAR_TO_STATE[ch] ?? 0;
                const curRow = rows[rows.length - 1];
                for (let k = 0; k < count; k++) curRow.push(state);
                i++;
                continue;
            }

            // Cualquier otro carácter (espacios, etc.) se ignora
            i++;
        }

        // Eliminar fila vacía final si existe
        if (rows[rows.length - 1].length === 0) rows.pop();

        // Calcular dimensiones reales
        const height = rows.length;
        const width = rows.reduce((max, row) => Math.max(max, row.length), 0);

        // Normalizar todas las filas al mismo ancho (rellenar con 0)
        for (const row of rows) {
            while (row.length < width) row.push(0);
        }

        return {rows, width, height};
    }
}

export {MCLCodec};