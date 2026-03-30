/**
 * hex-worker.js — Web Worker del autómata hexagonal.
 *
 * Protocolo idéntico al de triangle-worker.js:
 *   → {type:'init', data:{width,height,birthSet,survivalSet,wrapEdges,gridBuffer}}
 *   → {type:'step'}
 *   → {type:'ping'}
 *   ← {type:'ready'}         cargado, aún sin datos
 *   ← {type:'init'}          inicializado con datos
 *   ← {type:'pong', isInitialized}
 *   ← {type:'step', result, gridBuffer, changedCells}  (Transferable)
 *   ← {type:'error', error}
 *
 * Vecindad: 6 vecinos Von Neumann hexagonales en coordenadas offset odd-r.
 * Offsets por paridad de fila (pointy-top, odd-r):
 *   fila par:   E[+1,0], NE[0,-1], NW[-1,-1], W[-1,0], SW[-1,+1], SE[0,+1]
 *   fila impar: E[+1,0], NE[+1,-1], NW[0,-1], W[-1,0], SW[0,+1], SE[+1,+1]
 *
 * Reglas B/S: tablas Uint8Array[7] (índice = número de vecinos vivos 0–6).
 */
(function () {
    'use strict';

    let grid = null;
    let newGrid = null;
    let width = 0;
    let height = 0;
    let wrapEdges = true;
    let generation = 0;
    let isInitialized = false;

    // Tablas de lookup B/S — Uint8Array[7]: 0=no nace/muere, 1=nace/sobrevive
    let birthTable = new Uint8Array(7);
    let survivalTable = new Uint8Array(7);

    // Buffer pre-allocado para celdas cambiadas (q, r intercalados)
    let changedBuf = null;

    // Offsets de vecinos por paridad de fila [dc, dr]
    // ── Inicialización ──────────────────────────────────────────────────────

    function initGrid(data) {
        width = data.width;
        height = data.height;
        wrapEdges = data.wrapEdges;
        generation = 0;

        // Construir tablas de lookup desde los arrays de regla
        birthTable.fill(0);
        survivalTable.fill(0);
        for (const n of (data.birthSet || [])) if (n >= 0 && n <= 6) birthTable[n] = 1;
        for (const n of (data.survivalSet || [])) if (n >= 0 && n <= 6) survivalTable[n] = 1;

        // Deserializar grid desde ArrayBuffer plano (column-major: col*height + row)
        grid = Array.from({length: width}, () => new Uint8Array(height));
        newGrid = Array.from({length: width}, () => new Uint8Array(height));

        if (data.gridBuffer instanceof ArrayBuffer) {
            const flat = new Uint8Array(data.gridBuffer);
            for (let c = 0; c < width; c++) {
                const offset = c * height;
                for (let r = 0; r < height; r++) {
                    grid[c][r] = flat[offset + r];
                }
            }
        }

        changedBuf = new Int32Array(width * height * 2);
        isInitialized = true;
        return {success: true, width, height};
    }

    // ── Paso de simulación — vecinos inlineados (mismo patrón que hex-engine) ─

    function step() {
        let changedCount = 0;

        if (wrapEdges) {
            for (let r = 0; r < height; r++) {
                const rU = r === 0 ? height - 1 : r - 1;
                const rD = r === height - 1 ? 0 : r + 1;
                const isOdd = (r & 1) === 1;

                for (let c = 0; c < width; c++) {
                    const cL = c === 0 ? width - 1 : c - 1;
                    const cR = c === width - 1 ? 0 : c + 1;
                    const col = grid[c];
                    const colL = grid[cL];
                    const colR = grid[cR];

                    const n = isOdd
                        ? colR[r] + colR[rU] + col[rU] + colL[r] + col[rD] + colR[rD]
                        : colR[r] + col[rU] + colL[rU] + colL[r] + colL[rD] + col[rD];

                    const cur = col[r];
                    const next = cur ? survivalTable[n] : birthTable[n];
                    newGrid[c][r] = next;

                    if (next !== cur) {
                        changedBuf[changedCount * 2] = c;
                        changedBuf[changedCount * 2 + 1] = r;
                        changedCount++;
                    }
                }
            }
        } else {
            for (let r = 0; r < height; r++) {
                const rU = r - 1;
                const rD = r + 1;
                const hasU = rU >= 0;
                const hasD = rD < height;
                const isOdd = (r & 1) === 1;

                for (let c = 0; c < width; c++) {
                    const cL = c - 1;
                    const cR = c + 1;
                    const hasL = cL >= 0;
                    const hasR = cR < width;
                    const col = grid[c];
                    const colL = hasL ? grid[cL] : null;
                    const colR = hasR ? grid[cR] : null;

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

                    const cur = col[r];
                    const next = cur ? survivalTable[n] : birthTable[n];
                    newGrid[c][r] = next;

                    if (next !== cur) {
                        changedBuf[changedCount * 2] = c;
                        changedBuf[changedCount * 2 + 1] = r;
                        changedCount++;
                    }
                }
            }
        }

        // Swap sin allocaciones
        const tmp = grid;
        grid = newGrid;
        newGrid = tmp;
        generation++;

        return {changedCount, generation, hasChanges: changedCount > 0};
    }

    // ── Serialización ───────────────────────────────────────────────────────

    function serializeGrid() {
        const buf = new ArrayBuffer(width * height);
        const flat = new Uint8Array(buf);
        for (let c = 0; c < width; c++) {
            const offset = c * height;
            for (let r = 0; r < height; r++) {
                flat[offset + r] = grid[c][r];
            }
        }
        return buf;
    }

    // ── Cola de mensajes (patrón idéntico al triangle-worker) ───────────────

    let messageQueue = [];
    let isProcessing = false;

    function processNextMessage() {
        if (isProcessing || messageQueue.length === 0) return;
        isProcessing = true;
        const {type, data} = messageQueue.shift();
        setTimeout(() => {
            try {
                processMessageSync(type, data);
            } finally {
                isProcessing = false;
                setTimeout(processNextMessage, 0);
            }
        }, 0);
    }

    function processMessageSync(type, data) {
        switch (type) {
            case 'init': {
                const result = initGrid(data);
                self.postMessage({type: 'init', result});
                break;
            }
            case 'step': {
                const stepResult = step();
                const changedCopy = new Int32Array(stepResult.changedCount * 2);
                for (let i = 0; i < stepResult.changedCount * 2; i++) {
                    changedCopy[i] = changedBuf[i];
                }
                const gridBuffer = serializeGrid();
                self.postMessage(
                    {type: 'step', result: stepResult, gridBuffer, changedCells: changedCopy.buffer},
                    [gridBuffer, changedCopy.buffer]
                );
                break;
            }
            case 'ping':
                self.postMessage({type: 'pong', isInitialized});
                break;

            case 'getInfo': {
                let population = 0;
                for (let c = 0; c < width; c++)
                    for (let r = 0; r < height; r++)
                        if (grid[c][r]) population++;
                self.postMessage({
                    type: 'info',
                    result: {width, height, generation, population, wrapEdges, isInitialized}
                });
                break;
            }
            default:
                self.postMessage({type: 'error', error: 'Unknown message: ' + type});
        }
    }

    self.onmessage = function (e) {
        messageQueue.push({type: e.data.type, data: e.data.data});
        processNextMessage();
    };

    self.postMessage({type: 'ready'});
})();