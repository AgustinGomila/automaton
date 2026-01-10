self.onmessage = function (e) {
    const {
        grid,
        gridSize,
        rule,
        wrapEdges,
        neighborhoodType,
        neighborhoodRadius,
        neighborOffsets,
        generation
    } = e.data;

    // Clonar grid
    const newGrid = grid.map(row => [...row]);
    const changedCells = [];

    // Clonar para dirty tracking
    const prevGrid = grid.map(row => [...row]);

    // Calcular nueva generación
    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            const neighbors = countNeighbors(x, y, grid, gridSize, wrapEdges, neighborOffsets);
            const isAlive = grid[x][y];
            const willBeAlive = isAlive
                ? rule.survival.includes(neighbors)
                : rule.birth.includes(neighbors);

            newGrid[x][y] = willBeAlive;

            if (willBeAlive !== isAlive) {
                changedCells.push({x, y});
            }
        }
    }

    // Calcular población
    let population = 0;
    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            if (newGrid[x][y]) population++;
        }
    }

    const density = (population / (gridSize * gridSize) * 100).toFixed(1);

    // Enviar resultado (usando transferibles si es posible)
    self.postMessage({
        newGrid,
        changedCells,
        population,
        density,
        generation: generation + 1
    });
};

// Función de conteo de vecinos
function countNeighbors(x, y, grid, size, wrapEdges, offsets) {
    let count = 0;

    for (const {dx, dy} of offsets) {
        let nx = x + dx;
        let ny = y + dy;

        if (wrapEdges) {
            nx = (nx + size) % size;
            ny = (ny + size) % size;
            if (grid[nx][ny]) count++;
        } else {
            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                if (grid[nx][ny]) count++;
            }
        }
    }

    return count;
}