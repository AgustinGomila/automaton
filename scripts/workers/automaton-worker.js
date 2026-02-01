self.onmessage = function (e) {
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

    // Usar column-major para ser consistente con el main thread
    // El flatGrid viene como: columna X en posición [X * size .. X * size + size]
    const get = (buf, x, y) => buf[x * size + y];
    const set = (buf, x, y, val) => {
        buf[x * size + y] = val;
    };

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            // Contar vecinos
            let count = 0;
            for (let i = 0; i < neighborOffsets.length; i++) {
                const off = neighborOffsets[i];
                let nx = x + off.dx;
                let ny = y + off.dy;

                if (wrapEdges) {
                    nx = (nx + size) % size;
                    ny = (ny + size) % size;
                    if (get(flatGrid, nx, ny)) count++;
                } else {
                    if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                        if (get(flatGrid, nx, ny)) count++;
                    }
                }
            }

            const currentState = get(flatGrid, x, y) ? 1 : 0;
            const survives = rule.survival.includes(count);
            const born = rule.birth.includes(count);
            const nextState = (currentState === 1 ? survives : born) ? 1 : 0;

            set(newGridFlat, x, y, nextState);

            if (nextState !== currentState) {
                // Índice column-major
                changedCells.push(x * size + y);
            }
        }
    }

    let pop = 0;
    for (let i = 0; i < newGridFlat.length; i++) {
        if (newGridFlat[i]) pop++;
    }

    // Convertir a 2D column-major (array de columnas)
    const newGrid2D = new Array(size);
    for (let x = 0; x < size; x++) {
        const col = new Uint8Array(size);
        for (let y = 0; y < size; y++) {
            col[y] = get(newGridFlat, x, y);
        }
        newGrid2D[x] = col;
    }

    self.postMessage({
        newGrid: newGrid2D,
        changedCells,
        population: pop,
        density: ((pop / (size * size)) * 100).toFixed(1),
        generation: generation + 1
    });
};