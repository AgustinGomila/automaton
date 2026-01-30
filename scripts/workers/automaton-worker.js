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
    const changedCells = []; // Índices: y * size + x

    // Helpers
    const get = (buf, x, y) => buf[y * size + x];
    const set = (buf, x, y, val) => {
        buf[y * size + x] = val;
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
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

            // Normalizar explícitamente a 0/1
            const currentState = get(flatGrid, x, y) ? 1 : 0;
            const survives = rule.survival.includes(count);
            const born = rule.birth.includes(count);
            const nextState = (currentState === 1 ? survives : born) ? 1 : 0;

            set(newGridFlat, x, y, nextState);

            // Comparar números puros (no booleanos)
            if (nextState !== currentState) {
                changedCells.push(y * size + x);
            }
        }
    }

    let pop = 0;
    for (let i = 0; i < newGridFlat.length; i++) {
        if (newGridFlat[i]) pop++;
    }

    // Convertir a 2D row-major
    const newGrid2D = new Array(size);
    for (let y = 0; y < size; y++) {
        const row = new Uint8Array(size);
        for (let x = 0; x < size; x++) {
            row[x] = get(newGridFlat, x, y);
        }
        newGrid2D[y] = row;
    }

    // Enviar resultado (usando transferibles si es posible)
    self.postMessage({
        newGrid: newGrid2D,
        changedCells,
        population: pop,
        density: ((pop / (size * size)) * 100).toFixed(1),
        generation: generation + 1
    });
};