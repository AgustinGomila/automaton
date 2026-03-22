/**
 * automaton-worker.js — Worker stateful con doble buffer.
 *
 * Protocolo de mensajes:
 *   → { type: 'init',  data: { gridFlat, size, rule, wrapEdges, neighborOffsets } }
 *   → { type: 'step' }
 *   → { type: 'sync',  data: { gridFlat } }   — sincroniza tras edición manual
 *   ← { type: 'ready' }
 *   ← { type: 'result', changedCells: ArrayBuffer, changedCount, population, generation }
 *   ← { type: 'error',  message }
 *
 * Mejoras respecto al worker anterior:
 *   1. Stateful: el grid vive en el worker entre pasos — elimina serialización bidireccional.
 *   2. Doble buffer: swap de Uint8Array sin copias.
 *   3. Fastpath Moore-1: loop desenrollado igual que RuleEngine.nextGenerationMoore.
 *   4. Lookup table O(1) para birth/survival en lugar de Array.includes().
 *   5. changedCells como Uint32Array transferible (sin copias al devolver).
 */

'use strict';

// ─── Estado interno ───────────────────────────────────────────────────────────

let size = 0;
let wrapEdges = true;
let generation = 0;

// Doble buffer — column-major, cada columna es una Uint8Array de longitud `size`
let frontGrid = null;   // grid actual (lectura)
let backGrid = null;   // grid siguiente (escritura)

// Lookup tables para regla B/S — índice = número de vecinos (0..8)
const birthTable = new Uint8Array(9);
const survivalTable = new Uint8Array(9);

// Buffer reutilizable para índices de celdas cambiadas
let _changedBuf = new Uint32Array(0);

// Offsets de vecindad para modo no-Moore-1
let neighborOffsets = null;
let isMoore1 = false;

// ─── Inicialización ───────────────────────────────────────────────────────────

function init(data) {
    size = data.size;
    wrapEdges = data.wrapEdges;
    generation = data.generation ?? 0;

    // Tablas de regla
    birthTable.fill(0);
    survivalTable.fill(0);
    for (const n of data.rule.birth) birthTable[n] = 1;
    for (const n of data.rule.survival) survivalTable[n] = 1;

    // Vecindad
    neighborOffsets = data.neighborOffsets;
    isMoore1 = data.neighborOffsets.length === 8 &&
        data.neighborOffsets.every(o => Math.abs(o.dx) <= 1 && Math.abs(o.dy) <= 1);

    // Construir grid column-major desde flatGrid (row-major transferible)
    const flat = new Uint8Array(data.gridFlat);
    frontGrid = [];
    backGrid = [];
    for (let x = 0; x < size; x++) {
        frontGrid.push(new Uint8Array(size));
        backGrid.push(new Uint8Array(size));
        const base = x * size;
        for (let y = 0; y < size; y++) {
            frontGrid[x][y] = flat[base + y];
        }
    }

    // Buffer de cambios: máximo n² entradas
    _changedBuf = new Uint32Array(size * size);

    self.postMessage({type: 'ready'});
}

// ─── Sincronización tras edición manual ───────────────────────────────────────

function sync(data) {
    if (!frontGrid) return;
    const flat = new Uint8Array(data.gridFlat);
    for (let x = 0; x < size; x++) {
        const base = x * size;
        const col = frontGrid[x];
        for (let y = 0; y < size; y++) {
            col[y] = flat[base + y];
        }
    }
}

// ─── Paso de simulación ───────────────────────────────────────────────────────

function step() {
    if (!frontGrid) return;

    const changed = isMoore1 && wrapEdges
        ? stepMoore1Wrap()
        : isMoore1
            ? stepMoore1Bounded()
            : stepGeneric();

    // Swap buffers
    const tmp = frontGrid;
    frontGrid = backGrid;
    backGrid = tmp;

    generation++;

    // Calcular población
    let pop = 0;
    for (let x = 0; x < size; x++) {
        const col = frontGrid[x];
        for (let y = 0; y < size; y++) {
            if (col[y]) pop++;
        }
    }

    // Transferir changedCells sin copia: slice del buffer reutilizable
    const transferBuf = _changedBuf.buffer.slice(0, changed * 4);

    self.postMessage(
        {type: 'result', changedCells: transferBuf, changedCount: changed, population: pop, generation},
        [transferBuf]
    );
}

// Fastpath Moore radio-1, wrap toroidal
function stepMoore1Wrap() {
    let changedCount = 0;

    for (let x = 0; x < size; x++) {
        const xm = x === 0 ? size - 1 : x - 1;
        const xp = x === size - 1 ? 0 : x + 1;
        const colM = frontGrid[xm];
        const col = frontGrid[x];
        const colP = frontGrid[xp];
        const out = backGrid[x];

        for (let y = 0; y < size; y++) {
            const ym = y === 0 ? size - 1 : y - 1;
            const yp = y === size - 1 ? 0 : y + 1;

            const n = colM[ym] + colM[y] + colM[yp]
                + col[ym] + col[yp]
                + colP[ym] + colP[y] + colP[yp];

            const cur = col[y];
            const next = cur ? survivalTable[n] : birthTable[n];
            out[y] = next;

            if (next !== cur) {
                _changedBuf[changedCount++] = x * size + y;
            }
        }
    }
    return changedCount;
}

// Fastpath Moore radio-1, bordes fijos
function stepMoore1Bounded() {
    let changedCount = 0;

    for (let x = 0; x < size; x++) {
        const out = backGrid[x];
        for (let y = 0; y < size; y++) {
            let n = 0;
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                if (nx < 0 || nx >= size) continue;
                const ncol = frontGrid[nx];
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const ny = y + dy;
                    if (ny >= 0 && ny < size) n += ncol[ny];
                }
            }
            const cur = frontGrid[x][y];
            const next = cur ? survivalTable[n] : birthTable[n];
            out[y] = next;
            if (next !== cur) _changedBuf[changedCount++] = x * size + y;
        }
    }
    return changedCount;
}

// Camino genérico para vecindades no-Moore-1
function stepGeneric() {
    let changedCount = 0;
    const offsets = neighborOffsets;

    for (let x = 0; x < size; x++) {
        const out = backGrid[x];
        for (let y = 0; y < size; y++) {
            let n = 0;
            for (let i = 0; i < offsets.length; i++) {
                let nx = x + offsets[i].dx;
                let ny = y + offsets[i].dy;
                if (wrapEdges) {
                    nx = ((nx % size) + size) % size;
                    ny = ((ny % size) + size) % size;
                    n += frontGrid[nx][ny];
                } else if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                    n += frontGrid[nx][ny];
                }
            }
            const cur = frontGrid[x][y];
            const next = cur ? survivalTable[n] : birthTable[n];
            out[y] = next;
            if (next !== cur) _changedBuf[changedCount++] = x * size + y;
        }
    }
    return changedCount;
}

// ─── Dispatcher de mensajes ───────────────────────────────────────────────────

self.onmessage = function (e) {
    try {
        const {type, data} = e.data;
        if (type === 'init') init(data);
        else if (type === 'step') step();
        else if (type === 'sync') sync(data);
        else self.postMessage({type: 'error', message: `Unknown type: ${type}`});
    } catch (err) {
        self.postMessage({type: 'error', message: err.message});
    }
};