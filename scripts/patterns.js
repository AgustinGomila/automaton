// Definición de patrones predefinidos
const PATTERNS = {
    pattern1: {
        name: "I",
        description: "---",
        color: "#0666d4",
        pattern: [
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ]
    },
    pattern2: {
        name: "II",
        description: "---",
        color: "#8b5cf6",
        pattern: [
            [1, 1, 0],
            [1, 1, 1],
            [0, 1, 1],
        ]
    },
    pattern3: {
        name: "III",
        description: "Cruz simple de 5 células",
        color: "#f5bb0b",
        pattern: [
            [0, 1, 0],
            [1, 1, 1],
            [0, 1, 0]
        ]
    },
    pattern4: {
        name: "IV",
        description: "---",
        color: "#f59e0b",
        pattern: [
            [1, 0, 0, 0],
            [0, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 0, 1, 1]
        ]
    },
    pattern5: {
        name: "V",
        description: "---",
        color: "#d45506",
        pattern: [
            [0, 1, 1, 1, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 1, 0, 0],
        ]
    },
    pattern6: {
        name: "VI",
        description: "---",
        color: "#06b6d4",
        pattern: [
            [1, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 1, 1, 1],
            [0, 0, 0, 1],
        ]
    },
    pattern7: {
        name: "VII",
        description: "---",
        color: "#3b82f6",
        pattern: [
            [0, 1, 0, 1, 0],
            [1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1],
            [0, 1, 0, 1, 0]
        ]
    },
    pattern8: {
        name: "VIII",
        description: "---",
        color: "#ef4444",
        pattern: [
            [0, 0, 0, 1, 0],
            [1, 1, 1, 0, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 0, 1, 0],
        ]
    },
    pattern9: {
        name: "IX",
        description: "---",
        color: "#f50b49",
        pattern: [
            [0, 0, 1, 1, 0],
            [0, 1, 1, 1, 0],
            [0, 1, 1, 1, 1],
            [1, 0, 0, 1, 0],
        ]
    },
    pattern10: {
        name: "X",
        description: "---",
        color: "#3b82f6",
        pattern: [
            [0, 0, 0, 1, 0],
            [0, 0, 0, 1, 1],
            [1, 1, 1, 1, 1],
            [0, 1, 1, 0, 1],
            [0, 1, 0, 0, 0]
        ]
    },
    pattern11: {
        name: "XI",
        description: "---",
        color: "#f5bb0b",
        pattern: [
            [1, 1, 1, 1, 0],
            [1, 1, 1, 1, 0],
            [1, 1, 0, 1, 1],
            [1, 1, 1, 0, 0],
            [0, 0, 1, 0, 0]
        ]
    },
    pattern12: {
        name: "XII",
        description: "---",
        color: "#63d406",
        pattern: [
            [1, 0, 0, 0, 0],
            [1, 1, 0, 0, 0],
            [0, 1, 1, 0, 0],
            [0, 0, 1, 1, 0],
            [0, 0, 0, 1, 1],
            [0, 0, 0, 0, 1],
        ]
    },
    pattern13: {
        name: "XIII",
        description: "---",
        color: "#10b981",
        pattern: [
            [0, 1, 0, 0, 0, 1, 0],
            [1, 1, 1, 1, 1, 1, 1],
            [0, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 0, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 0],
            [1, 1, 1, 1, 1, 1, 1],
            [0, 1, 0, 0, 0, 1, 0]
        ]
    },
    pattern14: {
        name: "XIV",
        description: "---",
        color: "#d4069a",
        pattern: [
            [0, 1, 0, 0, 0, 0, 0],
            [1, 1, 1, 1, 1, 0, 0],
            [0, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 0, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 0],
            [0, 0, 1, 1, 1, 1, 1],
            [0, 0, 0, 0, 0, 1, 0]
        ]
    },
    pattern15: {
        name: "XV",
        description: "---",
        color: "#d44e06",
        pattern: [
            [0, 0, 0, 0, 0, 1, 0, 0],
            [0, 1, 1, 1, 1, 1, 1, 0],
            [1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 0, 0, 1, 1, 0],
            [0, 1, 1, 0, 0, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1],
            [0, 1, 1, 1, 1, 1, 1, 0],
            [0, 0, 1, 0, 0, 0, 0, 0]
        ]
    },
    pattern16: {
        name: "XVI",
        description: "---",
        color: "#d4b906",
        pattern: [
            [0, 0, 0, 0, 1, 0, 0, 0, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [1, 0, 0, 1, 0, 1, 0, 0, 1],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0]
        ]
    },
    pattern17: {
        name: "XVII",
        description: "---",
        color: "#0636d4",
        pattern: [
            [0, 0, 0, 0, 1, 0, 0, 0, 0],
            [0, 1, 1, 1, 0, 1, 1, 1, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [1, 1, 0, 1, 0, 1, 0, 1, 1],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 0, 1, 1, 1, 0, 1, 0],
            [0, 1, 1, 1, 0, 1, 1, 1, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0]
        ]
    },
    pattern18: {
        name: "XVIII",
        description: "---",
        color: "#d406ab",
        pattern: [
            [0, 0, 0, 0, 1, 0, 0, 0, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [1, 0, 0, 1, 0, 1, 0, 0, 1],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 1, 1, 1, 1, 1, 1, 1, 0],
            [0, 0, 1, 1, 0, 1, 1, 0, 0],
            [0, 0, 0, 0, 1, 0, 0, 0, 0]
        ]
    },
    pattern19: {
        name: "XIX",
        description: "---",
        color: "#06d42f",
        pattern: [
            [0, 0, 0, 1, 0, 1, 0, 0, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 1, 0, 1, 0, 1, 0, 1, 0],
            [1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1, 1, 1, 1, 1],
            [0, 1, 0, 1, 0, 1, 0, 1, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 0, 1, 1, 1, 1, 1, 0, 0],
            [0, 0, 0, 1, 0, 1, 0, 0, 0]
        ]
    },
    random: {
        name: "Aleatorio",
        description: "aleatorio con densidad ~30%",
        color: "#8b5cf6",
        pattern: "random" // Especial: indica que debe generarse aleatoriamente
    },
};

// Función para rotar una matriz 90° en sentido horario
function rotateMatrix(matrix) {
    if (!matrix || matrix === 'random') return matrix;

    const rows = matrix.length;
    const cols = matrix[0].length;
    const rotated = [];

    for (let col = 0; col < cols; col++) {
        const newRow = [];
        for (let row = rows - 1; row >= 0; row--) {
            newRow.push(matrix[row][col]);
        }
        rotated.push(newRow);
    }

    return rotated;
}

// Función para obtener patrón con rotación aplicada
function getPatternWithRotation(patternKey, rotation = 0) {
    if (!PATTERNS[patternKey]) return null;

    const original = PATTERNS[patternKey];

    // Si es random o rotación 0, devolver original
    if (original.pattern === 'random' || rotation === 0) {
        return {
            name: original.name,
            description: original.description,
            color: original.color,
            pattern: original.pattern,
            rotation: 0
        };
    }

    // Aplicar rotaciones sucesivas
    let rotatedPattern = original.pattern;
    const rotations = rotation / 90;

    for (let i = 0; i < rotations; i++) {
        rotatedPattern = rotateMatrix(rotatedPattern);
    }

    return {
        name: original.name,
        description: original.description,
        color: original.color,
        pattern: rotatedPattern,
        rotation: rotation
    };
}

// Variables globales para estado
window.selectedPatternKey = null;
window.selectedPatternRotation = 0;

function renderPatterns() {
    const container = document.getElementById('patternsContainer');
    if (!container) return;

    container.innerHTML = '';

    const patternOrder = [
        'pattern1', 'pattern2', 'pattern3', 'pattern4',
        'pattern5', 'pattern6', 'pattern7', 'pattern8',
        'pattern9', 'pattern10', 'pattern11', 'pattern12',
        'pattern13', 'pattern14', 'pattern15', 'pattern16',
        'pattern17', 'pattern18', 'pattern19',
        'random'];

    patternOrder.forEach(key => {
        if (!PATTERNS[key]) return;

        const pattern = PATTERNS[key];
        const patternBtn = document.createElement('button');
        patternBtn.className = 'pattern-btn-horizontal';
        patternBtn.dataset.patternKey = key;
        patternBtn.title = `${pattern.name}: ${pattern.description}\nClic derecho para rotar`;

        // Miniatura
        const thumbnail = document.createElement('div');
        thumbnail.className = 'pattern-thumb';

        if (pattern.pattern === 'random') {
            thumbnail.innerHTML = '🎲';
            thumbnail.style.fontSize = '1.5rem';
            thumbnail.style.color = '#8b5cf6';
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = 40;
            canvas.height = 40;
            canvas.className = 'pattern-canvas-horizontal';
            const ctx = canvas.getContext('2d');
            renderPatternToCanvas(ctx, pattern.pattern, pattern.color);
            thumbnail.appendChild(canvas);
        }

        // Etiqueta
        const label = document.createElement('div');
        label.className = 'pattern-label';
        label.textContent = pattern.name;

        patternBtn.appendChild(thumbnail);
        patternBtn.appendChild(label);

        // Clic izquierdo - seleccionar
        patternBtn.addEventListener('click', (e) => {
            if (e.button !== 0) return; // Solo clic izquierdo

            e.preventDefault();
            e.stopPropagation();

            // Deseleccionar todos
            document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
                btn.classList.remove('active');
            });

            // Seleccionar este
            patternBtn.classList.add('active');

            // Resetear rotación al seleccionar nuevo patrón
            selectedPatternRotation = 0;
            selectedPatternKey = key;

            // Actualizar vista previa
            updatePatternInfo();
        });

        // Clic derecho - rotar
        patternBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Solo rotar si es el patrón seleccionado
            if (patternBtn.classList.contains('active') && pattern.pattern !== 'random') {
                selectedPatternRotation = (selectedPatternRotation + 90) % 360;

                // Actualizar miniatura
                const canvas = thumbnail.querySelector('canvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, 40, 40);
                    const rotatedPattern = getPatternWithRotation(key, selectedPatternRotation);
                    renderPatternToCanvas(ctx, rotatedPattern.pattern, pattern.color);
                }

                // Actualizar info
                updatePatternInfo();
            }

            return false;
        });

        container.appendChild(patternBtn);
    });

    // Seleccionar primer patrón por defecto
    const firstBtn = container.querySelector('.pattern-btn-horizontal');
    if (firstBtn) {
        selectedPatternKey = firstBtn.dataset.patternKey;
        firstBtn.click();
    }
}

function renderPatternToCanvas(ctx, patternData, color) {
    if (!patternData || patternData === 'random') return;

    // Fondo
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 40, 40);

    const rows = patternData.length;
    const cols = patternData[0].length;

    // Tamaño de celda
    const maxDim = Math.max(rows, cols);
    const cellSize = Math.min(30 / maxDim, 5);

    // Centrar
    const offsetX = (40 - cols * cellSize) / 2;
    const offsetY = (40 - rows * cellSize) / 2;

    // Color
    ctx.fillStyle = color || '#10b981';

    // Dibujar
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (patternData[row][col] === 1) {
                ctx.fillRect(
                    offsetX + col * cellSize,
                    offsetY + row * cellSize,
                    cellSize,
                    cellSize
                );
            }
        }
    }
}

function updatePatternInfo() {
    const pattern = getPatternWithRotation(selectedPatternKey, selectedPatternRotation);
    const miniEl = document.getElementById('patternNameMini');

    if (miniEl && pattern) {
        const rotationText = selectedPatternRotation > 0 ? ` (${selectedPatternRotation}°)` : '';
        miniEl.textContent = `${pattern.name}${rotationText}`;
    }

    // Actualizar patrón seleccionado globalmente
    window.selectedPattern = pattern;
}

function showPatternPreview(x, y) {
    const preview = document.getElementById('patternPreview');
    const pattern = window.selectedPattern; // Ya incluye rotación

    if (!pattern || !pattern.pattern || pattern.pattern === 'random') {
        preview.style.display = 'none';
        return;
    }

    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    const cellSize = parseInt(document.getElementById('cellSize').value) || 8;

    const patternData = pattern.pattern;
    const offsetX = Math.floor(patternData[0].length / 2);
    const offsetY = Math.floor(patternData.length / 2);

    preview.innerHTML = '';
    preview.style.position = 'absolute';
    preview.style.left = '10px';
    preview.style.top = '10px';
    preview.style.width = canvas.width + 'px';
    preview.style.height = canvas.height + 'px';
    preview.style.display = 'block';
    preview.style.pointerEvents = 'none';

    for (let row = 0; row < patternData.length; row++) {
        for (let col = 0; col < patternData[row].length; col++) {
            if (patternData[row][col] === 1) {
                const gridX = x - offsetX + col;
                const gridY = y - offsetY + row;

                const cell = document.createElement('div');
                cell.className = 'pattern-preview-cell';
                cell.style.position = 'absolute';
                cell.style.left = (gridX * cellSize) + 'px';
                cell.style.top = (gridY * cellSize) + 'px';
                cell.style.width = (cellSize - 2) + 'px';
                cell.style.height = (cellSize - 2) + 'px';

                preview.appendChild(cell);
            }
        }
    }
}

function hidePatternPreview() {
    const preview = document.getElementById('patternPreview');
    preview.innerHTML = '';
    preview.style.display = 'none';
}

// Inicializar
document.addEventListener('DOMContentLoaded', renderPatterns);

// Exportar funciones
window.getPatternWithRotation = getPatternWithRotation;

// Función para colocar un patrón en la cuadrícula
function placePattern(grid, pattern, centerX, centerY) {
    if (!pattern || !pattern.pattern) return grid;

    const newGrid = [...grid.map(row => [...row])];
    const patternData = pattern.pattern;

    if (patternData === 'random') {
        // Manejar patrón aleatorio
        for (let x = 0; x < grid.length; x++) {
            for (let y = 0; y < grid[0].length; y++) {
                newGrid[x][y] = Math.random() < 0.3;
            }
        }
        return newGrid;
    }

    // Calcular desplazamiento para centrar
    const offsetX = Math.floor(patternData[0].length / 2);
    const offsetY = Math.floor(patternData.length / 2);

    console.log(`Placing pattern at ${centerX},${centerY} with offset ${offsetX},${offsetY}`);

    // Colocar cada célula del patrón
    for (let row = 0; row < patternData.length; row++) {
        for (let col = 0; col < patternData[row].length; col++) {
            if (patternData[row][col] === 1) {
                const gridX = centerX - offsetX + col;
                const gridY = centerY - offsetY + row;

                // Verificar que esté dentro de los límites
                if (gridX >= 0 && gridX < newGrid.length &&
                    gridY >= 0 && gridY < newGrid[0].length) {
                    newGrid[gridX][gridY] = true;
                }
            }
        }
    }

    return newGrid;
}

// Llamar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPatterns);
} else {
    renderPatterns();
}

// Exportar funciones
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {PATTERNS, renderPatterns, placePattern, showPatternPreview};
}