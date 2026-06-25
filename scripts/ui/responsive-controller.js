// scripts/ui/responsive-controller.js

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
        this.automaton = null;
        this.uiController = null;

        // Referencias estables para poder quitar los listeners en destroy().
        // Los de window/document no se liberan al remover elementos del DOM.
        this._onResize = () => this.handleResize();
        this._onOrientationChange = () => setTimeout(() => this.handleResize(), 100);
        this._onDocumentClick = (e) => this._handleDocumentClick(e);
    }

    /**
     * @param {CellularAutomaton} [automaton]    — instancia del autómata (opcional; solo
     *   necesaria para aplicar ajustes de grid/zoom en el primer arranque móvil)
     * @param {UIController}      [uiController] — solo necesario junto con automaton
     */
    init(automaton, uiController) {
        if (this._initialized) return;
        this._initialized = true;

        this.automaton = automaton;
        this.uiController = uiController;

        this.bindEvents();

        if (this.isMobile) {
            this.adjustForMobile();
        }

        window.addEventListener('resize', this._onResize);
        window.addEventListener('orientationchange', this._onOrientationChange);
    }

    /**
     * Quita los listeners globales (window/document) y libera referencias.
     * Enganchado al teardown de la app para no dejar handlers huérfanos
     * apuntando a un automaton ya destruido.
     */
    destroy() {
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('orientationchange', this._onOrientationChange);
        document.removeEventListener('click', this._onDocumentClick);
        this.automaton = null;
        this.uiController = null;
        this._initialized = false;
    }

    /**
     * Aplica los valores de grid y zoom apropiados para móviles.
     * Si automaton/uiController no están listos todavía, el caller debe
     * invocar este método cuando lo estén (ver main.js).
     */
    adjustForMobile() {
        if (!this.isMobile || !this.automaton) return;
        this.automaton._markAllDirty();
        this.automaton.render();
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
        document.addEventListener('click', this._onDocumentClick);
    }

    /**
     * Cierra el panel lateral o el de reglas si el clic ocurre fuera de ellos.
     * @param {MouseEvent} e
     */
    _handleDocumentClick(e) {
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

        if (wasMobile !== this.isMobile) {
            if (this.isMobile) {
                // Ahora es móvil: aplica ajustes
                this.adjustForMobile();
            } else {
                // Vuelve a escritorio: cierra paneles
                this.closeLeftPanel();
                this.closeRules();
                document.body.style.overflow = '';
            }
        }

        window.app?.automaton?.render();
    }
}

export {ResponsiveController};