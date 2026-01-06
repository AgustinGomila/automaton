// UI Controller
class UIController {
    constructor() {
        this.isDrawing = false;
        this.selectedPattern = null;
        this.selectedPatternKey = null;
        this.mode = 'draw'; // 'draw' o 'pattern'

        this.init();
    }

    init() {
        this.bindEvents();
        this.bindKeyboardEvents();
        this.updateSpeedDisplay();
        this.updateGridSizeDisplay();
        this.updateCellSizeDisplay();

        // Inicializar modo
        this.setMode('draw');

        // Asegurarse de que no hay patrón seleccionado al inicio
        window.selectedPattern = null;
        window.selectedPatternKey = null;
    }

    bindEvents() {
        // Botones de control
        document.getElementById('playBtn').addEventListener('click', this.togglePlay.bind(this));
        document.getElementById('stepBtn').addEventListener('click', this.step.bind(this));
        document.getElementById('randomBtn').addEventListener('click', this.randomize.bind(this));
        document.getElementById('clearBtn').addEventListener('click', this.clear.bind(this));
        
        // Controles de velocidad
        document.getElementById('speedControl').addEventListener('input', this.updateSpeed.bind(this));
        document.getElementById('speedDown').addEventListener('click', this.decreaseSpeed.bind(this));
        document.getElementById('speedUp').addEventListener('click', this.increaseSpeed.bind(this));

        // Controles de tamaño
        document.getElementById('gridSize').addEventListener('input', this.updateGridSize.bind(this));
        document.getElementById('cellSize').addEventListener('input', this.updateCellSize.bind(this));

        // Toggle cuadrícula
        document.getElementById('gridToggle').addEventListener('click', this.toggleGrid.bind(this));

        // Interacción con canvas
        this.bindCanvasEvents();

        // Botones de exportación/importación
        document.getElementById('exportBtn').addEventListener('click', this.exportPattern.bind(this));
        document.getElementById('importBtn').addEventListener('click', this.importPattern.bind(this));

        // Actualizar coordenadas del mouse
        this.bindMouseMove();
    }

    bindCanvasEvents() {
        const canvas = document.getElementById('canvas');
        const preview = document.getElementById('patternPreview');

        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.isDrawing = true;

            const {x, y} = automaton.getCellFromMouse(e);

            // Verificar si hay un patrón seleccionado
            if (window.selectedPattern) {
                console.log('Placing pattern:', window.selectedPattern.name);
                // Colocar patrón
                automaton.importPattern(window.selectedPattern, x, y);

                // Deseleccionar patrón después de colocarlo
                this.deselectPattern();
            } else {
                // Modo dibujo normal
                automaton.toggleCell(x, y);
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            const {x, y} = automaton.getCellFromMouse(e);
            this.updateMouseCoords(x, y);

            // Mostrar vista previa del patrón si hay uno seleccionado
            if (window.selectedPattern && window.selectedPattern.pattern !== 'random') {
                showPatternPreview(x, y, window.selectedPattern);
            } else {
                preview.style.display = 'none';
            }

            // Solo dibujar si estamos en modo dibujo y no hay patrón seleccionado
            if (this.isDrawing && !window.selectedPattern) {
                automaton.toggleCell(x, y);
            }
        });

        canvas.addEventListener('mouseup', () => {
            this.isDrawing = false;
        });

        canvas.addEventListener('mouseleave', () => {
            this.isDrawing = false;
            preview.style.display = 'none';
        });

        // Touch events para móviles
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const {x, y} = automaton.getCellFromMouse(touch);

            if (window.selectedPattern) {
                automaton.importPattern(window.selectedPattern, x, y);
                this.deselectPattern();
            } else {
                automaton.toggleCell(x, y);
            }
        });
    }

    deselectPattern() {
        // Limpiar selección
        window.selectedPattern = null;
        window.selectedPatternKey = null;

        // Limpiar vista previa
        const preview = document.getElementById('patternPreview');
        preview.style.display = 'none';

        // Actualizar UI
        document.querySelectorAll('.pattern-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        document.getElementById('patternName').textContent = 'Selecciona un patrón';
        document.getElementById('patternDesc').textContent = '';

        // Cambiar instrucciones
        this.setMode('draw');
    }

    bindMouseMove() {
        const canvas = document.getElementById('canvas');

        canvas.addEventListener('mousemove', (e) => {
            const {x, y} = automaton.getCellFromMouse(e);
            this.updateMouseCoords(x, y);
        });
    }

    updateMouseCoords(x, y) {
        const coords = document.getElementById('mouseCoords');
        if (coords) {
            coords.textContent = `X: ${x}, Y: ${y}`;
        }
    }

    togglePlay() {
        const isRunning = automaton.toggleRunning();
        const playIcon = document.getElementById('playIcon');
        const playText = document.getElementById('playText');
        const stepBtn = document.getElementById('stepBtn');

        if (isRunning) {
            playIcon.className = 'fas fa-pause';
            playText.textContent = 'Pausar';
            stepBtn.disabled = true;
        } else {
            playIcon.className = 'fas fa-play';
            playText.textContent = 'Ejecutar';
            stepBtn.disabled = false;
        }
    }

    step() {
        automaton.nextGeneration();
        automaton.render();
    }

    randomize() {
        automaton.randomize();
    }

    clear() {
        if (automaton.isRunning) {
            this.togglePlay();
        }
        automaton.clear();
    }

    updateSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        const speedValue = document.getElementById('speedValue');

        // Actualizar velocidad
        const interval = automaton.setSpeed(value);

        // Actualizar display
        const speeds = ['Muy Lento', 'Lento', 'Normal', 'Rápido', 'Muy Rápido'];
        const speedText = speeds[Math.min(value - 1, speeds.length - 1)] || 'Normal';
        speedValue.textContent = speedText;

        // Actualizar tooltip del slider
        slider.title = `${Math.round(1000 / interval)} gen/seg`;
    }

    decreaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(slider.value) - 1;
        if (value < 1) value = 1;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    increaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(slider.value) + 1;
        if (value > 10) value = 10;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    updateSpeedDisplay() {
        const speedTexts = [
            'Muy Lento', 'Muy Lento', 'Lento', 'Lento', 'Normal',
            'Normal', 'Rápido', 'Rápido', 'Muy Rápido', 'Muy Rápido'
        ];
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        document.getElementById('speedValue').textContent = speedTexts[value - 1] || 'Normal';
    }

    updateGridSize() {
        const slider = document.getElementById('gridSize');
        const value = parseInt(slider.value);
        document.getElementById('gridSizeValue').textContent = `${value}×${value}`;

        // Cambiar tamaño del grid (con confirmación si está en ejecución)
        if (automaton.isRunning) {
            if (confirm('Cambiar el tamaño de la cuadrícula detendrá la simulación. ¿Continuar?')) {
                this.togglePlay();
                automaton.resizeGrid(value);
            } else {
                slider.value = automaton.gridSize;
                this.updateGridSizeDisplay();
            }
        } else {
            automaton.resizeGrid(value);
        }
    }

    updateGridSizeDisplay() {
        const slider = document.getElementById('gridSize');
        const value = parseInt(slider.value);
        document.getElementById('gridSizeValue').textContent = `${value}×${value}`;
    }

    updateCellSize() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        document.getElementById('cellSizeValue').textContent = `${value}px`;

        automaton.setCellSize(value);
    }

    updateCellSizeDisplay() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        document.getElementById('cellSizeValue').textContent = `${value}px`;
    }

    toggleGrid() {
        const showGrid = automaton.toggleGrid();
        const gridToggle = document.getElementById('gridToggle');
        gridToggle.title = showGrid ? 'Ocultar cuadrícula' : 'Mostrar cuadrícula';
    }

    bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.deselectPattern();
            }

            // Atajos de teclado
            if (e.key === ' ') {
                e.preventDefault();
                this.togglePlay();
            } else if (e.key === 's' || e.key === 'S') {
                this.step();
            } else if (e.key === 'r' || e.key === 'R') {
                this.randomize();
            } else if (e.key === 'c' || e.key === 'C') {
                this.clear();
            }
        });
    }

    exportPattern() {
        const pattern = automaton.exportPattern();
        if (pattern) {
            const patternStr = JSON.stringify(pattern, null, 2);
            const blob = new Blob([patternStr], {type: 'application/json'});
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `kauffman-pattern-${new Date().getTime()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert('Patrón exportado correctamente');
        } else {
            alert('No hay patrón para exportar. Dibuja algo primero.');
        }
    }

    importPattern() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const pattern = JSON.parse(event.target.result);

                    // Validar el patrón
                    if (!pattern.pattern || !Array.isArray(pattern.pattern)) {
                        throw new Error('Formato de patrón inválido');
                    }

                    // Añadir a patrones
                    const key = `imported_${Date.now()}`;
                    window.PATTERNS[key] = {
                        name: pattern.name || 'Patrón Importado',
                        description: pattern.description || 'Patrón importado desde archivo',
                        color: '#10b981',
                        pattern: pattern.pattern
                    };

                    // Recargar lista de patrones
                    renderPatterns();

                    alert('Patrón importado correctamente. Ahora puedes seleccionarlo de la lista.');
                } catch (error) {
                    alert('Error al importar el patrón: ' + error.message);
                }
            };
            reader.readAsText(file);
        };

        input.click();
    }

    // Manejar cambios en el modo
    setMode(mode) {
        this.mode = mode;

        const instructions = document.querySelector('.instructions p');
        if (!instructions) return;

        if (mode === 'pattern' && window.selectedPattern) {
            instructions.innerHTML =
                `<i class="fas fa-hand-pointer"></i> Modo patrón: ${window.selectedPattern.name} - Haz clic para colocar`;
        } else {
            instructions.innerHTML =
                `<i class="fas fa-mouse-pointer"></i> Modo dibujo: Haz clic o arrastra para dibujar`;
        }
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar autómata (ya se hace en automaton.js)
    // Inicializar UI
    const ui = new UIController();

    // Inicializar patrones
    renderPatterns();

    // Manejar selección de patrones
    document.addEventListener('click', (e) => {
        if (e.target.closest('.pattern-btn')) {
            ui.setMode('pattern');
        }
    });

    // Manejar click en canvas para volver al modo dibujo
    document.getElementById('canvas').addEventListener('mousedown', () => {
        if (ui.mode === 'pattern') {
            // Deseleccionar patrón después de colocarlo
            document.querySelectorAll('.pattern-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            document.getElementById('patternName').textContent = 'Selecciona un patrón';
            document.getElementById('patternDesc').textContent = '';
            ui.setMode('draw');
        }
    });

    // Hacer objetos globales para debugging
    window.automaton = automaton;
    window.ui = ui;
});