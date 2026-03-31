/**
 * wasm-renderer.js — Módulo WASM para el hot-path de renderizado de celdas.
 *
 * Compila y gestiona el módulo WebAssembly que implementa fill_full y fill_dirty.
 * La memoria WASM es compartida con el ImageData del GridRenderer (zero-copy):
 *   - El pixel buffer vive en memoria WASM → ImageData lo lee directamente
 *   - El grid plano y los buffers de actividad también viven en memoria WASM
 *   - El único dato que se copia es el grid column-major → flat Uint8Array
 *     via Uint8Array.set() (operación nativa, ~0.5ms para 1M celdas)
 *
 * Activación:
 *   Solo activo cuando !colorProvider (Conway, Wolfram, Ulam-Warburton,
 *   Generations). Para Langton/WireWorld/RD2D, el colorProvider requiere
 *   llamadas JS → se usa el path JS del GridRenderer.
 *
 * Fallback:
 *   Si WebAssembly no está disponible o la instanciación falla,
 *   WasmRenderer.available === false y GridRenderer usa el path JS.
 *
 * === FUENTE WAT ===
 * El módulo .wasm está embebido como base64. La fuente WAT está en
 * scripts/rendering/grid-fill.wat en el repositorio del proyecto.
 */
class WasmRenderer {

    // Base64 del módulo compilado (grid-fill.wasm — 766 bytes)
    static WASM_BASE64 =
        'AGFzbQEAAAABJAJgDX9/f39/f39/f39/f38AYA9/f39/f39/f39/f39/' +
        'f38BfgIPAQNlbnYGbWVtb3J5AgABAwMCAAEHGgIJZmlsbF9mdWxsAAAK' +
        'ZmlsbF9kaXJ0eQABCpsFArwCAQ1/IAAgAmwhECAQIAEgAmxsIRFBACEX' +
        'AkADQCAXIBFPDQEgCSAXQQJ0aiADNgIAIBdBAWohFwwACwtBACENAkAD' +
        'QCANIABPDQEgDSACbCEVQQAhDgJAA0AgDiABTw0BIA0gAWwgDmohDyAK' +
        'IA9qLQAAIRIgB0UEQCASBEAgBCEUBSADIRQLBSASBEAgCyAPai0AACETIBMg' +
        'CEkEQCAFIRQFIAQhFAsFIAwgD2otAAAhEyATIAhJBEAgBiEUBSADIRQL' +
        'CwsgFCADRwRAIA4gAmwhFkEAIRcCQANAIBcgAk8NAUEAIRgCQANAIBgg' +
        'Ak8NASAJIBYgF2ogEGwgFSAYampBAnRqIRkgGSAUNgIAIBhBAWohGAwA' +
        'CwsgF0EBaiEXDAALCwsgDkEBaiEODAALCyANQQFqIQ0MAAsLC9oCARF/' +
        'IAQgA2whE0H/////ByEcQf////8HIR1BACEeQQAhH0EAIQ8CQANAIA8g' +
        'AU8NASAAIA9BAnRqKAIAIRAgECACbiERIBAgAnAhEiAMIBBqLQAAIRQg' +
        'CUUEQCAUBEAgBiEWBSAFIRYLBSAUBEAgDSAQai0AACEVIBUgCkkEQCAH' +
        'IRYFIAYhFgsFIA4gEGotAAAhFSAVIApJBEAgCCEWBSAFIRYLCwsgESAD' +
        'bCEXIBIgA2whGEEAIRkCQANAIBkgA08NAUEAIRoCQANAIBogA08NASALIBgg' +
        'GWogE2wgFyAaampBAnRqIRsgGyAWNgIAIBpBAWohGgwACwsgGUEBaiEZDAAL' +
        'CyARIBxJBEAgESEcCyARIB5LBEAgESEeCyASIB1JBEAgEiEdCyASIB9L' +
        'BEAgEiEfCyAPQQFqIQ8MAAsLIB+tQhCGIB6thEIghiAdrUIQhiAcrYSECw==';

    /**
     * @param {number} gridWidth
     * @param {number} gridHeight
     * @param {number} cellSize   — 1..PIXEL_PATH_MAX_CELL_SIZE
     */
    constructor(gridWidth, gridHeight, cellSize) {
        this.available = false;
        this._instance = null;
        this._memory = null;

        // Offsets en la memoria WASM (bytes)
        this.pixBase = 0;
        this.gridBase = 0;
        this.actBase = 0;
        this.dyBase = 0;
        this.dirtyBase = 0;

        // Vistas sobre la memoria WASM
        this._pixBuf32 = null;   // Uint32Array  — pixel buffer (compartido con ImageData)
        this._gridFlat = null;   // Uint8Array   — grid plano column-major
        this._actAges = null;   // Uint8Array   — activity ages
        this._dyAges = null;   // Uint8Array   — dying ages
        this._dirtyArr = null;   // Uint32Array  — dirty indices (pre-allocated)
        this._imageData = null;   // ImageData    — vista sobre pixBuf (zero-copy)

        this._gw = gridWidth;
        this._gh = gridHeight;
        this._cs = cellSize;

        // Instanciación síncrona si el browser la soporta, async si no
        this._init();
    }

    // =========================================================================
    // INICIALIZACIÓN
    // =========================================================================

    /** ImageData sobre el pixel buffer WASM (zero-copy para putImageData). */
    get imageData() {
        return this._imageData;
    }

    /** Uint32Array sobre el pixel buffer (para lectura directa si necesario). */
    get pixelBuf32() {
        return this._pixBuf32;
    }

    _init() {
        try {
            if (typeof WebAssembly === 'undefined') return;

            const {gw, gh, cs, pixBytes, gBytes, maxDirty, totalBytes, pages} =
                this._calcLayout(this._gw, this._gh, this._cs);

            this._memory = new WebAssembly.Memory({initial: pages, maximum: pages + 4});
            this._applyLayout(gw, gh, cs, pixBytes, gBytes, maxDirty);

            const wasmBytes = this._decodeBase64(WasmRenderer.WASM_BASE64);

            // Compilación síncrona (soportada en workers y en main thread moderno)
            const module = new WebAssembly.Module(wasmBytes);
            this._instance = new WebAssembly.Instance(module, {
                env: {memory: this._memory}
            });

            this.available = true;
        } catch (e) {
            // Fallback silencioso: GridRenderer usará el path JS
            console.debug('[WasmRenderer] No disponible:', e.message);
            this.available = false;
        }
    }

    // =========================================================================
    // API PÚBLICA
    // =========================================================================

    /**
     * Calcula el layout de memoria para las dimensiones y cellSize dados.
     * @private
     */
    _calcLayout(gw, gh, cs) {
        const cw = gw * cs;
        const ch = gh * cs;
        const pixBytes = cw * ch * 4;
        const gBytes = gw * gh;
        const maxDirty = gBytes;            // worst case: todas las celdas sucias
        // Layout: [pixels | grid | actAges | dyAges | dirtyBuf]
        const totalBytes = pixBytes + gBytes * 3 + maxDirty * 4 + 64;
        const pages = Math.ceil(totalBytes / 65536) + 1;
        return {gw, gh, cs, cw, ch, pixBytes, gBytes, maxDirty, totalBytes, pages};
    }

    /**
     * Establece los offsets y crea las vistas TypedArray sobre la memoria WASM.
     * @private
     */
    _applyLayout(gw, gh, cs, pixBytes, gBytes, maxDirty) {
        this.pixBase = 0;
        this.gridBase = pixBytes;
        this.actBase = pixBytes + gBytes;
        this.dyBase = pixBytes + gBytes * 2;
        this.dirtyBase = pixBytes + gBytes * 3;

        const buf = this._memory.buffer;
        const cw = gw * cs;
        const ch = gh * cs;

        this._pixBuf32 = new Uint32Array(buf, this.pixBase, cw * ch);
        this._gridFlat = new Uint8Array(buf, this.gridBase, gBytes);
        this._actAges = new Uint8Array(buf, this.actBase, gBytes);
        this._dyAges = new Uint8Array(buf, this.dyBase, gBytes);
        this._dirtyArr = new Uint32Array(buf, this.dirtyBase, maxDirty);

        // ImageData apunta al pixel buffer — zero-copy con putImageData
        const clampedView = new Uint8ClampedArray(buf, this.pixBase, cw * ch * 4);
        this._imageData = new ImageData(clampedView, cw, ch);
    }

    /**
     * Vuelve a inicializar para nuevas dimensiones.
     * @param {number} gridWidth
     * @param {number} gridHeight
     * @param {number} cellSize
     */
    reinit(gridWidth, gridHeight, cellSize) {
        this._gw = gridWidth;
        this._gh = gridHeight;
        this._cs = cellSize;
        this._instance = null;
        this._memory = null;
        this.available = false;
        this._init();
    }

    /**
     * Sincroniza el grid column-major (Array<Uint8Array>) en memoria WASM.
     * Usa Uint8Array.set() — operación nativa, ~0.5ms para 1M celdas.
     * @param {Uint8Array[]} columns — grid[x] = columna y de altura gh
     */
    syncGrid(columns) {
        const gh = this._gh;
        for (let x = 0, gw = this._gw; x < gw; x++) {
            this._gridFlat.set(columns[x], x * gh);
        }
    }

    /**
     * Sincroniza los buffers de actividad.
     * Son Uint8Array → set() es zero-copy nativo.
     * @param {Uint8Array} actAges
     * @param {Uint8Array} dyAges
     */
    syncActivity(actAges, dyAges) {
        this._actAges.set(actAges);
        this._dyAges.set(dyAges);
    }

    /**
     * Render completo vía WASM.
     * @param {number}  dead32
     * @param {number}  alive32
     * @param {number}  born32
     * @param {number}  dying32 — uint32 RGBA LE
     * @param {boolean} showActivity
     * @param {number}  cooldown
     */
    fillFull(dead32, alive32, born32, dying32, showActivity, cooldown) {
        this._instance.exports.fill_full(
            this._gw, this._gh, this._cs,
            dead32, alive32, born32, dying32,
            showActivity ? 1 : 0, cooldown,
            this.pixBase, this.gridBase, this.actBase, this.dyBase
        );
    }

    /**
     * Render diferencial vía WASM.
     * Copia el Set de índices sucios al buffer WASM y llama fill_dirty.
     * @param {Set<number>} dirtyCells
     * @param {number}  dead32
     * @param {number}  alive32
     * @param {number}  born32
     * @param {number}  dying32
     * @param {boolean} showActivity
     * @param {number}  cooldown
     * @returns {{px, py, pw, ph}} — dirty rect en píxeles para putImageData
     */
    fillDirty(dirtyCells, dead32, alive32, born32, dying32, showActivity, cooldown) {
        // Volcar Set → Uint32Array en memoria WASM
        let i = 0;
        for (const idx of dirtyCells) {
            this._dirtyArr[i++] = idx;
        }
        const count = i;

        const bbox = this._instance.exports.fill_dirty(
            this.dirtyBase, count,
            this._gh, this._cs, this._gw,
            dead32, alive32, born32, dying32,
            showActivity ? 1 : 0, cooldown,
            this.pixBase, this.gridBase, this.actBase, this.dyBase
        );

        // Desempaquetar bounding box desde i64
        // JS no tiene i64 nativo — BigInt es la API correcta
        const bbBig = BigInt.asUintN(64, bbox);
        const minGx = Number(bbBig & 0xffffn);
        const minGy = Number((bbBig >> 16n) & 0xffffn);
        const maxGx = Number((bbBig >> 32n) & 0xffffn);
        const maxGy = Number((bbBig >> 48n) & 0xffffn);

        const cs = this._cs;
        return {
            px: minGx * cs,
            py: minGy * cs,
            pw: (maxGx - minGx + 1) * cs,
            ph: (maxGy - minGy + 1) * cs,
        };
    }

    // =========================================================================
    // UTILIDADES PRIVADAS
    // =========================================================================

    /**
     * Decodifica base64 a Uint8Array sin depender de atob (funciona en Worker).
     * @param {string} b64
     * @returns {Uint8Array}
     */
    _decodeBase64(b64) {
        if (typeof atob !== 'undefined') {
            const bin = atob(b64);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            return buf;
        }
        // Fallback Node.js / Worker sin atob
        return Uint8Array.from(Buffer.from(b64, 'base64'));
    }
}

export {WasmRenderer};