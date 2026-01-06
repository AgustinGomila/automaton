// Definición de patrones predefinidos
const PATTERNS = {
    glider: {
        name: "Patrón I",
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
    blinker: {
        name: "Patrón II",
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
    block: {
        name: "Patrón III",
        description: "---",
        color: "#f59e0b",
        pattern: [
            [1, 0, 0, 0],
            [0, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 0, 1, 1]
        ]
    },
    beacon: {
        name: "Patrón IV",
        description: "---",
        color: "#8b5cf6",
        pattern: [
            [1, 1, 0],
            [1, 1, 1],
            [0, 1, 1],
        ]
    },
    cross: {
        name: "Patrón V",
        description: "Cruz simple de 5 células",
        color: "#f5bb0b",
        pattern: [
            [0, 1, 0],
            [1, 1, 1],
            [0, 1, 0]
        ]
    },
    spaceship: {
        name: "Patrón VI",
        description: "---",
        color: "#3b82f6",
        pattern: [
            [0, 1, 0, 1, 0],
            [1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1],
            [0, 1, 0, 1, 0]
        ]
    },
    pattern7: {
        name: "Patrón VII",
        description: "---",
        color: "#ef4444",
        pattern: [
            [0, 0, 0, 1, 0],
            [1, 1, 1, 0, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 0, 1, 0],
        ]
    },
    pattern8: {
        name: "Patrón VIII",
        description: "---",
        color: "#06b6d4",
        pattern: [
            [1, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 1, 1, 1],
            [0, 0, 0, 1],
        ]
    },
    pattern9: {
        name: "Patrón IX",
        description: "---",
        color: "#f50b49",
        pattern: [
            [1, 0, 0, 0],
            [0, 1, 1, 0],
            [0, 1, 1, 1],
            [1, 1, 1, 1],
            [0, 1, 0, 0]
        ]
    },
    random: {
        name: "Aleatorio",
        description: "Patrón aleatorio con densidad ~30%",
        color: "#8b5cf6",
        pattern: "random" // Especial: indica que debe generarse aleatoriamente
    },
};

// Función para renderizar los patrones en la UI
function renderPatterns() {
    const container = document.getElementById('patternsContainer');
    container.innerHTML = '';

    Object.entries(PATTERNS).forEach(([key, pattern]) => {
        const patternBtn = document.createElement('button');
        patternBtn.className = 'pattern-btn';
        patternBtn.dataset.pattern = key;

        patternBtn.innerHTML = `
            <div class="pattern-icon">
                ${getPatternIcon(key)}
            </div>
            <h4>${pattern.name}</h4>
        `;

        patternBtn.addEventListener('click', () => {
            // Remover clase active de todos los botones
            document.querySelectorAll('.pattern-btn').forEach(btn => {
                btn.classList.remove('active');
            });

            // Activar este botón
            patternBtn.classList.add('active');

            // Actualizar información del patrón
            document.getElementById('patternName').textContent = pattern.name;
            document.getElementById('patternDesc').textContent = pattern.description;

            // Guardar patrón seleccionado globalmente
            window.selectedPattern = pattern;
            window.selectedPatternKey = key;

            // Notificar al controlador de UI
            if (window.ui) {
                window.ui.setMode('pattern');
            }

            console.log('Pattern selected:', pattern.name);
        });

        container.appendChild(patternBtn);
    });

    // Seleccionar el primer patrón por defecto
    const firstBtn = container.querySelector('.pattern-btn');
    if (firstBtn) {
        firstBtn.click();
    }
}

function getPatternIcon(key) {
    // const icons = {
    //     glider: '<i class="fas fa-paper-plane"></i>',
    //     blinker: '<i class="fas fa-sync-alt"></i>',
    //     block: '<i class="fas fa-square"></i>',
    //     beacon: '<i class="fas fa-broadcast-tower"></i>',
    //     pulsar: '<i class="fas fa-heartbeat"></i>',
    //     gliderGun: '<i class="fas fa-gun"></i>',
    //     random: '<i class="fas fa-dice"></i>',
    //     cross: '<i class="fas fa-plus"></i>',
    //     spaceship: '<i class="fas fa-rocket"></i>'
    // };
    const icons = {}
    return icons[key] || '<i class="fas fa-shapes"></i>';
}

// Función para colocar un patrón en la cuadrícula
function placePattern(grid, pattern, centerX, centerY) {
    if (!pattern || !pattern.pattern) return grid;

    const newGrid = [...grid.map(row => [...row])];
    const patternData = pattern.pattern;

    // Calcular desplazamiento para centrar
    const offsetX = Math.floor(patternData[0].length / 2);
    const offsetY = Math.floor(patternData.length / 2);

    // Colocar cada célula del patrón
    for (let y = 0; y < patternData.length; y++) {
        for (let x = 0; x < patternData[y].length; x++) {
            const gridX = centerX - offsetX + x;
            const gridY = centerY - offsetY + y;

            // Verificar que esté dentro de los límites
            if (gridX >= 0 && gridX < newGrid.length &&
                gridY >= 0 && gridY < newGrid[0].length) {
                newGrid[gridX][gridY] = patternData[y][x] === 1;
            }
        }
    }

    return newGrid;
}

// Función para mostrar vista previa del patrón
function showPatternPreview(x, y, pattern) {
    const preview = document.getElementById('patternPreview');
    if (!pattern || !pattern.pattern || pattern.pattern === 'random') {
        preview.style.display = 'none';
        return;
    }

    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    const cellSize = parseInt(document.getElementById('cellSize').value);

    const patternData = pattern.pattern;
    const offsetX = Math.floor(patternData[0].length / 2);
    const offsetY = Math.floor(patternData.length / 2);

    preview.innerHTML = '';
    preview.style.position = 'absolute';
    preview.style.left = '0';
    preview.style.top = '0';
    preview.style.width = `${canvas.width}px`;
    preview.style.height = `${canvas.height}px`;
    preview.style.display = 'block';

    // Crear elementos para la vista previa
    for (let py = 0; py < patternData.length; py++) {
        for (let px = 0; px < patternData[py].length; px++) {
            if (patternData[py][px] === 1) {
                const cell = document.createElement('div');
                const cellX = (x - offsetX + px) * cellSize;
                const cellY = (y - offsetY + py) * cellSize;

                cell.style.position = 'absolute';
                cell.style.left = `${cellX}px`;
                cell.style.top = `${cellY}px`;
                cell.style.width = `${cellSize - 2}px`;
                cell.style.height = `${cellSize - 2}px`;
                cell.style.backgroundColor = 'var(--pattern-preview)';
                cell.style.border = '1px dashed rgba(255, 255, 255, 0.5)';
                cell.style.pointerEvents = 'none';

                preview.appendChild(cell);
            }
        }
    }
}

// Exportar funciones
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {PATTERNS, renderPatterns, placePattern, showPatternPreview};
}