/**
 * automaton-worker.js — Worker stateful con doble buffer.
 *
 * Protocolo de mensajes:
 *   → { type: 'init',  data: { gridFlat, width, height, rule, wrapEdges, neighborOffsets } }
 *   → { type: 'step' }
 *   → { type: 'sync',  data: { gridFlat } }
 *   ← { type: 'ready' }
 *   ← { type: 'result', changedCells: ArrayBuffer, changedCount, population, generation }
 *   ← { type: 'error',  message }
 *
 * Grid: column-major. Índice plano: x * height + y.
 * Soporta grids rectangulares (width × height).
 */

'use strict';

// ─── Estado interno ───────────────────────────────────────────────────────────

let width = 0;
let height = 0;
let wrapEdges = true;
let generation = 0;

/** Doble buffer — cada columna es una Uint8Array de longitud `height`. */
let frontGrid = null;
let backGrid = null;

const birthTable = new Uint8Array(9);
const survivalTable = new Uint8Array(9);

let _changedBuf = new Uint32Array(0);
let neighborOffsets = null;
let isMoore1 = false;

// ─── Inicialización ───────────────────────────────────────────────────────────

function init(data) {
    width = data.width;
    height = data.height;
    wrapEdges = data.wrapEdges;
    generation = data.generation ?? 0;

    birthTable.fill(0);
    survivalTable.fill(0);
    for (const n of data.rule.birth) birthTable[n] = 1;
    for (const n of data.rule.survival) survivalTable[n] = 1;

    neighborOffsets = data.neighborOffsets;
    isMoore1 = data.neighborOffsets.length === 8 &&
        data.neighborOffsets.every(o => Math.abs(o.dx) <= 1 && Math.abs(o.dy) <= 1);

    // Construir grid column-major desde flatGrid (índice plano x*height+y)
    const flat = new Uint8Array(data.gridFlat);
    frontGrid = [];
    backGrid = [];
    for (let x = 0; x < width; x++) {
        frontGrid.push(new Uint8Array(height));
        backGrid.push(new Uint8Array(height));
        const base = x * height;
        for (let y = 0; y < height; y++) {
            frontGrid[x][y] = flat[base + y];
        }
    }

    _changedBuf = new Uint32Array(width * height);

    self.postMessage({type: 'ready'});
}

// ─── Sincronización tras edición manual ───────────────────────────────────────

function sync(data) {
    if (!frontGrid) return;
    const flat = new Uint8Array(data.gridFlat);
    for (let x = 0; x < width; x++) {
        const base = x * height;
        const col = frontGrid[x];
        for (let y = 0; y < height; y++) {
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
    for (let x = 0; x < width; x++) {
        const col = frontGrid[x];
        for (let y = 0; y < height; y++) {
            if (col[y]) pop++;
        }
    }

    const transferBuf = _changedBuf.buffer.slice(0, changed * 4);

    self.postMessage(
        {type: 'result', changedCells: transferBuf, changedCount: changed, population: pop, generation},
        [transferBuf]
    );
}

// ─── Fastpath Moore radio-1, wrap toroidal ────────────────────────────────────

function stepMoore1Wrap() {
    let changedCount = 0;

    for (let x = 0; x < width; x++) {
        const xm = x === 0 ? width - 1 : x - 1;
        const xp = x === width - 1 ? 0 : x + 1;
        const colM = frontGrid[xm];
        const col = frontGrid[x];
        const colP = frontGrid[xp];
        const out = backGrid[x];

        for (let y = 0; y < height; y++) {
            const ym = y === 0 ? height - 1 : y - 1;
            const yp = y === height - 1 ? 0 : y + 1;

            const n = colM[ym] + colM[y] + colM[yp]
                + col[ym] + col[yp]
                + colP[ym] + colP[y] + colP[yp];

            const cur = col[y];
            const next = cur ? survivalTable[n] : birthTable[n];
            out[y] = next;

            if (next !== cur) {
                _changedBuf[changedCount++] = x * height + y;
            }
        }
    }
    return changedCount;
}

// ─── Fastpath Moore radio-1, bordes fijos ────────────────────────────────────

function stepMoore1Bounded() {
    let changedCount = 0;

    for (let x = 0; x < width; x++) {
        const out = backGrid[x];
        for (let y = 0; y < height; y++) {
            let n = 0;
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                if (nx < 0 || nx >= width) continue;
                const ncol = frontGrid[nx];
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const ny = y + dy;
                    if (ny >= 0 && ny < height) n += ncol[ny];
                }
            }
            const cur = frontGrid[x][y];
            const next = cur ? survivalTable[n] : birthTable[n];
            out[y] = next;
            if (next !== cur) _changedBuf[changedCount++] = x * height + y;
        }
    }
    return changedCount;
}

// ─── Genérico para vecindades no-Moore-1 ─────────────────────────────────────

function stepGeneric() {
    let changedCount = 0;
    const offsets = neighborOffsets;

    for (let x = 0; x < width; x++) {
        const out = backGrid[x];
        for (let y = 0; y < height; y++) {
            let n = 0;
            for (let i = 0; i < offsets.length; i++) {
                let nx = x + offsets[i].dx;
                let ny = y + offsets[i].dy;
                if (wrapEdges) {
                    nx = ((nx % width) + width) % width;
                    ny = ((ny % height) + height) % height;
                    n += frontGrid[nx][ny];
                } else if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    n += frontGrid[nx][ny];
                }
            }
            const cur = frontGrid[x][y];
            const next = cur ? survivalTable[n] : birthTable[n];
            out[y] = next;
            if (next !== cur) _changedBuf[changedCount++] = x * height + y;
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