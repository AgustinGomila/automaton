// Responsive Controller para móviles
class ResponsiveController {
    constructor() {
        this.isMobile = window.innerWidth <= 768;
        this.isPanelOpen = false;
        this.isRulesOpen = false;

        this.init();
    }

    init() {
        this.bindEvents();
        this.adjustForMobile();

        window.addEventListener('resize', () => this.handleResize());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.handleResize(), 100);
        });
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

        // Botón para cerrar panel - CORREGIDO
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

    adjustForMobile() {
        if (!this.isMobile) return;

        // Ajustar patrones para móviles
        const container = document.getElementById('patternsContainer');
        if (container) {
            // En móviles, por defecto 1 fila
            container.classList.remove('two-rows');
            container.classList.remove('compact-view');

            // Ocultar controles de patrones en móviles muy pequeños
            const controls = document.querySelector('.patterns-controls');
            if (controls && window.innerWidth < 480) {
                controls.style.display = 'none';
            }
        }

        // Ajustar tamaño de grid para móviles si es muy grande
        const gridSizeInput = document.getElementById('gridSize');
        if (gridSizeInput && parseInt(gridSizeInput.value) > 50) {
            gridSizeInput.value = '40';
            if (window.automaton) {
                window.automaton.resizeGrid(40);
            }
        }

        // Ajustar zoom para mejor visibilidad en móviles
        const cellSizeInput = document.getElementById('cellSize');
        if (cellSizeInput && parseInt(cellSizeInput.value) < 8) {
            cellSizeInput.value = '10';
            if (window.automaton) {
                window.automaton.setCellSize(10);
            }
        }
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

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.responsiveController = new ResponsiveController();
    }, 500);
});