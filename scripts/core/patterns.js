class PatternManager {
    constructor(automatonInstance) {
        this.automaton = automatonInstance;
        this.isPreviewVisible = false;
        this.isInfluenceVisible = false;
        this._cleanups = [];

        this._init();
    }

    destroy() {
        this._cleanups.forEach(cleanup => cleanup());
        this._cleanups = [];
        this.hidePatternPreview();
        this.hideInfluenceArea();
        window.patternManager = null;
    }

    _init() {
        this.renderPatterns();

        // Suscribirse a eventos del bus UNA SOLA VEZ con handlers reutilizables
        this._cleanups.push(
            eventBus.on('pattern:selected', (data) => {
                this._updatePatternInfo();
            }),
            eventBus.on('pattern:updated', (data) => {
                this._updatePatternInfo();
            }),
            eventBus.on('pattern:rotationChanged', (data) => {
                this._updatePatternInfo();
            })
        );
    }

    // =========================================
    // RENDERIZADO DE PATRONES
    // =========================================

    renderPatterns() {
        const container = document.getElementById('patternsContainer');
        if (!container) return;

        container.innerHTML = '';

        const sortedPatterns = Object.keys(PATTERNS).sort((a, b) => {
            const patternA = PATTERNS[a];
            const patternB = PATTERNS[b];
            if (patternA.pattern === 'random') return 1;
            if (patternB.pattern === 'random') return -1;
            return patternA.cellCount - patternB.cellCount;
        });

        sortedPatterns.forEach(key => {
            const pattern = PATTERNS[key];
            const patternBtn = document.createElement('button');
            patternBtn.className = 'pattern-btn-horizontal';
            patternBtn.dataset.patternKey = key;

            const categoryText = pattern.category ? `[${pattern.category}]\n` : '';
            const cellCountText = pattern.cellCount ? `\nCélulas: ${pattern.cellCount}` : '';
            patternBtn.dataset.tooltip = `${categoryText}${pattern.description}${cellCountText}\n\nClic derecho para rotar 90°`;

            const thumbnail = document.createElement('div');
            thumbnail.className = 'pattern-thumb-horizontal';

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
                this._renderPatternToCanvas(ctx, pattern.pattern, pattern.color);
                thumbnail.appendChild(canvas);
            }

            const label = document.createElement('div');
            label.className = 'pattern-label-horizontal';
            label.textContent = pattern.name;

            if (pattern.cellCount && pattern.pattern !== 'random') {
                const sizeBadge = document.createElement('div');
                sizeBadge.className = 'pattern-size-badge';
                sizeBadge.textContent = pattern.cellCount;
                patternBtn.appendChild(sizeBadge);
            }

            patternBtn.appendChild(thumbnail);
            patternBtn.appendChild(label);

            patternBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => btn.classList.remove('active'));
                patternBtn.classList.add('active');

                window.selectedPatternRotation = 0;
                window.selectedPatternKey = key;
                window.selectedPattern = getPatternWithRotation(key, 0);

                this._updatePatternInfo();
                eventBus.emit('pattern:selected', {patternKey: key, pattern: PATTERNS[key]});
            });

            patternBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (patternBtn.classList.contains('active') && pattern.pattern !== 'random') {
                    window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;
                    window.selectedPattern = getPatternWithRotation(key, window.selectedPatternRotation);

                    const canvas = thumbnail.querySelector('canvas');
                    if (canvas) {
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, 40, 40);
                        const rotatedPattern = getPatternWithRotation(key, window.selectedPatternRotation);
                        this._renderPatternToCanvas(ctx, rotatedPattern.pattern, pattern.color);
                    }

                    this._updatePatternInfo();
                    eventBus.emit('pattern:updated', {pattern: window.selectedPattern});
                }

                return false;
            });

            container.appendChild(patternBtn);
        });

        window.selectedPatternKey = null;
        window.selectedPattern = null;
        window.selectedPatternRotation = 0;
        this._updatePatternInfo();
    }

    _renderPatternToCanvas(ctx, patternData, color) {
        if (!patternData || patternData === 'random') return;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 40, 40);

        const rows = patternData.length;
        const cols = patternData[0].length;
        const maxDim = Math.max(rows, cols);
        const cellSize = Math.min(30 / maxDim, 5);

        const offsetX = (40 - cols * cellSize) / 2;
        const offsetY = (40 - rows * cellSize) / 2;

        ctx.fillStyle = color || '#10b981';
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (patternData[row][col] === 1) {
                    ctx.fillRect(offsetX + col * cellSize, offsetY + row * cellSize, cellSize, cellSize);
                }
            }
        }
    }

    _updatePatternInfo() {
        if (!window.selectedPatternKey) {
            const nameEl = document.getElementById('patternNameMini');
            const detailsEl = document.getElementById('patternDetailsMini');
            if (nameEl) nameEl.textContent = 'Selecciona un patrón';
            if (detailsEl) detailsEl.textContent = 'Clic en un patrón para seleccionarlo';

            eventBus.emit('pattern:cleared');
            return;
        }

        const pattern = getPatternWithRotation(window.selectedPatternKey, window.selectedPatternRotation);
        const nameEl = document.getElementById('patternNameMini');
        const detailsEl = document.getElementById('patternDetailsMini');

        if (nameEl && detailsEl && pattern) {
            const originalPattern = PATTERNS[window.selectedPatternKey];
            const rotationText = window.selectedPatternRotation > 0 ? ` (${window.selectedPatternRotation}°)` : '';
            nameEl.textContent = `${pattern.name}${rotationText}`;

            const categoryText = originalPattern.category ? `Categoría: ${originalPattern.category}` : '';
            const cellCountText = originalPattern.cellCount ? ` | Células: ${originalPattern.cellCount}` : '';
            detailsEl.textContent = `${categoryText}${cellCountText}`;
        }

        window.selectedPattern = pattern;
        eventBus.emit('pattern:updated', {pattern});
    }

    // =========================================
    // PREVIEW DE PATRONES
    // =========================================

    showPatternPreview(x, y) {
        const preview = document.getElementById('patternPreview');
        const pattern = window.selectedPattern;

        if (!pattern?.pattern || pattern.pattern === 'random') {
            this.hidePatternPreview();
            return;
        }

        const canvas = document.getElementById('canvas');
        const container = document.getElementById('canvas-container');
        if (!canvas || !container) return;

        const cellSize = this.automaton.cellSize;
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        const scaleX = this.automaton.canvas.width / canvasRect.width;
        const scaleY = this.automaton.canvas.height / canvasRect.height;

        const patternData = pattern.pattern;
        const patternOffsetX = Math.floor(patternData[0].length / 2);
        const patternOffsetY = Math.floor(patternData.length / 2);

        preview.innerHTML = '';
        preview.style.cssText = `
      position: absolute;
      left: ${canvasRect.left - containerRect.left}px;
      top: ${canvasRect.top - containerRect.top}px;
      width: ${canvasRect.width}px;
      height: ${canvasRect.height}px;
      display: block;
      pointer-events: none;
      z-index: 3;
    `;

        for (let row = 0; row < patternData.length; row++) {
            for (let col = 0; col < patternData[row].length; col++) {
                if (patternData[row][col] === 1) {
                    const gridX = x - patternOffsetX + col;
                    const gridY = y - patternOffsetY + row;

                    if (gridX >= 0 && gridX < this.automaton.gridSize && gridY >= 0 && gridY < this.automaton.gridSize) {
                        const cell = document.createElement('div');
                        cell.className = 'pattern-preview-cell';
                        cell.style.cssText = `
              position: absolute;
              left: ${gridX * cellSize / scaleX}px;
              top: ${gridY * cellSize / scaleY}px;
              width: ${cellSize / scaleX}px;
              height: ${cellSize / scaleY}px;
              background: #3b82f6;
              border-radius: 2px;
              opacity: 0.8;
            `;
                        preview.appendChild(cell);
                    }
                }
            }
        }

        this.isPreviewVisible = true;
    }

    hidePatternPreview() {
        const preview = document.getElementById('patternPreview');
        if (preview) {
            // Limpiar hijos para liberar memoria
            while (preview.firstChild) {
                preview.removeChild(preview.firstChild);
            }
            preview.style.display = 'none';
        }
        this.isPreviewVisible = false;
    }

    // =========================================
    // ÁREA DE INFLUENCIA
    // =========================================

    showInfluenceArea(x, y) {
        const influenceDiv = document.getElementById('influenceArea');
        if (!influenceDiv) return;

        influenceDiv.innerHTML = '';
        const canvas = document.getElementById('canvas');
        const container = document.getElementById('canvas-container');
        if (!canvas || !container) return;

        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const cellSize = this.automaton.cellSize;
        const scaleX = this.automaton.canvas.width / canvasRect.width;
        const scaleY = this.automaton.canvas.height / canvasRect.height;

        influenceDiv.style.cssText = `
      position: absolute;
      left: ${canvasRect.left - containerRect.left}px;
      top: ${canvasRect.top - containerRect.top}px;
      width: ${canvasRect.width}px;
      height: ${canvasRect.height}px;
      display: block;
      pointer-events: none;
      z-index: 2;
    `;

        const radius = this.automaton.neighborhoodRadius;
        const type = this.automaton.neighborhoodType;

        const getNeighborhood = (cx, cy) => {
            const neighbors = [];
            for (let i = -radius; i <= radius; i++) {
                for (let j = -radius; j <= radius; j++) {
                    if (i === 0 && j === 0) continue;
                    if (type === 'neumann' && Math.abs(i) + Math.abs(j) > radius) continue;

                    const nx = (cx + i + this.automaton.gridSize) % this.automaton.gridSize;
                    const ny = (cy + j + this.automaton.gridSize) % this.automaton.gridSize;
                    neighbors.push({x: nx, y: ny});
                }
            }
            return neighbors;
        };

        const pattern = window.selectedPattern?.pattern;
        let cellsToHighlight = [];

        if (!pattern || pattern === 'random') {
            cellsToHighlight = getNeighborhood(x, y);
        } else {
            const patternOffsetX = Math.floor(pattern[0].length / 2);
            const patternOffsetY = Math.floor(pattern.length / 2);
            const patternCells = new Set();

            for (let row = 0; row < pattern.length; row++) {
                for (let col = 0; col < pattern[row].length; col++) {
                    if (pattern[row][col] === 1) {
                        const gridX = x - patternOffsetX + col;
                        const gridY = y - patternOffsetY + row;
                        if (gridX >= 0 && gridX < this.automaton.gridSize && gridY >= 0 && gridY < this.automaton.gridSize) {
                            patternCells.add(`${gridX},${gridY}`);
                        }
                    }
                }
            }

            const influenceMap = new Set();
            patternCells.forEach(key => {
                const [cx, cy] = key.split(',').map(Number);
                getNeighborhood(cx, cy).forEach(n => influenceMap.add(`${n.x},${n.y}`));
            });

            patternCells.forEach(key => influenceMap.delete(key));
            cellsToHighlight = Array.from(influenceMap).map(key => {
                const [x, y] = key.split(',').map(Number);
                return {x, y};
            });
        }

        cellsToHighlight.forEach(({x, y}) => {
            const cell = document.createElement('div');
            cell.className = `influence-cell ${type} radius-${radius}`;
            cell.style.cssText = `
        position: absolute;
        left: ${x * cellSize / scaleX}px;
        top: ${y * cellSize / scaleY}px;
        width: ${cellSize / scaleX}px;
        height: ${cellSize / scaleY}px;
        background: rgba(59, 130, 246, 0.2);
        pointer-events: none;
      `;
            influenceDiv.appendChild(cell);
        });

        this.isInfluenceVisible = true;
    }

    hideInfluenceArea() {
        const influenceDiv = document.getElementById('influenceArea');
        if (influenceDiv) {
            // Limpiar hijos para liberar memoria
            while (influenceDiv.firstChild) {
                influenceDiv.removeChild(influenceDiv.firstChild);
            }
            influenceDiv.style.display = 'none';
            this.isInfluenceVisible = false;
        }
    }
}

// Funciones globales para compatibilidad retroactiva
function showPatternPreview(x, y) {
    if (window.patternManager) {
        window.patternManager.showPatternPreview(x, y);
    }
}

function hidePatternPreview() {
    if (window.patternManager) {
        window.patternManager.hidePatternPreview();
    }
}

function showInfluenceArea(x, y) {
    if (window.patternManager) {
        window.patternManager.showInfluenceArea(x, y);
    }
}

function hideInfluenceArea() {
    if (window.patternManager) {
        window.patternManager.hideInfluenceArea();
    }
}

// =========================================
// EXPORTAR FUNCIONES GLOBALES NECESARIAS
// =========================================

// Función que necesitan los botones de patrón
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

// Función que necesitan los botones de patrón
function getPatternWithRotation(patternKey, rotation = 0) {
    if (!PATTERNS[patternKey]) return null;

    const original = PATTERNS[patternKey];
    if (original.pattern === 'random' || rotation === 0) {
        return {
            name: original.name,
            description: original.description,
            color: original.color,
            pattern: original.pattern,
            rotation: 0
        };
    }

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

// =========================================
// COMPATIBILIDAD CON UI-CONTROLLER
// =========================================

// Función bridge temporal para mantener compatibilidad con código legacy
// Esta función simplemente reenvía al manejador interno
function updatePatternInfo() {
    if (window.patternManager) {
        window.patternManager._updatePatternInfo();
    }
}

// Definición de patrones predefinidos
const PATTERNS = {
    // === PATRONES PEQUEÑOS (hasta 10 células) ===
    single: {
        name: "Punto",
        description: "Celda individual",
        category: "básico",
        cellCount: 1,
        color: "#10b981",
        pattern: [[1]]
    },
    block: {
        name: "Bloque",
        description: "Bloque 2x2 - vida estable",
        category: "vida estable",
        cellCount: 4,
        color: "#3b82f6",
        pattern: [
            [1, 1],
            [1, 1]
        ]
    },
    beehive: {
        name: "Colmena",
        description: "Patrón estable común",
        category: "vida estable",
        cellCount: 6,
        color: "#f59e0b",
        pattern: [
            [0, 1, 1, 0],
            [1, 0, 0, 1],
            [0, 1, 1, 0]
        ]
    },
    loaf: {
        name: "Pan",
        description: "Patrón estable",
        category: "vida estable",
        cellCount: 7,
        color: "#8b5cf6",
        pattern: [
            [0, 1, 1, 0],
            [1, 0, 0, 1],
            [0, 1, 0, 1],
            [0, 0, 1, 0]
        ]
    },
    boat: {
        name: "Bote",
        description: "Patrón estable",
        category: "vida estable",
        cellCount: 5,
        color: "#06b6d4",
        pattern: [
            [1, 1, 0],
            [1, 0, 1],
            [0, 1, 0]
        ]
    },
    tub: {
        name: "Tubo",
        description: "Patrón estable",
        category: "vida estable",
        cellCount: 4,
        color: "#d406ab",
        pattern: [
            [0, 1, 0],
            [1, 0, 1],
            [0, 1, 0]
        ]
    },

    // === OSCILADORES ===
    blinker: {
        name: "Parpadeador",
        description: "Oscilador periodo 2 (3 células)",
        category: "oscilador",
        cellCount: 3,
        color: "#ef4444",
        pattern: [
            [1, 1, 1]
        ]
    },
    toad: {
        name: "Sapo",
        description: "Oscilador periodo 2",
        category: "oscilador",
        cellCount: 6,
        color: "#f50b49",
        pattern: [
            [0, 1, 1, 1],
            [1, 1, 1, 0]
        ]
    },
    beacon: {
        name: "Baliza",
        description: "Oscilador periodo 2",
        category: "oscilador",
        cellCount: 8,
        color: "#10b981",
        pattern: [
            [1, 1, 0, 0],
            [1, 1, 0, 0],
            [0, 0, 1, 1],
            [0, 0, 1, 1]
        ]
    },
    pulsar: {
        name: "Pulsar",
        description: "Oscilador periodo 3 (48 células)",
        category: "oscilador",
        cellCount: 48,
        color: "#8b5cf6",
        pattern: [
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0],
        ]
    },
    pentadecathlon: {
        name: "Pentadecathlon",
        description: "Oscilador periodo 15 (22 células)",
        category: "oscilador",
        cellCount: 22,
        color: "#f59e0b",
        pattern: [
            [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
            [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1],
            [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
        ]
    },

    // === PLANEADORES (GLIDERS) ===
    glider: {
        name: "Planeador",
        description: "Nave que se mueve diagonalmente",
        category: "planeador",
        cellCount: 5,
        color: "#3b82f6",
        pattern: [
            [0, 1, 0],
            [0, 0, 1],
            [1, 1, 1]
        ]
    },
    lwss: {
        name: "Nave Ligera",
        description: "Lightweight spaceship (nave espacial ligera)",
        category: "nave",
        cellCount: 9,
        color: "#06b6d4",
        pattern: [
            [1, 0, 0, 1, 0],
            [0, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 1],
        ]
    },
    mwss: {
        name: "Nave Media",
        description: "Middleweight spaceship (nave espacial media)",
        category: "nave",
        cellCount: 11,
        color: "#8b5cf6",
        pattern: [
            [0, 0, 1, 0, 0, 0],
            [1, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 1],
            [0, 1, 1, 1, 1, 1],
        ]
    },
    hwss: {
        name: "Nave Pesada",
        description: "Heavyweight spaceship (nave espacial pesada)",
        category: "nave",
        cellCount: 13,
        color: "#d406ab",
        pattern: [
            [0, 0, 1, 1, 0, 0, 0],
            [1, 0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 0, 1],
            [1, 0, 0, 0, 0, 0, 1],
            [0, 1, 1, 1, 1, 1, 1],
        ]
    },

    // === PATRONES DE CRECIMIENTO LENTO ===
    rpentomino: {
        name: "R-pentominó",
        description: "Patrón que crece por 1103 generaciones",
        category: "metuselah",
        cellCount: 5,
        color: "#ef4444",
        pattern: [
            [0, 1, 1],
            [1, 1, 0],
            [0, 1, 0]
        ]
    },
    diehard: {
        name: "Diehard",
        description: "Desaparece después de 130 generaciones",
        category: "metuselah",
        cellCount: 8,
        color: "#f59e0b",
        pattern: [
            [0, 0, 0, 0, 0, 0, 1, 0],
            [1, 1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 1, 1, 1]
        ]
    },
    acorn: {
        name: "Bellota",
        description: "Crece por 5206 generaciones",
        category: "metuselah",
        cellCount: 7,
        color: "#10b981",
        pattern: [
            [0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 1, 0, 0, 0],
            [1, 1, 0, 0, 1, 1, 1]
        ]
    },

    // === PATRONES COMPLEJOS ===
    gosperglidergun: {
        name: "Cañón de Planeadores",
        description: "Genera planeadores indefinidamente (Gosper Glider Gun)",
        category: "generador",
        cellCount: 36,
        color: "#8b5cf6",
        pattern: [
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ]
    },
    simkinglide: {
        name: "Simkin Glider Gun",
        description: "Generador de planeadores compacto",
        category: "generador",
        cellCount: 21,
        color: "#f59e0b",
        pattern: [
            [1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ]
    },
    gospergliderguneater: {
        name: "Cañón de Planeadores con Devorador",
        description: "Genera planeadores indefinidamente (Gosper Glider Gun)",
        category: "generador",
        cellCount: 46,
        color: "#5c8df6",
        pattern: [
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
        ]
    },

    // === PATRONES KAUFFMAN ===
    pattern1: {
        name: "KI",
        description: "---",
        category: "oscilador",
        cellCount: 8,
        color: "#0666d4",
        pattern: [
            [1, 1, 1, 1],
            [1, 1, 1, 1],
        ]
    },
    pattern2: {
        name: "KII",
        description: "---",
        category: "oscilador",
        cellCount: 7,
        color: "#8b5cf6",
        pattern: [
            [1, 1, 0],
            [1, 1, 1],
            [0, 1, 1],
        ]
    },
    pattern3: {
        name: "KIII",
        description: "Cruz simple de 5 células",
        category: "oscilador",
        cellCount: 5,
        color: "#f5bb0b",
        pattern: [
            [0, 1, 0],
            [1, 1, 1],
            [0, 1, 0]
        ]
    },
    pattern4: {
        name: "KIV",
        description: "---",
        category: "oscilador",
        cellCount: 8,
        color: "#f59e0b",
        pattern: [
            [1, 0, 0, 0],
            [0, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 0, 1, 1]
        ]
    },
    pattern5: {
        name: "KV",
        description: "---",
        category: "oscilador",
        cellCount: 9,
        color: "#d45506",
        pattern: [
            [0, 1, 1, 1, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 1, 0, 0],
        ]
    },
    pattern6: {
        name: "KVI",
        description: "---",
        category: "oscilador",
        cellCount: 10,
        color: "#06b6d4",
        pattern: [
            [1, 1, 1, 0],
            [0, 1, 1, 1],
            [0, 1, 1, 1],
            [0, 0, 0, 1],
        ]
    },
    pattern7: {
        name: "KVII",
        description: "---",
        category: "oscilador",
        cellCount: 14,
        color: "#3b82f6",
        pattern: [
            [0, 1, 0, 1, 0],
            [1, 1, 1, 1, 1],
            [1, 1, 1, 1, 1],
            [0, 1, 0, 1, 0]
        ]
    },
    pattern8: {
        name: "KVIII",
        description: "---",
        category: "oscilador",
        cellCount: 10,
        color: "#ef4444",
        pattern: [
            [0, 0, 0, 1, 0],
            [1, 1, 1, 0, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 0, 1, 0],
        ]
    },
    pattern9: {
        name: "KIX",
        description: "---",
        category: "oscilador",
        cellCount: 11,
        color: "#f50b49",
        pattern: [
            [0, 0, 1, 1, 0],
            [0, 1, 1, 1, 0],
            [0, 1, 1, 1, 1],
            [1, 0, 0, 1, 0],
        ]
    },
    pattern10: {
        name: "KX",
        description: "---",
        category: "oscilador",
        cellCount: 12,
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
        name: "KXI",
        description: "---",
        category: "oscilador",
        cellCount: 16,
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
        name: "KXII",
        description: "---",
        category: "oscilador",
        cellCount: 10,
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
        name: "KXIII",
        description: "---",
        category: "oscilador",
        cellCount: 32,
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
        name: "KXIV",
        description: "---",
        category: "oscilador",
        cellCount: 26,
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
        name: "KXV",
        description: "---",
        category: "oscilador",
        cellCount: 36,
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
        name: "KXVI",
        description: "---",
        category: "vida estable",
        cellCount: 38,
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
        name: "KXVII",
        description: "---",
        category: "vida estable",
        cellCount: 44,
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
        name: "KXVIII",
        description: "---",
        category: "vida estable",
        cellCount: 42,
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
        name: "KXIX",
        description: "---",
        category: "vida estable",
        cellCount: 50,
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

    // === ALEATORIO ===
    random: {
        name: "Aleatorio",
        description: "Patrón aleatorio con densidad ~30%",
        category: "especial",
        cellCount: 0, // No aplica
        color: "#8b5cf6",
        pattern: "random"
    },
};

// Exportar al scope global
window.updatePatternInfo = updatePatternInfo;
window.getPatternWithRotation = getPatternWithRotation;
window.rotateMatrix = rotateMatrix;
window.PATTERNS = PATTERNS;