/**
 * ImportExportController — Importación y exportación de patrones.
 *
 * Responsabilidades:
 *   - Exportar el grid (o la selección) como RLE
 *   - Exportar circuitos WireWorld como MCL
 *   - Importar ficheros .rle, .json y .mcl desde el sistema de ficheros
 *   - Auto-resize del grid cuando el patrón importado no cabe
 *
 * Dependencias inyectadas en el constructor para evitar acoplamiento directo:
 *   - automaton          — instancia de CellularAutomaton
 *   - getSelection       — () => selection | null  (desde CanvasController)
 *   - onShowNotification — (msg, type, duration) => void
 *   - onGridResized      — (newSize) => void  (sincroniza slider+display del grid)
 */
class ImportExportController {

    /**
     * @param {Object}   options
     * @param {Object}   options.automaton
     * @param {Function} options.getSelection       — () => {startX,startY,endX,endY}|null
     * @param {Function} options.onShowNotification — (msg, type, duration) => void
     * @param {Function} options.onGridResized      — (newSize) => void
     * @param {Function} options.addEventListener   — helper compartido de registro+cleanup
     */
    constructor({automaton, getSelection, onShowNotification, onGridResized, addEventListener}) {
        this.automaton = automaton;
        this._getSelection = getSelection;
        this._showNotification = onShowNotification;
        this._onGridResized = onGridResized;
        this._addEventListener = addEventListener;
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    /**
     * Enlaza los botones de importar/exportar.
     * Llamado desde UIController._bindEvents().
     */
    bindEvents() {
        this._addEventListener(
            document.getElementById('exportBtn'), 'click', () => this.exportPattern()
        );
        this._addEventListener(
            document.getElementById('importBtn'), 'click', () => this.importPatternFromFile()
        );
    }

    // =========================================
    // EXPORTAR
    // =========================================

    /**
     * Exporta el grid (o la selección activa) como .rle.
     * En modo WireWorld exporta como .mcl con los 4 estados completos.
     */
    exportPattern() {
        // WireWorld: exportar en formato MCL (preserva los 4 estados)
        if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD
            && this.automaton.wireworldEngine?.isActive) {
            this._exportMCL();
            return;
        }

        // Calcular bounds si hay selección activa
        const sel = this._getSelection();
        const bounds = sel ? {
            minX: Math.min(sel.startX, sel.endX),
            minY: Math.min(sel.startY, sel.endY),
            maxX: Math.max(sel.startX, sel.endX),
            maxY: Math.max(sel.startY, sel.endY)
        } : null;

        const patternData = this.automaton.exportPattern(bounds);
        if (!patternData) {
            this._showNotification(t('notif.pattern.empty'), 'warning', 2000);
            return;
        }

        const codec = new RLECodec();
        const ruleString = this.automaton.rule
            ? `B${this.automaton.rule.birth.join('')}/S${this.automaton.rule.survival.join('')}`
            : 'B3/S23';

        const rleText = codec.encode({
            pattern: patternData.pattern,
            name: patternData.name,
            description: patternData.description,
            rule: ruleString
        });

        this._downloadText(rleText, `pattern-${Date.now()}.rle`);
        this._showNotification(t('notif.pattern.exported'), 'info', 2000);
    }

    /**
     * Exporta el circuito WireWorld activo como .mcl (estados 0-3 preservados).
     */
    _exportMCL() {
        const state = this.automaton.exportWireworldState();
        if (!state) {
            this._showNotification(t('notif.pattern.empty'), 'warning', 2000);
            return;
        }

        const codec = new MCLCodec();
        const mclText = codec.encode(state);
        if (!mclText) {
            this._showNotification(t('notif.pattern.empty'), 'warning', 2000);
            return;
        }

        this._downloadText(mclText, `wireworld-${Date.now()}.mcl`);
        this._showNotification(t('notif.pattern.exported'), 'info', 2000);
    }

    // =========================================
    // IMPORTAR
    // =========================================

    /**
     * Abre el diálogo de fichero y carga el patrón seleccionado.
     * Formatos soportados: .rle, .json, .mcl
     */
    importPatternFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.rle,.json,.mcl';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => this._handleFileLoad(ev.target.result, file.name);
            reader.readAsText(file);
        };
        input.click();
    }

    /**
     * Procesa el contenido del fichero cargado.
     * Detecta el formato y delega a la ruta de importación correspondiente.
     *
     * @param {string} text     — contenido del fichero
     * @param {string} filename — nombre original (para el fallback de nombre de patrón)
     */
    _handleFileLoad(text, filename) {
        try {
            // MCL tiene firma propia — detectar primero
            if (MCLCodec.isFormat(text)) {
                this._importMCL(text, filename);
                return;
            }

            const format = RLECodec.detectFormat(text);
            let patternData;

            if (format === 'rle') {
                const codec = new RLECodec();
                const decoded = codec.decode(text);
                patternData = {
                    pattern: decoded.pattern,
                    name: decoded.name || filename.replace(/\.rle$/i, ''),
                    description: decoded.description || '',
                };
            } else if (format === 'json') {
                patternData = JSON.parse(text);
            } else {
                this._showNotification(t('notif.pattern.invalidFormat'), 'warning', 2500);
                return;
            }

            const center = Math.floor(this.automaton.gridSize / 2);
            this.automaton.importPattern(patternData, center, center);
            this.automaton.updateStats();
            this.automaton.render();
            this._showNotification(t('notif.pattern.imported'), 'info', 2000);

        } catch (err) {
            console.error('Error importando patrón:', err);
            this._showNotification(t('notif.pattern.importError'), 'warning', 3000);
        }
    }

    /**
     * Importa un fichero MCL (circuito WireWorld).
     *
     * Si el patrón no cabe en el grid actual, lo amplía automáticamente con
     * un margen del 20% (mín. 20 celdas). Notifica al exterior vía onGridResized
     * para que el slider del grid se actualice.
     *
     * Si WireWorld está activo, carga los 4 estados directamente.
     * Si no, importa como patrón binario estándar (conductor=1) con advertencia.
     *
     * @param {string} text     — contenido del fichero .mcl
     * @param {string} filename — nombre original del fichero
     */
    _importMCL(text, filename) {
        try {
            const codec = new MCLCodec();
            const decoded = codec.decode(text);

            // Auto-resize: ampliar el grid si el patrón no cabe
            const needed = Math.max(decoded.width, decoded.height);
            const current = this.automaton.gridSize;
            if (needed > current) {
                const margin = Math.max(20, Math.round(needed * 0.2 / 5) * 5);
                const newSize = Math.min(Math.round((needed + margin) / 5) * 5, 1000);
                this.automaton.resizeGrid(newSize);
                // Notificar al exterior para sincronizar slider y display
                this._onGridResized(newSize);
            }

            // Limpiar el grid antes de importar para no superponer circuitos
            this.automaton.clear();

            if (this.automaton.specialMode === SpecialEngineManager.MODES.WIREWORLD
                && this.automaton.wireworldEngine?.isActive) {
                // WireWorld activo: cargar con los 4 estados completos
                this.automaton.importWireworldState(decoded.stateGrid, decoded.width, decoded.height);
                this._showNotification(t('notif.pattern.imported'), 'info', 2000);
                return;
            }

            // WireWorld no activo: importar como binario (conductor=1) con advertencia
            const pattern = [];
            for (let y = 0; y < decoded.height; y++) {
                const row = [];
                for (let x = 0; x < decoded.width; x++) {
                    row.push((decoded.stateGrid[x]?.[y] ?? 0) > 0 ? 1 : 0);
                }
                pattern.push(row);
            }
            const patternData = {
                pattern,
                name: decoded.name || filename.replace(/\.mcl$/i, ''),
                description: decoded.description || ''
            };
            const center = Math.floor(this.automaton.gridSize / 2);
            this.automaton.importPattern(patternData, center, center);
            this.automaton.updateStats();
            this.automaton.render();
            this._showNotification(t('notif.pattern.importedMCLPartial'), 'warning', 3000);

        } catch (err) {
            console.error('Error importando MCL:', err);
            this._showNotification(t('notif.pattern.importError'), 'warning', 3000);
        }
    }

    // =========================================
    // UTILIDADES PRIVADAS
    // =========================================

    /**
     * Descarga un texto como fichero usando un <a> temporal.
     * @param {string} text     — contenido del fichero
     * @param {string} filename — nombre del fichero descargado
     */
    _downloadText(text, filename) {
        const blob = new Blob([text], {type: 'text/plain'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

window.ImportExportController = ImportExportController;