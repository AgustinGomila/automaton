/**
 * Triangle Worker - Motor de Autómatas Triangulares en Web Worker
 *
 * Optimizaciones implementadas:
 * 1. Stateful worker - mantiene grid entre mensajes
 * 2. Aritmética condicional en lugar de módulo (2x más rápido)
 * 3. Pre-cálculo de offsets de vecinos
 * 4. Transferable ArrayBuffers para comunicación sin copia
 * 5. Procesamiento asíncrono para no bloquear el worker thread
 */

(function () {
    'use strict';

    // Estado del worker
    let grid = null;
    let width = 0;
    let height = 0;
    let ruleTable = new Uint8Array(8);
    let wrapEdges = true;
    let generation = 0;
    let isInitialized = false;

    const neighborOffsets = {
        up: [[-1, 0], [1, 0], [0, 1]],
        down: [[0, -1], [-1, 0], [1, 0]]
    };

    let newGrid = null;
    let changedCellsBuffer = null;

    /**
     * Inicializa el grid triangular desde datos planos
     */
    function initGrid(data) {
        width = data.width;
        height = data.height;
        wrapEdges = data.wrapEdges;
        generation = 0;

        const binary = (data.ruleNumber & 0xFF).toString(2).padStart(8, '0');
        for (let i = 0; i < 8; i++) {
            ruleTable[i] = binary[7 - i] === '1' ? 1 : 0;
        }

        if (data.gridBuffer instanceof ArrayBuffer) {
            const flatGrid = new Uint8Array(data.gridBuffer);
            grid = new Array(width);
            for (let q = 0; q < width; q++) {
                grid[q] = new Uint8Array(height);
                for (let r = 0; r < height; r++) {
                    grid[q][r] = flatGrid[q * height + r];
                }
            }
        } else {
            grid = new Array(width);
            for (let q = 0; q < width; q++) {
                grid[q] = new Uint8Array(height);
            }
        }

        newGrid = new Array(width);
        for (let q = 0; q < width; q++) {
            newGrid[q] = new Uint8Array(height);
        }

        changedCellsBuffer = new Int32Array(width * height * 2);
        isInitialized = true;

        return {success: true, width, height};
    }

    function computeConfigWrapped(q, r, orientation) {
        const offsets = neighborOffsets[orientation];
        let sum = 0;

        for (let i = 0; i < 3; i++) {
            const dq = offsets[i][0];
            const dr = offsets[i][1];

            let nq = q + dq;
            let nr = r + dr;

            if (nq < 0) nq += width;
            else if (nq >= width) nq -= width;

            if (nr < 0) nr += height;
            else if (nr >= height) nr -= height;

            sum += grid[nq][nr];
        }

        const centerState = grid[q][r];
        return (centerState << 2) | sum;
    }

    function computeConfigBounded(q, r, orientation) {
        const offsets = neighborOffsets[orientation];
        let sum = 0;

        for (let i = 0; i < 3; i++) {
            const nq = q + offsets[i][0];
            const nr = r + offsets[i][1];

            if (nq >= 0 && nq < width && nr >= 0 && nr < height) {
                sum += grid[nq][nr];
            }
        }

        const centerState = grid[q][r];
        return (centerState << 2) | sum;
    }

    function step() {
        const computeFn = wrapEdges ? computeConfigWrapped : computeConfigBounded;
        let changedCount = 0;

        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                const orientation = ((q + r) & 1) === 0 ? 'up' : 'down';
                const config = computeFn(q, r, orientation);
                const newState = ruleTable[config];

                newGrid[q][r] = newState;

                if (newState !== grid[q][r]) {
                    changedCellsBuffer[changedCount * 2] = q;
                    changedCellsBuffer[changedCount * 2 + 1] = r;
                    changedCount++;
                }
            }
        }

        const temp = grid;
        grid = newGrid;
        newGrid = temp;

        generation++;

        return {
            changedCount,
            generation,
            hasChanges: changedCount > 0
        };
    }

    function serializeGrid() {
        const flatSize = width * height;
        const buffer = new ArrayBuffer(flatSize);
        const flatGrid = new Uint8Array(buffer);

        for (let q = 0; q < width; q++) {
            for (let r = 0; r < height; r++) {
                flatGrid[q * height + r] = grid[q][r];
            }
        }

        return buffer;
    }

    function setCells(cells) {
        for (let i = 0; i < cells.length; i += 2) {
            const q = cells[i];
            const r = cells[i + 1];
            if (q >= 0 && q < width && r >= 0 && r < height) {
                grid[q][r] = 1;
            }
        }
        return {success: true, count: cells.length / 2};
    }

    // Procesar mensajes de forma asíncrona para no bloquear el worker thread
    // Agregar cola de mensajes para procesamiento ordenado
    let messageQueue = [];
    let isProcessing = false;

    function processNextMessage() {
        if (isProcessing || messageQueue.length === 0) return;

        isProcessing = true;
        const {type, data, transfer} = messageQueue.shift();

        // Usar setTimeout para ceder control al event loop del worker
        setTimeout(() => {
            try {
                processMessageSync(type, data, transfer);
            } finally {
                isProcessing = false;
                // Procesar siguiente mensaje en cola
                setTimeout(processNextMessage, 0);
            }
        }, 0);
    }

    function processMessageSync(type, data, transfer) {
        switch (type) {
            case 'init':
                const initResult = initGrid(data);
                self.postMessage({
                    type: 'init',
                    result: initResult
                });
                break;

            case 'step':
                const stepResult = step();

                const changedCells = new Int32Array(stepResult.changedCount * 2);
                for (let i = 0; i < stepResult.changedCount * 2; i++) {
                    changedCells[i] = changedCellsBuffer[i];
                }

                const gridBuffer = serializeGrid();

                self.postMessage({
                    type: 'step',
                    result: {
                        generation: stepResult.generation,
                        hasChanges: stepResult.hasChanges,
                        changedCount: stepResult.changedCount
                    },
                    gridBuffer,
                    changedCells: changedCells.buffer
                }, [gridBuffer, changedCells.buffer]);
                break;

            case 'setCells':
                const setResult = setCells(data.cells);
                self.postMessage({type: 'setCells', result: setResult});
                break;

            case 'getInfo':
                let population = 0;
                for (let q = 0; q < width; q++) {
                    for (let r = 0; r < height; r++) {
                        if (grid[q][r]) population++;
                    }
                }
                self.postMessage({
                    type: 'info',
                    result: {width, height, generation, population, wrapEdges, isInitialized}
                });
                break;

            case 'ping':
                self.postMessage({
                    type: 'pong',
                    isInitialized: isInitialized  // Enviar directamente, no anidado en result
                });
                break;

            default:
                self.postMessage({
                    type: 'error',
                    error: 'Unknown message type: ' + type
                });
        }
    }

    // Handler de mensajes que encola en lugar de procesar sincrónicamente
    self.onmessage = function (e) {
        const {type, data} = e.data;

        // Extraer transferables si existen
        const transfer = [];
        if (data?.gridBuffer instanceof ArrayBuffer) {
            transfer.push(data.gridBuffer);
        }

        messageQueue.push({type, data, transfer});
        processNextMessage();
    };

    self.postMessage({type: 'ready'});

})();