/**
 * DrawingTool — Herramientas de dibujo sobre el grid celular.
 *
 * Responsabilidades:
 *   - Dibujo continuo con interpolación Bresenham entre celdas
 *   - Flood fill (bote de pintura) con BFS iterativo
 *
 * Recibe el automaton por referencia directa para acceder al grid, el
 * renderer y los engines activos. El estado de modificadores de teclado
 * (ctrlPressed) se lee desde CanvasController vía la referencia pasada
 * al constructor.
 */
class DrawingTool {

    /**
     * @param {Object}   options
     * @param {Object}   options.automaton      — instancia de CellularAutomaton
     * @param {Function} options.getCtrlPressed — () => boolean
     */
    constructor({automaton, getCtrlPressed}) {
        this.automaton = automaton;
        this._getCtrl = getCtrlPressed;
        this.lastCell = null;   // {x, y} de la última celda dibujada (pincel continuo)
    }

    // =========================================
    // DIBUJO CONTINUO (pincel)
    // =========================================

    /**
     * Dibuja interpolando en línea recta desde la última posición hasta (x, y).
     * Llamado en cada mousemove mientras el botón izquierdo está presionado.
     *
     * @param {number} x
     * @param {number} y
     */
    handleContinuousDrawing(x, y) {
        const maxX = this.automaton.gridWidth - 1;
        const maxY = this.automaton.gridHeight - 1;
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));

        if (!this.lastCell || (this.lastCell.x === x && this.lastCell.y === y)) {
            this.lastCell = {x, y};
            return;
        }

        const cells = this._getLineCells(this.lastCell.x, this.lastCell.y, x, y);
        let needsRender = false;

        for (const cell of cells) {
            if (cell.x === this.lastCell.x && cell.y === this.lastCell.y) continue;
            const changed = this.automaton.setCell(cell.x, cell.y, !this._getCtrl());
            if (changed) needsRender = true;
        }

        this.lastCell = {x, y};

        if (needsRender) {
            this.automaton.updateStats();
            this.automaton.render();
        }
    }

    /**
     * Algoritmo de Bresenham: devuelve todas las celdas del segmento (x0,y0)→(x1,y1).
     * Incluye los extremos. Corta el recorrido si supera gridWidth×2 celdas
     * para evitar loops en casos degenerados.
     *
     * @param {number} x0
     * @param {number} y0
     * @param {number} x1
     * @param {number} y1
     * @returns {{x: number, y: number}[]}
     */
    _getLineCells(x0, y0, x1, y1) {
        const cells = [];
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        const maxW = this.automaton.gridWidth;
        const maxH = this.automaton.gridHeight;
        let err = dx - dy;

        while (true) {
            if (x0 >= 0 && x0 < maxW && y0 >= 0 && y0 < maxH) {
                cells.push({x: x0, y: y0});
            }
            if (x0 === x1 && y0 === y1) break;

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }

            if (cells.length > maxW * 2) break;
        }

        return cells;
    }

    // =========================================
    // FLOOD FILL (bote de pintura)
    // =========================================

    /**
     * BFS iterativo desde (startX, startY).
     * Rellena todas las celdas contiguas (vecindad Von Neumann) con el mismo
     * estado que la celda origen, cambiándolas a `fillState`.
     * Respeta bordes del grid (no toroidal).
     *
     * Maneja los estados especiales de RD2D, Generations y Langton
     * actualizando los grids internos de cada engine cuando está activo.
     *
     * @param {number} startX
     * @param {number} startY
     * @param {number} fillState — 0 (limpiar) o 1 (llenar)
     */
    floodFill(startX, startY, fillState) {
        const gw = this.automaton.gridWidth;
        const gh = this.automaton.gridHeight;

        const langton = this.automaton.specialMode === SpecialEngineManager.MODES.LANGTON
            && this.automaton.langtonEngine?.isActive;
        const rd2d = this.automaton.specialMode === SpecialEngineManager.MODES.RD2D
            && this.automaton.rd2dEngine?.isActive;
        const generations = this.automaton.specialMode === SpecialEngineManager.MODES.GENERATIONS
            && this.automaton.generationsEngine?.isActive;

        const rd2dStateGrid = rd2d ? this.automaton.rd2dEngine.stateGrid : null;
        const genStateGrid = generations ? this.automaton.generationsEngine.stateGrid : null;

        const getState = (gx, gy) => this.automaton.grid[gx]?.[gy] ?? 0;

        const targetState = getState(startX, startY);
        if (targetState === fillState) return;

        // Índice plano column-major: x * gh + y
        const visited = new Uint8Array(gw * gh);
        const queue = [startX * gh + startY];
        let head = 0;
        visited[queue[0]] = 1;

        while (head < queue.length) {
            const idx = queue[head++];
            const x = (idx / gh) | 0;
            const y = idx % gh;

            // Escribir estado según engine activo
            if (rd2d) {
                rd2dStateGrid[x][y] = fillState === 1 ? 15 : 0;
                this.automaton.grid[x][y] = fillState;
            } else if (generations) {
                genStateGrid[x][y] = fillState ? 1 : 0;
                this.automaton.grid[x][y] = fillState;
            } else {
                this.automaton.grid[x][y] = fillState;
            }
            this.automaton.renderer.markDirtyIndex(idx);

            // Langton: sincronizar hormiga vía API del engine
            if (langton) {
                if (fillState === 1) {
                    this.automaton.langtonEngine.addAnt(x, y, 0);
                } else {
                    this.automaton.eraseEngineAt(x, y);
                }
            }

            // Vecindad Von Neumann: N, S, E, W
            const neighbors = [
                x - 1 >= 0 ? (x - 1) * gh + y : -1,
                x + 1 < gw ? (x + 1) * gh + y : -1,
                y - 1 >= 0 ? x * gh + (y - 1) : -1,
                y + 1 < gh ? x * gh + (y + 1) : -1,
            ];

            for (const ni of neighbors) {
                if (ni < 0) continue;
                const nx = (ni / gh) | 0;
                const ny = ni % gh;
                if (!visited[ni] && getState(nx, ny) === targetState) {
                    visited[ni] = 1;
                    queue.push(ni);
                }
            }
        }

        if (head > 0) {
            this.automaton.updateStats();
            this.automaton.syncEngineAfterEdit();
            this.automaton.render();
        }
    }
}

window.DrawingTool = DrawingTool;