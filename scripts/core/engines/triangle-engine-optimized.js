/**
 * TriangleEngineOptimized - Motor triangular con optimizaciones para WebGL2
 *
 * Mejoras:
 * 1. TypedArrays contiguos para transferencia rápida GPU
 * 2. SIMD-friendly loops (evita branches en inner loop)
 * 3. Pre-cálculo de rule tables
 * 4. Buffer pooling para evitar GC
 */

class TriangleEngineOptimized extends TriangleEngine {
    constructor(automaton) {
        super(automaton);

        // Optimización: Grid plano para mejor caché locality
        this._flatGrid = null;
        this._flatNewGrid = null;

        // Pool de buffers para evitar allocaciones
        this._bufferPool = [];
        this._maxPoolSize = 2;

        // Pre-cálculo de configuraciones
        this._precomputeConfigs();
    }

    /**
     * Pre-computa todas las configuraciones posibles (8 vecindades)
     */
    _precomputeConfigs() {
        // Cache de resultados para cada configuración
        this._configCache = new Uint8Array(8);
        this._buildRuleTable();
    }

    activate(options = {}) {
        const result = super.activate(options);

        // Inicializar grids planos para transferencia rápida
        if (this.gridManager) {
            this._initFlatGrids();
        }

        return result;
    }

    _initFlatGrids() {
        const size = this.gridManager.width * this.gridManager.height;

        // Reutilizar de pool si disponible
        if (this._bufferPool.length > 0) {
            this._flatGrid = this._bufferPool.pop();
            this._flatNewGrid = this._bufferPool.pop();
        } else {
            this._flatGrid = new Uint8Array(size);
            this._flatNewGrid = new Uint8Array(size);
        }

        this._syncToFlat();
    }

    /**
     * Sincroniza grid 2D a flat (para transferencia WebGL2)
     */
    _syncToFlat() {
        const gm = this.gridManager;
        const width = gm.width;
        const height = gm.height;
        let idx = 0;

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                this._flatGrid[idx++] = gm.grid[q][r];
            }
        }
    }

    /**
     * Sincroniza flat a grid 2D (después de compute)
     */
    _syncFromFlat() {
        const gm = this.gridManager;
        const width = gm.width;
        const height = gm.height;
        let idx = 0;

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                gm.grid[q][r] = this._flatNewGrid[idx++];
            }
        }
    }

    /**
     * Step optimizado con SIMD-friendly loops
     */
    _stepSyncOptimized() {
        const width = this.gridManager.width;
        const height = this.gridManager.height;
        const current = this._flatGrid;
        const next = this._flatNewGrid;
        const ruleTable = this._ruleTable;
        const wrap = this.wrapEdges;

        // Pre-calcular offsets de vecinos para versión wrap
        const w = width;
        const h = height;

        this._changedCells.length = 0;
        let changedCount = 0;
        const CHANGED_CAP = 100000;

        if (wrap) {
            // VERSIÓN WRAP OPTIMIZADA - sin branches en inner loop
            for (let r = 0; r < h; r++) {
                const rUp = (r - 1 + h) % h;
                const rDown = (r + 1) % h;
                const rowOffset = r * w;
                const rowUpOffset = rUp * w;
                const rowDownOffset = rDown * w;

                for (let q = 0; q < w; q++) {
                    const isUp = ((q + r) & 1) === 0;
                    const idx = rowOffset + q;
                    const currentState = current[idx];

                    let sum = 0;

                    if (isUp) {
                        // △: vecinos [-1,0], [1,0], [0,1]
                        const leftIdx = rowOffset + ((q - 1 + w) % w);
                        const rightIdx = rowOffset + ((q + 1) % w);
                        const downIdx = rowDownOffset + q;

                        sum = current[leftIdx] + current[rightIdx] + current[downIdx];
                    } else {
                        // ▽: vecinos [0,-1], [-1,0], [1,0]
                        const upIdx = rowUpOffset + q;
                        const leftIdx = rowOffset + ((q - 1 + w) % w);
                        const rightIdx = rowOffset + ((q + 1) % w);

                        sum = current[upIdx] + current[leftIdx] + current[rightIdx];
                    }

                    const config = (currentState << 2) | sum;
                    const newState = ruleTable[config];

                    next[idx] = newState;

                    if (newState !== currentState && changedCount < CHANGED_CAP) {
                        this._changedCells[changedCount++] = (q << 16) | r;
                    }
                }
            }
        } else {
            // VERSIÓN BOUNDED - con checks pero optimizada
            for (let r = 0; r < h; r++) {
                const rowOffset = r * w;
                const hasUp = r > 0;
                const hasDown = r < h - 1;
                const rowUpOffset = hasUp ? (r - 1) * w : 0;
                const rowDownOffset = hasDown ? (r + 1) * w : 0;

                for (let q = 0; q < w; q++) {
                    const isUp = ((q + r) & 1) === 0;
                    const idx = rowOffset + q;
                    const currentState = current[idx];

                    let sum = 0;

                    if (isUp) {
                        // △: [-1,0], [1,0], [0,1]
                        if (q > 0) sum += current[rowOffset + q - 1];
                        if (q < w - 1) sum += current[rowOffset + q + 1];
                        if (hasDown) sum += current[rowDownOffset + q];
                    } else {
                        // ▽: [0,-1], [-1,0], [1,0]
                        if (hasUp) sum += current[rowUpOffset + q];
                        if (q > 0) sum += current[rowOffset + q - 1];
                        if (q < w - 1) sum += current[rowOffset + q + 1];
                    }

                    const config = (currentState << 2) | sum;
                    const newState = ruleTable[config];

                    next[idx] = newState;

                    if (newState !== currentState && changedCount < CHANGED_CAP) {
                        this._changedCells[changedCount++] = (q << 16) | r;
                    }
                }
            }
        }

        // Swap references (no copia de datos)
        const temp = this._flatGrid;
        this._flatGrid = this._flatNewGrid;
        this._flatNewGrid = temp;

        // Sync a grid 2D para compatibilidad con renderer
        this._syncFromFlat();

        this._changedCells.length = changedCount;
        this.generation++;

        return changedCount;
    }

    /**
     * Override step para usar versión optimizada
     */
    async step() {
        if (!this.isActive || !this.gridManager) return false;

        // Usar implementación optimizada
        if (!this.initialized) {
            this._initializeFromAutomaton();
            this.initialized = true;
            return true;
        }

        // Si hay Web Worker disponible, usarlo
        if (this.useWorker && this.worker && this._workerReady) {
            return super.step();  // Mantener worker para compute async
        }

        // Versión síncrona optimizada
        const changedCount = this._stepSyncOptimized();
        this._syncChangedToAutomaton();
        return changedCount > 0;
    }

    /**
     * Obtiene el grid plano para transferencia directa a WebGL2
     */
    getFlatGrid() {
        return this._flatGrid;
    }

    /**
     * Resize optimizado con pooling de buffers
     */
    resize(newSize) {
        // Guardar buffers antiguos en pool
        if (this._flatGrid && this._bufferPool.length < this._maxPoolSize) {
            this._bufferPool.push(this._flatGrid, this._flatNewGrid);
        }

        this._flatGrid = null;
        this._flatNewGrid = null;

        // Llamar resize original
        super.resize(newSize);

        // Reinicializar grids planos
        if (this.gridManager) {
            this._initFlatGrids();
        }
    }

    deactivate() {
        // Limpiar pool
        this._bufferPool = [];
        this._flatGrid = null;
        this._flatNewGrid = null;

        super.deactivate();
    }
}

window.TriangleEngineOptimized = TriangleEngineOptimized;