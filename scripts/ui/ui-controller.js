// UI Controller
class UIController {

    constructor() {
        this.isDrawing = false;
        this.showInfluenceArea = false;
        this.patternsTwoRows = false;
        this.patternsCompactView = false;
        this.rulesLoaded = false;

        // Inicializar regla
        this.initUi().then(() => console.log('Reglas cargadas.'));
    }

    async initUi() {
        // Esperar a que se carguen las reglas
        await this.waitForRules();

        this.bindEvents();
        this.bindKeyboardEvents();
        this.updateSpeedDisplay();
        this.updateGridSizeDisplay();
        this.updateCellSizeDisplay();
        this.loadRules();
        this.bindNeighborhoodEvents();
        this.bindPatternsControls();

        // Inicializar ambos indicadores
        this.updateNeighborhoodInfo();

        // Inicializar reglas si hay una seleccionada
        const selector = document.getElementById('ruleSelector');
        if (selector && selector.value && window.RULES) {
            const ruleKey = selector.value;
            const rule = window.RULES[ruleKey];
            if (rule) {
                this.updateRuleInfo(rule);
            }
        }
    }

    async waitForRules() {
        // Si ya hay reglas cargadas, continuar
        if (window.RULES && Object.keys(window.RULES).length > 0) {
            console.log('Reglas ya cargadas:', Object.keys(window.RULES).length);
            this.rulesLoaded = true;
            return;
        }

        // Si no, esperar a que se carguen
        console.log('Esperando carga de reglas...');

        // Intentar cargar con el loader
        if (window.rulesLoader) {
            await window.rulesLoader.load();
            this.rulesLoaded = true;
        } else {
            // Fallback: esperar un momento y verificar
            await new Promise(resolve => setTimeout(resolve, 500));

            if (window.RULES) {
                this.rulesLoaded = true;
            } else {
                console.error('No se pudieron cargar las reglas');
                await window.rulesLoader.loadEmbeddedRules()
                this.rulesLoaded = true;
            }
        }
    }

    loadRules() {
        const selector = document.getElementById('ruleSelector');
        if (!selector) return;

        // Verificar que las reglas estén disponibles
        if (!window.RULES) {
            console.error('RULES no está definido');
            this.showRuleLoadError();
            return;
        }

        // Limpiar selector (excepto primera opción)
        while (selector.options.length > 1) {
            selector.removeItem(1);
        }

        // Agregar cada regla
        Object.keys(window.RULES).forEach(key => {
            const rule = window.RULES[key];
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `${rule.name} (${rule.ruleString})`;
            selector.appendChild(option);
        });

        // Seleccionar Conway por defecto si existe
        if (window.RULES.conway) {
            selector.value = 'conway';
            this.updateRuleInfo(window.RULES.conway);
        }
    }

    showRuleLoadError() {
        // Mostrar mensaje de error en el selector
        const selector = document.getElementById('ruleSelector');
        const errorOption = document.createElement('option');
        errorOption.value = 'error';
        errorOption.textContent = 'Error cargando reglas';
        errorOption.disabled = true;
        selector.appendChild(errorOption);

        // También mostrar en la UI
        const rulesPanel = document.getElementById('rulesSpecific');
        if (rulesPanel) {
            rulesPanel.innerHTML = `
                <p style="color: var(--danger)">
                    <i class="fas fa-exclamation-triangle"></i>
                    Error cargando reglas. Usando configuración por defecto.
                </p>
            `;
        }
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

        // Reglas
        document.getElementById('ruleSelector').addEventListener('change', this.changeRule.bind(this));
        document.getElementById('applyCustomRuleBtn').addEventListener('click', () => {
            this.applyCustomRule();
        });
        document.getElementById('birthInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.applyCustomRule();
        });
        document.getElementById('survivalInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.applyCustomRule();
        });

        // Área de influencia toggle
        document.getElementById('influenceToggle').addEventListener('change', this.toggleInfluenceArea.bind(this));
        document.getElementById('quickInfluenceToggle').addEventListener('click', this.quickToggleInfluenceArea.bind(this));

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

            if (window.selectedPattern) {
                showPatternPreview(x, y);

                // Mostrar área de influencia si está activada
                if (this.showInfluenceArea) {
                    showInfluenceArea(x, y);
                } else {
                    hideInfluenceArea();
                }
            } else {
                hidePatternPreview();

                // Mostrar área de influencia para celda individual si está activada
                if (this.showInfluenceArea) {
                    showInfluenceArea(x, y);
                } else {
                    hideInfluenceArea();
                }
            }

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
            if (!this.showInfluenceArea) {
                hideInfluenceArea();
            }
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

    applyCustomRule() {
        const birthInput = document.getElementById('birthInput').value;
        const survivalInput = document.getElementById('survivalInput').value;

        try {
            const customRule = parseCustomRule(birthInput, survivalInput);

            if (customRule.birth.length === 0 && customRule.survival.length === 0) {
                throw new Error('Ingresa valores válidos para B y S');
            }

            // Aplicar la regla al autómata
            automaton.setRule(customRule.survival, customRule.birth);

            // Actualizar la información en el header
            this.updateCustomRuleInfo();

            // Mostrar confirmación
            alert(`Regla personalizada aplicada: B${customRule.birth.join('')}/S${customRule.survival.join('')}`);

        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    updateCustomRuleInfo() {
        const rulesSpecific = document.getElementById('rulesSpecific');
        if (!rulesSpecific || !automaton) return;

        const birth = automaton.rule.birth.sort((a, b) => a - b);
        const survival = automaton.rule.survival.sort((a, b) => a - b);

        rulesSpecific.innerHTML = `
        <p><span class="birth"><i class="fas fa-seedling"></i> Nacimiento:</span> ${birth.join(', ')} vecinos</p>
        <p><span class="survival"><i class="fas fa-heart"></i> Supervivencia:</span> ${survival.join(', ')} vecinos</p>
        <p class="notation">
            Notación: <span class="highlight">B${birth.join('')}/S${survival.join('')}</span>
        </p>
    `;

        // Actualizar el título de la página
        document.title = `Autómata Celular - Personalizada B${birth.join('')}/S${survival.join('')}`;

        // Actualizar el header principal
        const headerTitle = document.querySelector('h1');
        if (headerTitle) {
            headerTitle.innerHTML = `<i class="fas fa-cogs"></i> Autómata - Personalizada`;
        }
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

    // Controlar las filas de patrones
    bindPatternsControls() {
        const toggleRowsBtn = document.getElementById('patternsToggleRows');
        const toggleCompactBtn = document.getElementById('patternsToggleCompact');
        const container = document.getElementById('patternsContainer');

        if (toggleRowsBtn && container) {
            toggleRowsBtn.addEventListener('click', () => {
                this.patternsTwoRows = !this.patternsTwoRows;
                container.classList.toggle('two-rows', this.patternsTwoRows);

                // Cambiar icono
                const icon = toggleRowsBtn.querySelector('i');
                if (this.patternsTwoRows) {
                    icon.className = 'fas fa-grip-lines-vertical';
                    toggleRowsBtn.title = 'Cambiar a 1 fila';
                } else {
                    icon.className = 'fas fa-grip-lines';
                    toggleRowsBtn.title = 'Cambiar a 2 filas';
                }
            });
        }

        if (toggleCompactBtn && container) {
            toggleCompactBtn.addEventListener('click', () => {
                this.patternsCompactView = !this.patternsCompactView;
                container.classList.toggle('compact-view', this.patternsCompactView);

                // Aplicar clase compact a todos los botones
                document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
                    btn.classList.toggle('compact', this.patternsCompactView);
                });

                // Cambiar icono
                const icon = toggleCompactBtn.querySelector('i');
                if (this.patternsCompactView) {
                    icon.className = 'fas fa-expand-alt';
                    toggleCompactBtn.title = 'Vista normal';
                } else {
                    icon.className = 'fas fa-compress';
                    toggleCompactBtn.title = 'Vista compacta';
                }
            });
        }

        // Scroll buttons mejorados
        const scrollLeft = document.getElementById('scrollLeft');
        const scrollRight = document.getElementById('scrollRight');

        if (scrollLeft && scrollRight && container) {
            scrollLeft.addEventListener('click', () => {
                container.scrollLeft -= 150;
            });

            scrollRight.addEventListener('click', () => {
                container.scrollLeft += 150;
            });

            // Mostrar/ocultar botones de scroll según posición
            container.addEventListener('scroll', () => {
                const showLeft = container.scrollLeft > 0;
                const showRight = container.scrollLeft < (container.scrollWidth - container.clientWidth);

                scrollLeft.style.opacity = showLeft ? '1' : '0.5';
                scrollLeft.style.pointerEvents = showLeft ? 'all' : 'none';

                scrollRight.style.opacity = showRight ? '1' : '0.5';
                scrollRight.style.pointerEvents = showRight ? 'all' : 'none';
            });

            // Inicializar estado
            container.dispatchEvent(new Event('scroll'));
        }
    }

    deselectPattern() {
        window.selectedPattern = null;
        window.selectedPatternKey = null;
        window.selectedPatternRotation = 0;
        hidePatternPreview();
        hideInfluenceArea();

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
        let value = parseInt(slider.value.toString()) - 1;
        if (value < 1) value = 1;
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
    }

    increaseSpeed() {
        const slider = document.getElementById('speedControl');
        let value = parseInt(slider.value.toString()) + 1;
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

            // Guardar estado del mouse
            const lastCoords = document.getElementById('mouseCoords').textContent;
            const match = lastCoords.match(/X: (\d+), Y: (\d+)/);
            let lastX = 0, lastY = 0;
            if (match) {
                lastX = parseInt(match[1]);
                lastY = parseInt(match[2]);
            }

            automaton.resizeGrid(value);

            // Restaurar preview después del resize
            setTimeout(() => {
                if (window.selectedPattern) {
                    // Limitar coordenadas al nuevo tamaño
                    const safeX = Math.min(lastX, value - 1);
                    const safeY = Math.min(lastY, value - 1);
                    showPatternPreview(safeX, safeY);

                    if (this.showInfluenceArea) {
                        showInfluenceArea(safeX, safeY);
                    }
                }
            }, 100);
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

        // Forzar reflow y actualizar previews
        setTimeout(() => {
            if (window.selectedPattern) {
                const lastCoords = document.getElementById('mouseCoords').textContent;
                const match = lastCoords.match(/X: (\d+), Y: (\d+)/);
                if (match) {
                    const x = parseInt(match[1]);
                    const y = parseInt(match[2]);
                    showPatternPreview(x, y);

                    if (this.showInfluenceArea) {
                        showInfluenceArea(x, y);
                    }
                }
            }
        }, 50);
    }

    updateCellSizeDisplay() {
        const slider = document.getElementById('cellSize');
        const value = parseInt(slider.value);
        document.getElementById('cellSizeValue').textContent = `${value}px`;
    }

    toggleGrid() {
        automaton.toggleGrid();
    }

    toggleInfluenceArea() {
        const toggle = document.getElementById('influenceToggle');
        this.showInfluenceArea = toggle.checked;

        // Sincronizar el botón rápido
        const quickToggle = document.getElementById('quickInfluenceToggle');
        if (quickToggle) {
            if (this.showInfluenceArea) {
                quickToggle.classList.add('active');
                quickToggle.style.color = 'var(--secondary)';
            } else {
                quickToggle.classList.remove('active');
                quickToggle.style.color = '';
            }
        }

        if (!this.showInfluenceArea) {
            hideInfluenceArea();
        } else if (window.selectedPattern) {
            // Si hay patrón seleccionado y el área está activa, mostrarla
            const lastCoords = document.getElementById('mouseCoords').textContent;
            const match = lastCoords.match(/X: (\d+), Y: (\d+)/);
            if (match) {
                const x = parseInt(match[1]);
                const y = parseInt(match[2]);
                showInfluenceArea(x, y);
            }
        }
    }

    quickToggleInfluenceArea() {
        const toggle = document.getElementById('influenceToggle');
        this.showInfluenceArea = !this.showInfluenceArea;
        toggle.checked = this.showInfluenceArea;

        // Actualizar estilo del botón rápido
        const quickToggle = document.getElementById('quickInfluenceToggle');
        if (this.showInfluenceArea) {
            quickToggle.classList.add('active');
            quickToggle.style.color = 'var(--secondary)';
        } else {
            quickToggle.classList.remove('active');
            quickToggle.style.color = '';
            hideInfluenceArea();
        }
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
            a.download = `my-pattern-${new Date().getTime()}.json`;
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

    changeRule() {
        const selector = document.getElementById('ruleSelector');
        const ruleKey = selector.value;
        const customRuleGroup = document.getElementById('customRuleGroup');

        if (ruleKey === 'custom') {
            // Mostrar controles personalizados
            customRuleGroup.style.display = 'block';

            // Cargar valores actuales del autómata
            document.getElementById('birthInput').value = automaton.rule.birth.join(',');
            document.getElementById('survivalInput').value = automaton.rule.survival.join(',');

            // Actualizar info con regla actual
            this.updateCustomRuleInfo();
        } else {
            // Ocultar controles personalizados
            customRuleGroup.style.display = 'none';

            if (automaton && window.RULES && window.RULES[ruleKey]) {
                // Cambiar la regla en el autómata
                automaton.setRuleByKey(ruleKey);

                // Actualizar el header completo
                this.updateHeaderInfo();

                // Si la simulación está corriendo, pausarla para evitar confusiones
                if (automaton.isRunning) {
                    this.togglePlay();
                }
            }
        }
    }

    changeNeighborhoodType(type) {
        if (automaton) {
            automaton.setNeighborhoodType(type);
            this.updateNeighborhoodInfo();

            // Actualizar área de influencia si está visible
            if (this.showInfluenceArea) {
                const lastCoords = document.getElementById('mouseCoords').textContent;
                const match = lastCoords.match(/X: (\d+), Y: (\d+)/);
                if (match) {
                    const x = parseInt(match[1]);
                    const y = parseInt(match[2]);
                    showInfluenceArea(x, y);
                }
            }

            if (automaton.isRunning) {
                this.togglePlay();
            }
        }
    }

    changeNeighborhoodRadius(radius) {
        const radiusValue = document.getElementById('radiusValue');
        if (radiusValue) {
            radiusValue.textContent = radius;
        }

        if (automaton) {
            automaton.setNeighborhoodRadius(radius);
            this.updateNeighborhoodInfo();

            // Actualizar área de influencia si está visible
            if (this.showInfluenceArea) {
                const lastCoords = document.getElementById('mouseCoords').textContent;
                const match = lastCoords.match(/X: (\d+), Y: (\d+)/);
                if (match) {
                    const x = parseInt(match[1]);
                    const y = parseInt(match[2]);
                    showInfluenceArea(x, y);
                }
            }

            if (automaton.isRunning) {
                this.togglePlay();
            }
        }
    }

    updateHeaderInfo() {
        // Actualizar reglas si hay una seleccionada
        const selector = document.getElementById('ruleSelector');
        if (selector && selector.value && window.RULES) {
            const ruleKey = selector.value;
            const rule = window.RULES[ruleKey];
            if (rule) {
                this.updateRuleInfo(rule);
            }
        }

        // Actualizar información de vecindad
        this.updateNeighborhoodInfo();
    }

    // Actualizar información de reglas
    updateRuleInfo(rule) {
        const rulesSpecific = document.getElementById('rulesSpecific');
        if (!rulesSpecific) return;

        // Actualizar solo el contenido de las reglas específicas
        rulesSpecific.innerHTML = `
        <p><span class="birth"><i class="fas fa-seedling"></i> Nacimiento:</span> ${rule.birth.join(', ')} vecinos</p>
        <p><span class="survival"><i class="fas fa-heart"></i> Supervivencia:</span> ${rule.survival.join(', ')} vecinos</p>
        <p class="notation">
            Notación: <span class="highlight">${rule.ruleString}</span>
        </p>
    `;

        // Actualizar el título de la página
        document.title = `Autómata Celular - ${rule.name} ${rule.ruleString}`;

        // Actualizar el header principal
        const headerTitle = document.querySelector('h1');
        if (headerTitle) {
            headerTitle.innerHTML = `<i class="fas fa-cogs"></i> Autómata - ${rule.name}`;
        }
    }

    bindNeighborhoodEvents() {
        const typeSelect = document.getElementById('neighborhoodType');
        const radiusSlider = document.getElementById('neighborhoodRadius');

        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.changeNeighborhoodType(e.target.value);
            });
        }

        if (radiusSlider) {
            radiusSlider.addEventListener('input', (e) => {
                this.changeNeighborhoodRadius(parseInt(e.target.value));
            });
        }
    }

    updateNeighborhoodInfo() {
        const infoElement = document.getElementById('neighborhoodInfo');
        if (!infoElement || !automaton) return;

        const type = automaton.neighborhoodType === 'moore' ? 'Moore' : 'von Neumann';
        const radius = automaton.neighborhoodRadius;

        // Actualizar el contenido del elemento
        infoElement.innerHTML = `<i class="fas fa-crosshairs"></i> Vecindad: ${type} (radio ${radius})`;
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    new UIController();
});