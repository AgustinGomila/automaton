// UI Controller - Mantener tu versión que funciona
class UIController {
    constructor() {
        this.isDrawing = false;
        this.init();
    }

    init() {
        this.bindEvents();
        this.bindKeyboardEvents();
        this.updateSpeedDisplay();
        this.updateGridSizeDisplay();
        this.updateCellSizeDisplay();
    }

    bindEvents() {
        // Botones de control
        document.getElementById('playBtn').addEventListener('click', this.togglePlay.bind(this));
        document.getElementById('stepBtn').addEventListener('click', this.step.bind(this));
        document.getElementById('randomBtn').addEventListener('click', this.randomize.bind(this));
        document.getElementById('clearBtn').addEventListener('click', this.clear.bind(this));
        document.getElementById('cancelPatternBtn').addEventListener('click', () => {
            this.deselectPattern();
            window.selectedPatternRotation = 0;
        });

        // Controles
        document.getElementById('speedControl').addEventListener('input', this.updateSpeed.bind(this));
        document.getElementById('speedDown').addEventListener('click', this.decreaseSpeed.bind(this));
        document.getElementById('speedUp').addEventListener('click', this.increaseSpeed.bind(this));
        document.getElementById('gridSize').addEventListener('input', this.updateGridSize.bind(this));
        document.getElementById('cellSize').addEventListener('input', this.updateCellSize.bind(this));
        document.getElementById('gridToggle').addEventListener('click', this.toggleGrid.bind(this));

        // Exportación
        document.getElementById('exportBtn').addEventListener('click', this.exportPattern.bind(this));

        // Scroll de patrones
        document.getElementById('scrollLeft').addEventListener('click', () => this.scrollPatterns(-100));
        document.getElementById('scrollRight').addEventListener('click', () => this.scrollPatterns(100));

        // Controles de límite
        document.getElementById('limitType').addEventListener('change', this.updateLimitType.bind(this));
        document.getElementById('limitValue').addEventListener('input', this.updateLimitValue.bind(this));

        // Interacción con canvas
        this.bindCanvasEvents();
    }

    bindCanvasEvents() {
        const canvas = document.getElementById('canvas');
        const preview = document.getElementById('patternPreview');

        // Eventos de ratón
        canvas.addEventListener('mousemove', (e) => {
            const {x, y} = automaton.getCellFromMouse(e);
            this.updateMouseCoords(x, y);

            // Mostrar vista previa del patrón (con rotación actual)
            if (window.selectedPattern) {
                showPatternPreview(x, y);
            } else {
                hidePatternPreview();
            }

            // Dibujar al arrastrar
            if (this.isDrawing && !window.selectedPattern) {
                automaton.toggleCell(x, y);
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            // Solo reaccionar al botón izquierdo (0) y central (1) para dibujar/colocar
            if (e.button === 0 || e.button === 1) {
                e.preventDefault();
                this.isDrawing = true;

                const {x, y} = automaton.getCellFromMouse(e);

                if (window.selectedPattern) {
                    // Solo colocar con clic izquierdo (0). El central (1) también podría, pero por ahora dejamos ambos.
                    automaton.importPattern(window.selectedPattern, x, y);
                } else {
                    automaton.toggleCell(x, y);
                }
            }
            // Si es clic derecho (2), no hacemos nada en mousedown, ya que se maneja en contextmenu.
        });

        canvas.addEventListener('mouseup', () => {
            this.isDrawing = false;
        });

        canvas.addEventListener('mouseleave', () => {
            this.isDrawing = false;
            hidePatternPreview();
        });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // Solo rotar si hay un patrón seleccionado que no sea aleatorio
            if (window.selectedPattern && window.selectedPattern.pattern !== 'random') {
                window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;

                // Obtener el patrón rotado y actualizar el patrón seleccionado globalmente
                window.selectedPattern = getPatternWithRotation(
                    window.selectedPatternKey,
                    window.selectedPatternRotation
                );

                // Actualizar la información del patrón
                updatePatternInfo();

                // Actualizar la vista previa en la posición actual del mouse
                const {x, y} = automaton.getCellFromMouse(e);
                showPatternPreview(x, y);

                // Mostrar feedback visual de rotación
                this.showRotationFeedback();
            }
            return false;
        });

        // Eventos táctiles
        this.setupTouchEvents();
    }

    showRotationFeedback() {
        const patternName = document.getElementById('patternNameMini');
        if (patternName) {
            const originalText = patternName.textContent;
            patternName.textContent = `${originalText} ↻${window.selectedPatternRotation}°`;

            setTimeout(() => {
                const rotationText = window.selectedPatternRotation > 0 ?
                    ` (${window.selectedPatternRotation}°)` : '';
                patternName.textContent = `${window.selectedPattern.name}${rotationText}`;
            }, 500);
        }
    }

    setupTouchEvents() {
        const canvas = document.getElementById('canvas');
        let isTouchDrawing = false;
        let touchStartTime = 0;

        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;

            e.preventDefault();
            const touch = e.touches[0];
            touchStartTime = Date.now();

            const {x, y} = automaton.getCellFromMouse(touch);

            if (window.selectedPattern) {
                automaton.importPattern(window.selectedPattern, x, y);
            } else {
                isTouchDrawing = true;
                automaton.toggleCell(x, y);
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            if (!isTouchDrawing || !e.touches[0]) return;

            e.preventDefault();
            const touch = e.touches[0];
            const {x, y} = automaton.getCellFromMouse(touch);

            // Solo dibujar si nos movimos suficiente
            const touchTime = Date.now() - touchStartTime;
            if (touchTime > 50) {
                automaton.toggleCell(x, y);
            }
        });

        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            isTouchDrawing = false;
        });

        // Prevenir zoom con doble toque
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
    }

    deselectPattern() {
        window.selectedPattern = null;
        window.selectedPatternKey = null;
        window.selectedPatternRotation = 0;
        hidePatternPreview();

        document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
            btn.classList.remove('active');
        });

        const miniEl = document.getElementById('patternNameMini');
        if (miniEl) miniEl.textContent = 'Selecciona un patrón';
    }

    updateMouseCoords(x, y) {
        const coords = document.getElementById('mouseCoords');
        if (coords) {
            coords.textContent = `X: ${x}, Y: ${y}`;
        }
    }

    togglePlay() {
        // Si se alcanzó un límite, resetear antes de continuar
        if (automaton.isLimitReached) {
            automaton.isLimitReached = false;
            automaton.generation = 0;
            automaton.updateStats();
        }

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
        automaton.clear();
    }

    updateSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        automaton.setSpeed(value);
        this.updateSpeedDisplay();
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
        const speedTexts = ['Muy Lento', 'Lento', 'Normal', 'Rápido', 'Muy Rápido'];
        const slider = document.getElementById('speedControl');
        const value = Math.min(Math.max(parseInt(slider.value), 1), 5);
        document.getElementById('speedValue').textContent = speedTexts[value - 1] || 'Normal';
    }

    updateGridSize() {
        const slider = document.getElementById('gridSize');
        const value = parseInt(slider.value);
        document.getElementById('gridSizeValue').textContent = `${value}×${value}`;

        if (!automaton.isRunning || confirm('Cambiar el tamaño detendrá la simulación. ¿Continuar?')) {
            if (automaton.isRunning) this.togglePlay();
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
        automaton.toggleGrid();
    }

    scrollPatterns(direction) {
        const container = document.getElementById('patternsContainer');
        if (container) {
            container.scrollLeft += direction;
        }
    }

    bindKeyboardEvents() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.deselectPattern();
                window.selectedPatternRotation = 0;
            }
            if (e.key === ' ') {
                e.preventDefault();
                this.togglePlay();
            }
            if (e.key === 's' || e.key === 'S') this.step();
            if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                // Rotar con tecla R si hay patrón seleccionado
                if (window.selectedPattern && window.selectedPattern.pattern !== 'random') {
                    window.selectedPatternRotation = (window.selectedPatternRotation + 90) % 360;
                    window.selectedPattern = getPatternWithRotation(
                        window.selectedPatternKey,
                        window.selectedPatternRotation
                    );
                    updatePatternInfo();
                    this.showRotationFeedback();
                }
            }
            if (e.key === 'a' || e.key === 'A') this.randomize();
            if (e.key === 'c' || e.key === 'C') this.clear();
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

    updateLimitType() {
        const select = document.getElementById('limitType');
        const valueGroup = document.getElementById('limitValueGroup');
        const limitValue = document.getElementById('limitValue');

        if (select.value === 'none') {
            valueGroup.style.display = 'none';
            automaton.setLimit('none', 0);
        } else {
            valueGroup.style.display = 'block';
            automaton.setLimit(select.value, parseInt(limitValue.value));
        }

        // Resetear el estado de límite alcanzado
        automaton.isLimitReached = false;
    }

    updateLimitValue() {
        const select = document.getElementById('limitType');
        const slider = document.getElementById('limitValue');
        const value = parseInt(slider.value);

        document.getElementById('limitValueDisplay').textContent = value.toLocaleString();

        if (select.value !== 'none') {
            automaton.setLimit(select.value, value);
        }
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    new UIController();
});