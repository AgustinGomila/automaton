import {AppConfig} from '../../utils/config.js';
import {eventBus} from '../../infrastructure/event-bus.js';
import {HexGridManager} from '../hex-grid-manager.js';
import {HexWorkerManager} from '../../infrastructure/workers/hex-worker-manager.js';

/**
 * HexEngine — Motor de autómata celular hexagonal.
 *
 * Implementa reglas Life-like B/S sobre una malla hexagonal (pointy-top, odd-r offset).
 * Cada celda tiene exactamente 6 vecinos — no hay distinción de orientación como
 * en los triángulos. Soporta reglas arbitrarias B0–6/S0–6.
 *
 * Reglas interesantes de partida:
 *   B2/S34   — crecimiento estable, análogo a Conway en hex
 *   B2/S0    — Snowflake, produce cristales de hielo
 *   B3/S23   — comportamiento cercano a Conway
 *   B36/S23  — HighLife hexagonal
 *
 * ─── Arquitectura ──────────────────────────────────────────────────────────
 * Idéntica a TriangleEngine:
 *   - HexGridManager  — estructura de datos del grid
 *   - HexWorkerManager — offload del step al Worker
 *   - _stepSync()     — fallback síncrono en el hilo principal
 *   - _syncToAutomaton() — mantiene automaton.grid[] sincronizado para el renderer
 *
 * ─── Vecindad (odd-r offset) ───────────────────────────────────────────────
 *   fila par:   E[+1,0], NE[0,-1], NW[-1,-1], W[-1,0], SW[-1,+1], SE[0,+1]
 *   fila impar: E[+1,0], NE[+1,-1], NW[0,-1], W[-1,0], SW[0,+1], SE[+1,+1]
 */
class HexEngine {

    /**
     * @param {Object} automaton — contexto inyectado por SpecialEngineManager.
     *   Expone: .gridWidth, .gridHeight, .grid, .renderer, .wrapEdges, .render()
     */
    constructor(automaton) {
        this.automaton = automaton;

        this.isActive = false;
        this.initialized = false;
        this.generation = 0;
        this.wrapEdges = true;

        // Regla B/S (vecinos 0–6)
        this.birth = [2];
        this.survival = [1, 2, 3, 4];

        // Tablas de lookup: índice = nº vecinos vivos (0–6), valor = 0|1
        this._birthTable = new Uint8Array(7);
        this._survivalTable = new Uint8Array(7);

        // Grid propio (HexGridManager)
        this.gridManager = null;
        this._newGrid = null;   // back-buffer para _stepSync

        // Celdas modificadas en el último paso
        this._changedCells = [];

        // Worker
        this.useWorker = true;
        this.workerThreshold = AppConfig.WORKER.TRIANGLE_THRESHOLD; // reutiliza el umbral ETA
        this._workerManager = null;
        this._pendingStep = false;
    }

    // ─── Ciclo de vida ────────────────────────────────────────────────────

    /**
     * Activa el motor con la regla y configuración dadas.
     * @param {Object}   options
     * @param {number[]} [options.birth=[2]]     — vecinos que hacen nacer
     * @param {number[]} [options.survival=[3,4]] — vecinos que hacen sobrevivir
     * @param {boolean}  [options.wrap=true]
     * @returns {HexEngine} this
     */
    activate(options = {}) {
        this.birth = (options.birth ?? [2]).filter(n => n >= 0 && n <= 6);
        this.survival = (options.survival ?? [1, 2, 3, 4]).filter(n => n >= 0 && n <= 6);
        this.wrapEdges = options.wrap ?? true;

        this._buildLookupTables();

        // Dimensiones del grid hexagonal: 1:1 con el grid rectangular del autómata
        const cols = this.automaton.gridWidth;
        const rows = this.automaton.gridHeight;

        if (!this.gridManager || this.gridManager.width !== cols || this.gridManager.height !== rows) {
            this.gridManager = new HexGridManager(cols, rows);
            this._newGrid = Array.from({length: cols}, () => new Uint8Array(rows));
        }

        this.generation = 0;
        this.initialized = false;
        this._changedCells.length = 0;
        this.isActive = true;

        // Worker: activar si el grid supera el umbral
        const shouldUseWorker = this.useWorker &&
            (cols * rows >= this.workerThreshold * this.workerThreshold);

        if (shouldUseWorker) {
            if (!this._workerManager) {
                this._workerManager = new HexWorkerManager({
                    workerPath: 'scripts/infrastructure/workers/hex-worker.js',
                    onResult: (raw) => this._onWorkerResult(raw),
                    onReady: () => console.debug('⬡ HexWorkerManager: listo'),
                    onError: () => {
                        console.warn('⬡ HexWorkerManager: error — modo síncrono');
                        this.useWorker = false;
                        this._workerManager?.destroy();
                        this._workerManager = null;
                    },
                });
                this._workerManager.init();
            }
            this._workerManager.sync(this.gridManager, this.birth, this.survival, this.wrapEdges);
        } else if (this._workerManager) {
            this._workerManager.destroy();
            this._workerManager = null;
        }

        console.debug(`⬡ HexEngine activado: B${this.birth.join('')}/S${this.survival.join('')} [${cols}×${rows}]`);
        return this;
    }

    deactivate() {
        this.isActive = false;
        this._workerManager?.destroy();
        this._workerManager = null;
        console.debug('⬡ HexEngine desactivado');
    }

    // ─── Paso de simulación ───────────────────────────────────────────────

    /**
     * Avanza una generación. Async por compatibilidad con el warm-up del worker.
     * @returns {Promise<boolean>|boolean}
     */
    async step() {
        if (!this.isActive || !this.gridManager) return false;

        if (this._workerManager?.isProcessing) {
            this._pendingStep = true;
            return true;
        }

        // La inicialización del grid la gestiona el controlador (activateHexMode).
        // No se llama _initializeFromAutomaton aquí porque leería automaton.grid
        // (el grid rectangular, vacío) sobreescribiendo las celdas dibujadas por el
        // usuario en hexEngine.gridManager.
        if (!this.initialized) {
            this.initialized = true;
        }

        if (this._workerManager?.step()) return true;

        return this._stepSync();
    }

    /**
     * Paso síncrono en el hilo principal (fallback sin worker).
     * Tablas Uint8Array[7] — sin Set.has() en el inner loop.
     */
    _stepSync() {
        const cols = this.gridManager.width;
        const rows = this.gridManager.height;
        const cur = this.gridManager.grid;
        const next = this._newGrid;
        const wrap = this.wrapEdges;
        const bT = this._birthTable;
        const sT = this._survivalTable;

        // Limpiar buffer de celdas cambiadas antes de computar la generación
        this._changedCells.length = 0;

        // ── Vecinos inlineados — mismo patrón que nextGenerationMoore ────────
        // Sin loop interno, sin módulo doble: condicionales ternarios para wrap
        // y columnas precacheadas (colL, col, colR) por iteración de columna.
        //
        // Odd-r offset (pointy-top): los vecinos dependen de la paridad de r.
        //   Fila par:   E=colR[r], NE=col[rU], NW=colL[rU], W=colL[r], SW=colL[rD], SE=col[rD]
        //   Fila impar: E=colR[r], NE=colR[rU], NW=col[rU], W=colL[r], SW=col[rD], SE=colR[rD]

        if (wrap) {
            for (let r = 0; r < rows; r++) {
                const rU = r === 0 ? rows - 1 : r - 1;
                const rD = r === rows - 1 ? 0 : r + 1;
                const isOdd = (r & 1) === 1;

                for (let c = 0; c < cols; c++) {
                    const cL = c === 0 ? cols - 1 : c - 1;
                    const cR = c === cols - 1 ? 0 : c + 1;
                    const col = cur[c];
                    const colL = cur[cL];
                    const colR = cur[cR];

                    // 6 vecinos inlineados según paridad — sin loop interno, sin módulo
                    const n = isOdd
                        ? colR[r] + colR[rU] + col[rU] + colL[r] + col[rD] + colR[rD]
                        : colR[r] + col[rU] + colL[rU] + colL[r] + colL[rD] + col[rD];

                    const state = col[r];
                    const newState = state ? sT[n] : bT[n];
                    next[c][r] = newState;

                    if (newState !== state) {
                        this._changedCells.push({x: c, y: r});
                    }
                }
            }
        } else {
            // ── Bounded: verificación de bordes con flags precalculados por fila
            for (let r = 0; r < rows; r++) {
                const rU = r - 1;
                const rD = r + 1;
                const hasU = rU >= 0;
                const hasD = rD < rows;
                const isOdd = (r & 1) === 1;

                for (let c = 0; c < cols; c++) {
                    const cL = c - 1;
                    const cR = c + 1;
                    const hasL = cL >= 0;
                    const hasR = cR < cols;
                    const col = cur[c];
                    const colL = hasL ? cur[cL] : null;
                    const colR = hasR ? cur[cR] : null;

                    let n;
                    if (isOdd) {
                        n = (hasR ? colR[r] : 0)
                            + (hasR && hasU ? colR[rU] : 0)
                            + (hasU ? col[rU] : 0)
                            + (hasL ? colL[r] : 0)
                            + (hasD ? col[rD] : 0)
                            + (hasR && hasD ? colR[rD] : 0);
                    } else {
                        n = (hasR ? colR[r] : 0)
                            + (hasU ? col[rU] : 0)
                            + (hasL && hasU ? colL[rU] : 0)
                            + (hasL ? colL[r] : 0)
                            + (hasL && hasD ? colL[rD] : 0)
                            + (hasD ? col[rD] : 0);
                    }

                    const state = col[r];
                    const newState = state ? sT[n] : bT[n];
                    next[c][r] = newState;

                    if (newState !== state) {
                        this._changedCells.push({x: c, y: r});
                    }
                }
            }
        }

        // Swap back-buffer sin allocaciones
        for (let c = 0; c < cols; c++) {
            const tmp = this.gridManager.grid[c];
            this.gridManager.grid[c] = next[c];
            this._newGrid[c] = tmp;
        }

        this.generation++;
        this._syncToAutomaton();
        return true;
    }

    // ─── Worker result ────────────────────────────────────────────────────

    _onWorkerResult({result, gridBuffer, changedCellsBuffer}) {
        if (!this.isActive) return;

        if (gridBuffer) {
            const flat = new Uint8Array(gridBuffer);
            const cols = this.gridManager.width;
            const rows = this.gridManager.height;
            for (let c = 0; c < cols; c++) {
                const col = this.gridManager.grid[c];
                const offset = c * rows;
                for (let r = 0; r < rows; r++) col[r] = flat[offset + r];
            }
        }

        this._changedCells.length = 0;
        if (changedCellsBuffer && result.changedCount > 0) {
            const arr = new Int32Array(changedCellsBuffer);
            for (let i = 0; i < result.changedCount; i++) {
                this._changedCells.push({x: arr[i * 2], y: arr[i * 2 + 1]});
            }
        }

        this.generation = result.generation;
        this._syncToAutomaton();

        if (this.automaton) {
            this.automaton.renderer.updateActivityAges(this._changedCells);
            this.automaton.render();

            const population = this.gridManager.countPopulation();
            const totalCells = this.gridManager.width * this.gridManager.height;
            const density = (population / totalCells * 100).toFixed(1);
            eventBus.emit('stats:updated', {generation: this.generation, population, density});
        }

        if (this._pendingStep) {
            this._pendingStep = false;
            this.step();
        }
    }

    // ─── Sincronización con automaton.grid[] ─────────────────────────────

    /**
     * Copia hexGrid → automaton.grid y notifica al renderer de cambios.
     * El GridRenderer usa automaton.grid[] (rectangular) para WASM render.
     */
    _syncToAutomaton() {
        // Marcar dirty directamente en el HexRenderer usando las dimensiones del
        // gridManager propio — sin depender de automaton.grid que tiene dimensiones
        // rectangulares distintas y causa que columnas fuera de su rango no se redibujen.
        const renderer = this.automaton.renderer;
        for (const {x, y} of this._changedCells) {
            renderer.markDirty(x, y);
        }

        // Mantener automaton.grid sincronizado para compatibilidad con el sistema de stats.
        // Solo se actualiza donde las dimensiones rectangulares lo permiten.
        const aGrid = this.automaton.grid;
        const hGrid = this.gridManager.grid;
        const cols = Math.min(this.gridManager.width, aGrid.length);
        if (!cols) return;
        const rows = Math.min(this.gridManager.height, aGrid[0]?.length ?? 0);
        for (let c = 0; c < cols; c++) {
            const hCol = hGrid[c];
            const aCol = aGrid[c];
            if (!aCol) continue;
            for (let r = 0; r < rows; r++) {
                aCol[r] = hCol[r];
            }
        }
    }

    /**
     * Inicializa el hexGrid desde automaton.grid[] (estado dibujado por el usuario).
     */
    _initializeFromAutomaton() {
        const aGrid = this.automaton.grid;
        const hGrid = this.gridManager.grid;
        const cols = this.gridManager.width;
        const rows = this.gridManager.height;

        for (let c = 0; c < cols; c++) {
            const aCol = aGrid[c];
            const hCol = hGrid[c];
            if (!aCol) {
                hCol.fill(0);
                continue;
            }
            for (let r = 0; r < rows; r++) {
                hCol[r] = aCol[r] ? 1 : 0;
            }
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    _buildLookupTables() {
        this._birthTable.fill(0);
        this._survivalTable.fill(0);
        for (const n of this.birth) this._birthTable[n] = 1;
        for (const n of this.survival) this._survivalTable[n] = 1;
    }

    getChangedCells() {
        return this._changedCells;
    }

    getInfo() {
        const pop = this.gridManager?.countPopulation() ?? 0;
        const total = (this.gridManager?.width ?? 0) * (this.gridManager?.height ?? 0);
        return {
            birth: this.birth,
            survival: this.survival,
            ruleString: `B${this.birth.join('')}/S${this.survival.join('')}`,
            generation: this.generation,
            population: pop,
            density: total ? (pop / total * 100).toFixed(1) : '0.0',
            useWorker: !!this._workerManager,
        };
    }

    /**
     * Sincroniza la regla en caliente (sin re-activate).
     * Llamado desde la UI cuando el usuario cambia birth/survival.
     */
    setRule(birth, survival) {
        this.birth = birth.filter(n => n >= 0 && n <= 6);
        this.survival = survival.filter(n => n >= 0 && n <= 6);
        this._buildLookupTables();

        // Re-sincronizar el worker con la nueva regla
        if (this._workerManager) {
            this._workerManager.sync(this.gridManager, this.birth, this.survival, this.wrapEdges);
        }
    }
}

export {HexEngine};