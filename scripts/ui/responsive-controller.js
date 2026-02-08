// Responsive Controller para móviles
class ResponsiveController {
    constructor() {
        this.isMobile = window.innerWidth <= 768;
        this.isPanelOpen = false;
        this.isRulesOpen = false;

        // No llamar init aquí, esperar a que todo esté listo
        this._initialized = false;
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this.bindEvents();

        // Aplicar ajustes iniciales si es móvil - SIEMPRE esperar app:ready
        if (this.isMobile) {
            console.debug('ResponsiveController: Modo móvil detectado, esperando app:ready...');

            // Si ya está listo, aplicar inmediatamente
            if (window.app?.automaton && window.app?.uiController) {
                console.debug('ResponsiveController: App ya lista, aplicando ajustes móviles');
                this.adjustForMobile();
            } else {
                // Esperar evento de ready
                const unbind = eventBus.on('app:ready', () => {
                    unbind();
                    console.debug('ResponsiveController: App:ready recibido, aplicando ajustes móviles');
                    // Delay adicional para asegurar que UIController terminó su init
                    setTimeout(() => this.adjustForMobile(), 100);
                });
            }
        }

        window.addEventListener('resize', () => this.handleResize());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.handleResize(), 100);
        });
    }

    adjustForMobile() {
        console.log('=== adjustForMobile() llamado ===');
        console.log('isMobile:', this.isMobile);
        console.log('window.app:', window.app);
        console.log('window.app?.automaton:', window.app?.automaton);
        console.log('window.app?.uiController:', window.app?.uiController);

        if (!this.isMobile) {
            console.log('No es móvil, saliendo');
            return;
        }

        const automaton = window.app?.automaton;
        const uiController = window.app?.uiController;

        if (!automaton) {
            console.error('ERROR: Automata no disponible');
            return;
        }

        const defaultGridSize = 200;
        const defaultCellSize = 2;

        const gridSizeInput = document.getElementById('gridSize');
        const cellSizeInput = document.getElementById('cellSize');

        // === GRID SIZE ===
        const currentGridSize = parseInt(gridSizeInput?.value) || 0;
        if (currentGridSize !== defaultGridSize) {
            console.debug(`Ajustando grid: ${currentGridSize} → ${defaultGridSize}`);

            if (gridSizeInput) gridSizeInput.value = String(defaultGridSize);

            // Llamar a UIController para mantener consistencia
            if (uiController) {
                uiController.updateGridSizeDisplay();
            }

            automaton.resizeGrid(defaultGridSize);
        }

        // === ZOOM/CELL SIZE ===
        const currentCellSize = parseInt(cellSizeInput?.value) || 0;

        // Forzar el valor 2
        if (currentCellSize !== defaultCellSize) {
            console.debug(`Ajustando zoom: ${currentCellSize} → ${defaultCellSize}`);

            if (cellSizeInput) cellSizeInput.value = String(defaultCellSize);

            if (uiController) {
                uiController.updateCellSizeDisplay();
            }

            automaton.setCellSize(defaultCellSize);
        }

        // Forzar actualización visual
        automaton._markAllDirty();
        automaton.render();

        // Ajustes de patrones para móviles
        const container = document.getElementById('patternsContainer');
        if (container) {
            container.classList.remove('two-rows');
            container.classList.remove('compact-view');

            const controls = document.querySelector('.patterns-controls');
            if (controls && window.innerWidth < 480) {
                controls.style.display = 'none';
            }
        }

        console.debug('ResponsiveController: Ajustes móviles aplicados');
    }

    bindEvents() {
        // Botón de menú móvil
        const menuBtn = document.getElementById('mobileMenuBtn');
        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleLeftPanel();
            });
        }

        // Botón de configuración en footer móvil
        const configBtn = document.getElementById('configMobileBtn');
        if (configBtn) {
            configBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleLeftPanel();
            });
        }

        // Botón para cerrar panel
        const closeBtn = document.getElementById('closePanelBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeLeftPanel();
            });
        }

        // Toggle de reglas móvil
        const rulesToggle = document.getElementById('rulesToggle');
        if (rulesToggle) {
            rulesToggle.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleRules();
            });
        }

        // Cerrar panel al hacer clic fuera en móviles
        document.addEventListener('click', (e) => {
            if (this.isMobile && this.isPanelOpen) {
                const leftPanel = document.getElementById('leftPanel');
                const menuBtn = document.getElementById('mobileMenuBtn');

                if (leftPanel && !leftPanel.contains(e.target) &&
                    menuBtn && !menuBtn.contains(e.target)) {
                    this.closeLeftPanel();
                }
            }

            if (this.isMobile && this.isRulesOpen) {
                const rulesPanel = document.getElementById('rulesPanel');
                const rulesToggle = document.getElementById('rulesToggle');

                if (rulesPanel && !rulesPanel.contains(e.target) &&
                    rulesToggle && !rulesToggle.contains(e.target)) {
                    this.closeRules();
                }
            }
        });
    }

    toggleLeftPanel() {
        // Solo operar en móvil. En desktop no hay panel lateral deslizable.
        if (!this.isMobile) {
            console.debug('Panel toggle ignorado: no estamos en vista móvil');
            return;
        }

        const leftPanel = document.getElementById('leftPanel');
        if (!leftPanel) {
            console.warn('Left panel no encontrado');
            return;
        }

        if (this.isPanelOpen) {
            this.closeLeftPanel();
        } else {
            this.openLeftPanel();
        }
    }

    openLeftPanel() {
        const leftPanel = document.getElementById('leftPanel');
        if (!leftPanel) return;

        leftPanel.classList.remove('mobile-hidden');
        leftPanel.classList.add('mobile-visible');
        document.body.classList.add('panel-open');

        this.isPanelOpen = true;
        console.debug('Panel izquierdo abierto');
    }

    closeLeftPanel() {
        const leftPanel = document.getElementById('leftPanel');
        if (!leftPanel) return;

        leftPanel.classList.remove('mobile-visible');
        leftPanel.classList.add('mobile-hidden');
        document.body.classList.remove('panel-open');

        this.isPanelOpen = false;
        console.debug('Panel izquierdo cerrado');
    }

    toggleRules() {
        const rulesPanel = document.getElementById('rulesPanel');
        if (!rulesPanel) return;

        if (this.isRulesOpen) {
            this.closeRules();
        } else {
            this.openRules();
        }
    }

    openRules() {
        const rulesPanel = document.getElementById('rulesPanel');
        rulesPanel.classList.add('show');
        this.isRulesOpen = true;
    }

    closeRules() {
        const rulesPanel = document.getElementById('rulesPanel');
        rulesPanel.classList.remove('show');
        this.isRulesOpen = false;
    }

    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;

        if (wasMobile !== this.isMobile) {
            if (!this.isMobile) {
                this.closeLeftPanel();
                this.closeRules();
                document.body.style.overflow = '';
            }
        }

        if (window.automaton) {
            setTimeout(() => window.automaton.render(), 100);
        }
    }
}