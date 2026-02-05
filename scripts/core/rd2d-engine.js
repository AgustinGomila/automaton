/**
 * Motor de Distinción Recursiva 2D (RD-2D)
 *
 * Basado en el trabajo de Louis Kauffman sobre Distinción Recursiva.
 * 16 estados representados por 4 bits: [N, S, E, W] (Norte, Sur, Este, Oeste)
 * Cada bit indica si la frontera correspondiente está "abierta" (1) o "cerrada" (0)
 *
 * Estados (0-15):
 * 0: 0000 (vacío)    4: 0100 (S)       8: 1000 (N)      12: 1100 (NS)
 * 1: 0001 (E)        5: 0101 (SE)      9: 1001 (NE)     13: 1101 (NSE)
 * 2: 0010 (W)        6: 0110 (SW)     10: 1010 (NW)     14: 1110 (NSW)
 * 3: 0011 (EW)       7: 0111 (SEW)    11: 1011 (NEW)    15: 1111 (NSEW)
 *
 * Regla de evolución: XOR de los estados de los 4 vecinos
 * nuevo_estado[x][y] = vecino_N ^ vecino_S ^ vecino_E ^ vecino_W
 */

class RD2DEngine {
    constructor(automaton) {
        this.automaton = automaton;
        this.isActive = false;
        this.gridSize = 0;
        this.stateGrid = null; // Grid de estados 0-15, separado del grid binario del automaton
        this.generation = 0;
    }

    activate() {
        this.gridSize = this.automaton.gridSize;
        this.isActive = true;
        this.generation = 0;

        // Inicializar grid de estados
        this._initStateGrid();

        // Inicializar con patrón semilla (cruz en el centro con estado 15)
        this._initializeSeed();

        console.debug('🔲 RD-2D activado: 16 estados [N,S,E,W]');
        return this;
    }

    deactivate() {
        this.isActive = false;
        this.stateGrid = null;
        console.debug('🔲 RD-2D desactivado');
    }

    /**
     * Inicializa el grid de estados
     */
    _initStateGrid() {
        this.stateGrid = new Array(this.gridSize);
        for (let x = 0; x < this.gridSize; x++) {
            this.stateGrid[x] = new Uint8Array(this.gridSize);
        }
    }

    /**
     * Patrón semilla: cruz central con estado completo (15)
     */
    _initializeSeed() {
        if (this.initialized && !this._forceReinit) return;

        const center = Math.floor(this.gridSize / 2);
        const size = this.gridSize;

        // Siempre crear stateGrid fresco, nunca reusar
        this._initStateGrid();

        // Colocar cruz central
        for (let i = -2; i <= 2; i++) {
            const vy = center + i;
            if (vy >= 0 && vy < size) {
                this.stateGrid[center][vy] = 15;
                this.automaton.grid[center][vy] = 1;
            }

            const hx = center + i;
            if (hx >= 0 && hx < size && i !== 0) {
                this.stateGrid[hx][center] = 15;
                this.automaton.grid[hx][center] = 1;
            }
        }

        this.generation = 0;
        this.initialized = true;
        this._forceReinit = false;
    }

    _checkUserSeed() {
        for (let x = 0; x < this.gridSize; x++) {
            // Verificar que la columna existe
            if (!this.automaton.grid[x]) continue;

            for (let y = 0; y < this.gridSize; y++) {
                if (this.automaton.grid[x][y]) return true;
            }
        }
        return false;
    }

    /**
     * Sincroniza el estado RD desde el grid binario del autómata
     * Convierte celdas vivas del usuario a estados RD apropiados
     */
    _syncFromAutomatonGrid() {
        // Reiniciar stateGrid
        this._initStateGrid();

        const size = this.gridSize;

        for (let x = 0; x < size; x++) {
            if (!this.automaton.grid[x]) continue;

            for (let y = 0; y < size; y++) {
                if (this.automaton.grid[x][y]) {
                    // Celda viva del usuario: asignar estado 15 (NSEW completo)
                    // o inferir de vecinos si es posible
                    this.stateGrid[x][y] = this._inferStateFromNeighbors(x, y) || 15;
                } else {
                    this.stateGrid[x][y] = 0;
                }
            }
        }
    }

    /**
     * Intenta inferir un estado RD razonable basado en vecinos inmediatos
     * Si una celda tiene vecinos vivos en ciertas direcciones, abre esas fronteras
     */
    _inferStateFromNeighbors(x, y) {
        const size = this.gridSize;
        let state = 0;

        // Verificar vecinos cardinales en el grid del autómata
        // Norte (y-1)
        if (y > 0 && this.automaton.grid[x]?.[y - 1]) {
            state |= 8; // bit N
        }
        // Sur (y+1)
        if (y < size - 1 && this.automaton.grid[x]?.[y + 1]) {
            state |= 4; // bit S
        }
        // Este (x+1)
        if (x < size - 1 && this.automaton.grid[x + 1]?.[y]) {
            state |= 2; // bit E
        }
        // Oeste (x-1)
        if (x > 0 && this.automaton.grid[x - 1]?.[y]) {
            state |= 1; // bit W
        }

        // Si no tiene vecinos, estado completo (15) por defecto
        return state === 0 ? 15 : state;
    }

    /**
     * Actualiza el grid del autómata desde el stateGrid RD
     * Llama después de cada paso RD para sincronizar visualización
     */
    _syncToAutomatonGrid() {
        const size = this.gridSize;

        for (let x = 0; x < size; x++) {
            if (!this.automaton.grid[x]) continue;

            for (let y = 0; y < size; y++) {
                const isAlive = this.stateGrid[x]?.[y] !== 0;

                // Solo actualizar si cambió, y sin usar setCell (evitar overhead)
                if (this.automaton.grid[x][y] !== (isAlive ? 1 : 0)) {
                    this.automaton.grid[x][y] = isAlive ? 1 : 0;

                    if (isAlive) {
                        this.automaton.dirtyCells.add(x * size + y);
                    }
                }
            }
        }
    }

    /**
     * Obtiene el estado de una celda con wrap (toroidal)
     */
    _getState(x, y) {
        const size = this.gridSize;
        const wx = ((x % size) + size) % size;
        const wy = ((y % size) + size) % size;
        return this.stateGrid[wx]?.[wy] || 0;
    }

    /**
     * Renderiza una celda RD-2D mostrando sus fronteras como líneas
     */
    _renderRD2DCell(ctx, x, y, cellSize, state) {
        if (state === 0) return; // Vacío, no dibujar nada

        const borders = RD2DEngine.stateToBorders(state);
        const centerX = x * cellSize + cellSize / 2;
        const centerY = y * cellSize + cellSize / 2;
        const half = cellSize / 2;

        ctx.strokeStyle = this._getStateColor(state);
        ctx.lineWidth = Math.max(2, cellSize / 4);
        ctx.lineCap = 'round';

        // Dibujar líneas en los bordes abiertos
        ctx.beginPath();

        if (borders.N) { // Norte (arriba)
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX, centerY - half + 1);
        }
        if (borders.S) { // Sur (abajo)
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX, centerY + half - 1);
        }
        if (borders.E) { // Este (derecha)
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX + half - 1, centerY);
        }
        if (borders.W) { // Oeste (izquierda)
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX - half + 1, centerY);
        }

        ctx.stroke();

        // Punto central para estados con múltiples fronteras
        if (state > 0) {
            ctx.fillStyle = ctx.strokeStyle;
            ctx.beginPath();
            ctx.arc(centerX, centerY, cellSize / 6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * Colores por "tipo" de estado (número de fronteras abiertas)
     */
    _getStateColor(state) {
        const colors = {
            0: '#000000',  // ∅ Vacío
            1: '#ef4444',  // 1 frontera: rojo brillante
            2: '#f97316',  // 2 fronteras: naranja
            3: '#eab308',  // 3 fronteras: amarillo
            4: '#22c55e',  // 4 fronteras (NSEW): verde
        };
        const count = RD2DEngine.countBorders(state);
        return colors[count] || '#94a3b8';
    }

    /**
     * Paso de generación RD-2D
     */
    step() {
        if (!this.isActive) return false;

        if (!this.automaton || !this.automaton.grid) {
            console.error('❌ RD2DEngine: Autómata no disponible');
            return false;
        }

        // Sincronizar tamaño si cambió
        if (this.automaton.gridSize !== this.gridSize) {
            this.gridSize = this.automaton.gridSize;
            this._initStateGrid();
            this.initialized = false;
        }

        // Inicialización (primera ejecución o después de reset)
        if (!this.initialized) {
            const hasUserSeed = this._checkUserSeed();

            if (hasUserSeed) {
                console.debug('🔲 RD-2D: Detectada semilla del usuario');
                this._syncFromAutomatonGrid();
            } else {
                console.debug('🔲 RD-2D: Inicializando semilla por defecto');
                this._initializeSeed();
            }

            this.initialized = true;
            this.generation = 0;
            return true;
        }

        // Calcular siguiente generación
        const size = this.gridSize;
        const newStateGrid = new Array(size);
        for (let x = 0; x < size; x++) {
            newStateGrid[x] = new Uint8Array(size);
        }

        let changed = false;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                // XOR de los 4 vecinos cardinales
                const north = this._getState(x, y - 1);
                const south = this._getState(x, y + 1);
                const east = this._getState(x + 1, y);
                const west = this._getState(x - 1, y);

                const newState = north ^ south ^ east ^ west;
                newStateGrid[x][y] = newState;

                if (newState !== this.stateGrid[x][y]) {
                    changed = true;
                }
            }
        }

        this.stateGrid = newStateGrid;
        this.generation++;

        // Sincronizar visualización
        this._syncToAutomatonGrid();

        if (!changed) {
            console.debug('🔲 RD-2D: Estado estable alcanzado');
            return false;
        }

        return true;
    }

    getInfo() {
        const aliveCells = this.stateGrid ?
            this.stateGrid.flat().filter(s => s !== 0).length : 0;

        return {
            active: this.isActive,
            generation: this.generation,
            aliveCells,
            gridSize: this.gridSize,
            states: 16,
            rule: 'XOR(N,S,E,W)'
        };
    }

    reset() {
        this.initialized = false;
        this._forceReinit = false;
        this.generation = 0;

        // Limpieza inmediata de stateGrid
        if (this.stateGrid) {
            for (let x = 0; x < this.gridSize; x++) {
                if (this.stateGrid[x]) {
                    this.stateGrid[x].fill(0);
                }
            }
        }
    }

    /**
     * Debug: Muestra estadísticas de estados en consola
     */
    _debugStateDistribution() {
        if (!this.stateGrid) return;

        const counts = new Array(16).fill(0);
        let total = 0;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const state = this.stateGrid[x]?.[y] || 0;
                counts[state]++;
                if (state !== 0) total++;
            }
        }

        console.log('=== RD-2D State Distribution ===');
        console.log('Total celdas vivas:', total);
        for (let i = 0; i < 16; i++) {
            if (counts[i] > 0) {
                const borders = RD2DEngine.stateToBorders(i);
                const borderCount = RD2DEngine.countBorders(i);
                console.log(`  Estado ${i} (${RD2DEngine.getStateName(i)}): ${counts[i]} celdas, ${borderCount} fronteras`);
            }
        }
        console.log('================================');

        return counts;
    }


    /**
     * Obtiene nombre/icono del estado
     */
    static getStateName(state) {
        const names = [
            '∅', 'E', 'W', 'EW', 'S', 'SE', 'SW', 'SEW',
            'N', 'NE', 'NW', 'NEW', 'NS', 'NSE', 'NSW', 'NSEW'
        ];
        return names[state] || '∅';
    }

    static countBorders(state) {
        let count = 0;
        for (let i = 0; i < 4; i++) {
            count += (state >> i) & 1;
        }
        return count;
    }

    static stateToBorders(state) {
        return {
            N: (state >> 3) & 1,
            S: (state >> 2) & 1,
            E: (state >> 1) & 1,
            W: state & 1
        };
    }

    /**
     * Debug: Verifica sincronización entre stateGrid y automaton.grid
     */
    _debugSyncCheck() {
        let mismatches = 0;
        const maxChecks = 100;
        const sampleX = Math.floor(Math.random() * (this.gridSize - maxChecks));
        const sampleY = Math.floor(Math.random() * (this.gridSize - maxChecks));

        for (let x = sampleX; x < sampleX + 10 && x < this.gridSize; x++) {
            for (let y = sampleY; y < sampleY + 10 && y < this.gridSize; y++) {
                const stateAlive = (this.stateGrid[x]?.[y] || 0) !== 0;
                const gridAlive = this.automaton.grid[x]?.[y] === 1;

                if (stateAlive !== gridAlive) {
                    mismatches++;
                    console.warn(`Mismatch en (${x},${y}): stateGrid=${this.stateGrid[x][y]}, grid=${this.automaton.grid[x][y]}`);
                }
            }
        }

        if (mismatches === 0) {
            console.log('✅ Sincronización OK en muestra');
        } else {
            console.error(`❌ ${mismatches} desincronizaciones encontradas`);
        }
    }
}

// Exportar global
window.RD2DEngine = RD2DEngine;