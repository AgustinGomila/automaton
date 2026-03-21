/**
 * ResponsiveController — Ajustes de layout para móviles.
 *
 * Gestiona la apertura/cierre del panel lateral y el panel de reglas en
 * viewports pequeños, y aplica valores de grid/zoom apropiados al inicio.
 *
 * Se inicializa desde main.js después de que la app está lista (app:ready),
 * recibiendo automaton y uiController como parámetros para evitar el
 * acoplamiento implícito a window.app.
 */
class ResponsiveController {
    constructor() {
        this.isMobile = window.innerWidth <= 768;
        this.isPanelOpen = false;
        this.isRulesOpen = false;
        this._initialized = false;
    }

    /**
     * @param {CellularAutomaton} [automaton]    — instancia del autómata (opcional; solo
     *   necesaria para aplicar ajustes de grid/zoom en el primer arranque móvil)
     * @param {UIController}      [uiController] — solo necesario junto con automaton
     */
    init(automaton, uiController) {
        if (this._initialized) return;
        this._initialized = true;

        this.bindEvents();

        if (this.isMobile) {
            this.adjustForMobile(automaton, uiController);
        }

        window.addEventListener('resize', () => this.handleResize());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.handleResize(), 100);
        });
    }

    /**
     * Aplica los valores de grid y zoom apropiados para móviles.
     * Si automaton/uiController no están listos todavía, el caller debe
     * invocar este método cuando lo estén (ver main.js).
     */
    adjustForMobile(automaton, uiController) {
        if (!this.isMobile || !automaton) return;

        const defaultGridSize = 400;
        const defaultCellSize = 2;

        const gridSizeInput = document.getElementById('gridSize');
        const cellSizeInput = document.getElementById('cellSize');

        const currentGridSize = parseInt(gridSizeInput?.value) || 0;
        if (currentGridSize !== defaultGridSize) {
            if (gridSizeInput) gridSizeInput.value = String(defaultGridSize);
            uiController?.updateGridSizeDisplay();
            automaton.resizeGrid(defaultGridSize);
        }

        const currentCellSize = parseInt(cellSizeInput?.value) || 0;
        if (currentCellSize !== defaultCellSize) {
            if (cellSizeInput) cellSizeInput.value = String(defaultCellSize);
            uiController?.updateCellSizeDisplay();
            automaton.setCellSize(defaultCellSize);
        }

        automaton._markAllDirty();
        automaton.render();

        const container = document.getElementById('patternsContainer');
        if (container) {
            container.classList.remove('two-rows', 'compact-view');

            const controls = document.querySelector('.patterns-controls');
            if (controls && window.innerWidth < 480) {
                controls.style.display = 'none';
            }
        }
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
        if (!this.isMobile) return;
        const leftPanel = document.getElementById('leftPanel');
        if (!leftPanel) return;
        this.isPanelOpen ? this.closeLeftPanel() : this.openLeftPanel();
    }

    openLeftPanel() {
        const leftPanel = document.getElementById('leftPanel');
        if (!leftPanel) return;
        leftPanel.classList.remove('mobile-hidden');
        leftPanel.classList.add('mobile-visible');
        document.body.classList.add('panel-open');
        this.isPanelOpen = true;
    }

    closeLeftPanel() {
        const leftPanel = document.getElementById('leftPanel');
        if (!leftPanel) return;
        leftPanel.classList.remove('mobile-visible');
        leftPanel.classList.add('mobile-hidden');
        document.body.classList.remove('panel-open');
        this.isPanelOpen = false;
    }

    toggleRules() {
        const rulesPanel = document.getElementById('rulesPanel');
        if (!rulesPanel) return;
        this.isRulesOpen ? this.closeRules() : this.openRules();
    }

    openRules() {
        document.getElementById('rulesPanel')?.classList.add('show');
        this.isRulesOpen = true;
    }

    closeRules() {
        document.getElementById('rulesPanel')?.classList.remove('show');
        this.isRulesOpen = false;
    }

    handleResize() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 768;

        if (wasMobile !== this.isMobile && !this.isMobile) {
            this.closeLeftPanel();
            this.closeRules();
            document.body.style.overflow = '';
        }

        window.app?.automaton?.render();
    }
}