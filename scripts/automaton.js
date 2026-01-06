// Configuración del autómata
class CellularAutomaton {
    constructor(gridSize = 60, cellSize = 8) {
        this.gridSize = gridSize;
        this.cellSize = cellSize;
        this.grid = this.createEmptyGrid();
        this.generation = 0;
        this.isRunning = false;
        this.updateInterval = 100;
        this.intervalId = null;
        this.showGrid = true;

        // Canvas
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();

        // Estadísticas
        this.populationHistory = [];
        this.maxHistoryLength = 100;

        // Límites
        this.maxGenerations = null;
        this.maxPopulation = null;
        this.limitType = 'none'; // 'none', 'generations', 'population'
        this.limitValue = 1000;
        this.isLimitReached = false;

        // Render inicial
        setTimeout(() => this.render(), 100);
    }

    createEmptyGrid() {
        return Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(false));
    }

    resizeCanvas() {
        this.canvas.width = this.gridSize * this.cellSize;
        this.canvas.height = this.gridSize * this.cellSize;
    }

    resizeGrid(newSize) {
        this.gridSize = newSize;
        this.grid = this.createEmptyGrid();
        this.resizeCanvas();
        this.generation = 0;
        this.updateStats();
        this.render();
    }

    countNeighbors(x, y) {
        let count = 0;
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                const newX = (x + i + this.gridSize) % this.gridSize;
                const newY = (y + j + this.gridSize) % this.gridSize;
                if (this.grid[newX][newY]) count++;
            }
        }
        return count;
    }

    nextGeneration() {
        // Verificar límites antes de continuar
        if (this.checkLimits()) {
            return 0;
        }

        const newGrid = this.createEmptyGrid();
        let changes = 0;

        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                const neighbors = this.countNeighbors(x, y);
                const isAlive = this.grid[x][y];

                // Reglas de Kauffman B37/S4567
                if (isAlive) {
                    // Supervivencia: 4, 5, 6 o 7 vecinos
                    newGrid[x][y] = [4, 5, 6, 7].includes(neighbors);
                } else {
                    // Nacimiento: 3 o 7 vecinos
                    newGrid[x][y] = [3, 7].includes(neighbors);
                }

                if (newGrid[x][y] !== isAlive) changes++;
            }
        }

        this.grid = newGrid;
        this.generation++;
        this.updateStats();

        // Verificar límites después de actualizar
        this.checkLimits();

        return changes;
    }

    countPopulation() {
        let count = 0;
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y]) count++;
            }
        }
        return count;
    }

    getDensity() {
        const totalCells = this.gridSize * this.gridSize;
        const population = this.countPopulation();
        return (population / totalCells * 100).toFixed(1);
    }

    updateStats() {
        const population = this.countPopulation();
        const density = this.getDensity();

        // Actualizar histórico
        this.populationHistory.push(population);
        if (this.populationHistory.length > this.maxHistoryLength) {
            this.populationHistory.shift();
        }

        // Actualizar UI
        if (document.getElementById('generation')) {
            document.getElementById('generation').textContent = this.generation.toLocaleString();
            document.getElementById('population').textContent = population.toLocaleString();
            document.getElementById('density').textContent = `${density}%`;
        }
    }

    checkLimits() {
        if (this.limitType === 'none') {
            this.isLimitReached = false;
            return false;
        }

        if (this.limitType === 'generations' && this.maxGenerations !== null) {
            this.isLimitReached = this.generation >= this.maxGenerations;
        } else if (this.limitType === 'population' && this.maxPopulation !== null) {
            const population = this.countPopulation();
            this.isLimitReached = population >= this.maxPopulation;
        }

        if (this.isLimitReached && this.isRunning) {
            this.stop();
            this.showLimitReachedMessage();
        }

        return this.isLimitReached;
    }

    // Mostrar mensaje de límite alcanzado
    showLimitReachedMessage() {
        if (this.limitType === 'generations') {
            console.log(`Límite de generaciones alcanzado: ${this.generation}/${this.maxGenerations}`);
            // Opcional: mostrar notificación en UI
            if (document.getElementById('generation')) {
                const genEl = document.getElementById('generation');
                genEl.classList.add('limit-reached');
                setTimeout(() => genEl.classList.remove('limit-reached'), 1000);
            }
        } else if (this.limitType === 'population') {
            console.log(`Límite de población alcanzado: ${this.countPopulation()}/${this.maxPopulation}`);
            // Opcional: mostrar notificación en UI
            if (document.getElementById('population')) {
                const popEl = document.getElementById('population');
                popEl.classList.add('limit-reached');
                setTimeout(() => popEl.classList.remove('limit-reached'), 1000);
            }
        }
    }

    setLimit(type, value) {
        this.limitType = type;

        if (type === 'none') {
            this.maxGenerations = null;
            this.maxPopulation = null;
            this.isLimitReached = false;
        } else if (type === 'generations') {
            this.maxGenerations = parseInt(value);
            this.maxPopulation = null;
        } else if (type === 'population') {
            this.maxPopulation = parseInt(value);
            this.maxGenerations = null;
        }

        this.limitValue = value;
        this.isLimitReached = false;

        // Actualizar UI si está disponible
        if (document.getElementById('limitValue')) {
            document.getElementById('limitValue').value = value;
            document.getElementById('limitValueDisplay').textContent = value.toLocaleString();
        }
    }

    render() {
        // Limpiar canvas
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Dibujar cuadrícula si está habilitada
        if (this.showGrid) {
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            this.ctx.lineWidth = 1;

            // Líneas verticales
            for (let x = 0; x <= this.gridSize; x++) {
                this.ctx.beginPath();
                this.ctx.moveTo(x * this.cellSize, 0);
                this.ctx.lineTo(x * this.cellSize, this.canvas.height);
                this.ctx.stroke();
            }

            // Líneas horizontales
            for (let y = 0; y <= this.gridSize; y++) {
                this.ctx.beginPath();
                this.ctx.moveTo(0, y * this.cellSize);
                this.ctx.lineTo(this.canvas.width, y * this.cellSize);
                this.ctx.stroke();
            }
        }

        // Dibujar células
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y]) {
                    // Efecto de gradiente para células vivas
                    const gradient = this.ctx.createRadialGradient(
                        x * this.cellSize + this.cellSize / 2,
                        y * this.cellSize + this.cellSize / 2,
                        0,
                        x * this.cellSize + this.cellSize / 2,
                        y * this.cellSize + this.cellSize / 2,
                        this.cellSize / 2
                    );

                    gradient.addColorStop(0, '#10b981');
                    gradient.addColorStop(1, '#059669');

                    this.ctx.fillStyle = gradient;
                    this.ctx.fillRect(
                        x * this.cellSize + 1,
                        y * this.cellSize + 1,
                        this.cellSize - 2,
                        this.cellSize - 2
                    );

                    // Efecto de brillo
                    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                    this.ctx.fillRect(
                        x * this.cellSize + 1,
                        y * this.cellSize + 1,
                        this.cellSize - 2,
                        1
                    );
                }
            }
        }
    }

    randomize(density = 0.3) {
        this.grid = this.createEmptyGrid();
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                this.grid[x][y] = Math.random() < density;
            }
        }
        this.generation = 0;
        this.updateStats();
        this.generation = 0;
        this.isLimitReached = false;
        this.render();
    }

    clear() {
        this.grid = this.createEmptyGrid();
        this.generation = 0;
        this.isLimitReached = false;
        this.updateStats();
        this.render();
    }

    toggleCell(x, y) {
        if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
            this.grid[x][y] = !this.grid[x][y];
            this.updateStats();
            this.render();
        }
    }

    toggleRunning() {
        this.isRunning = !this.isRunning;

        if (this.isRunning) {
            this.start();
        } else {
            this.stop();
        }

        return this.isRunning;
    }

    start() {
        if (!this.intervalId) {
            this.intervalId = setInterval(() => {
                this.nextGeneration();
                this.render();
            }, this.updateInterval);
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    setSpeed(level) {
        // Convertir nivel 1-10 a intervalo (500ms a 30ms)
        const minSpeed = 500;
        const maxSpeed = 30;
        this.updateInterval = minSpeed - ((level - 1) * (minSpeed - maxSpeed) / 9);

        if (this.isRunning) {
            this.stop();
            this.start();
        }

        return this.updateInterval;
    }

    setCellSize(size) {
        this.cellSize = size;
        this.resizeCanvas();
        this.render();
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.render();
        return this.showGrid;
    }

    getCellFromMouse(e) {
        const rect = this.canvas.getBoundingClientRect();

        // Cálculo directo, sin scaling innecesario
        const x = Math.floor((e.clientX - rect.left) / this.cellSize);
        const y = Math.floor((e.clientY - rect.top) / this.cellSize);

        return {x, y};
    }

    // Asegurar que importPattern use las mismas coordenadas
    importPattern(pattern, centerX, centerY) {
        if (!pattern || !pattern.pattern) {
            console.warn('No pattern to import');
            return;
        }

        // Si el patrón es "random", generar aleatorio
        if (pattern.pattern === 'random') {
            this.randomize(0.3);
            return;
        }

        const patternData = pattern.pattern;

        // CORRECCIÓN: Usar coordenadas correctas para centrar el patrón
        const offsetX = Math.floor(patternData[0].length / 2);
        const offsetY = Math.floor(patternData.length / 2);

        // Colocar patrón - las coordenadas X,Y ya vienen correctas desde el click
        for (let row = 0; row < patternData.length; row++) {
            for (let col = 0; col < patternData[row].length; col++) {
                if (patternData[row][col] === 1) {
                    const gridX = centerX - offsetX + col;
                    const gridY = centerY - offsetY + row;

                    // Verificar límites
                    if (gridX >= 0 && gridX < this.gridSize &&
                        gridY >= 0 && gridY < this.gridSize) {
                        this.grid[gridX][gridY] = true;
                    }
                }
            }
        }

        this.updateStats();
        this.render();
    }

    exportPattern() {
        const pattern = [];
        let minX = this.gridSize, minY = this.gridSize;
        let maxX = 0, maxY = 0;

        // Encontrar límites del patrón
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                if (this.grid[x][y]) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }

        // Extraer patrón
        if (minX <= maxX && minY <= maxY) {
            for (let y = minY; y <= maxY; y++) {
                const row = [];
                for (let x = minX; x <= maxX; x++) {
                    row.push(this.grid[x][y] ? 1 : 0);
                }
                pattern.push(row);
            }

            return {
                pattern: pattern,
                name: `Patrón personalizado ${new Date().toLocaleDateString()}`,
                description: "Patrón exportado desde el autómata"
            };
        }

        return null;
    }
}

// Crear instancia global del autómata
let automaton;

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    automaton = new CellularAutomaton();
});