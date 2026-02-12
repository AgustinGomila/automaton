self.onmessage = function (e) {
    try {
        const {
            grid: flatGrid,
            gridSize,
            rule,
            wrapEdges,
            neighborhoodType,
            neighborhoodRadius,
            neighborOffsets,
            generation
        } = e.data;

        const size = gridSize;
        const newGridFlat = new Uint8Array(size * size);
        const changedCells = [];

        // Funciones de acceso column-major
        const getCell = (buf, x, y) => {
            const idx = x * size + y;
            return idx < buf.length ? buf[idx] : 0;
        };

        const setCell = (buf, x, y, val) => {
            const idx = x * size + y;
            if (idx < buf.length) {
                buf[idx] = val;
            }
        };

        // Procesar cada celda
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                // Contar vecinos
                let count = 0;

                for (let i = 0; i < neighborOffsets.length; i++) {
                    const off = neighborOffsets[i];
                    let nx = x + off.dx;
                    let ny = y + off.dy;

                    if (wrapEdges) {
                        nx = ((nx % size) + size) % size;
                        ny = ((ny % size) + size) % size;
                        count += getCell(flatGrid, nx, ny);
                    } else {
                        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                            count += getCell(flatGrid, nx, ny);
                        }
                    }
                }

                const currentState = getCell(flatGrid, x, y);
                const survives = rule.survival.includes(count);
                const born = rule.birth.includes(count);
                const nextState = (currentState === 1 ? survives : born) ? 1 : 0;

                setCell(newGridFlat, x, y, nextState);

                if (nextState !== currentState) {
                    changedCells.push(x * size + y);
                }
            }
        }

        // Calcular población
        let pop = 0;
        for (let i = 0; i < newGridFlat.length; i++) {
            if (newGridFlat[i]) pop++;
        }

        // Convertir a formato 2D (array de columnas)
        const newGrid2D = [];
        for (let x = 0; x < size; x++) {
            const col = new Uint8Array(size);
            const baseIdx = x * size;
            for (let y = 0; y < size; y++) {
                col[y] = newGridFlat[baseIdx + y];
            }
            newGrid2D.push(col);
        }

        self.postMessage({
            newGrid: newGrid2D,
            changedCells,
            population: pop,
            density: ((pop / (size * size)) * 100).toFixed(1),
            generation: generation + 1
        });

    } catch (error) {
        self.postMessage({
            error: error.message,
            stack: error.stack
        });
    }
};