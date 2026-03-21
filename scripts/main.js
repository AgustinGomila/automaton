// scripts/main.js
class Application {
    constructor() {
        this.automaton = null;
        this.uiController = null;
        this.patternManager = null;

        this._init();
    }

    async _init() {
        try {
            // 1. Cargar reglas y patrones primero
            await this._loadRules();
            await window.patternLoader.load();

            // 2. Inicializar DOM de i18n (con reglas disponibles)
            i18n.initDOM();

            // 3. Crear autómata
            this.automaton = new CellularAutomaton();

            // 4. Esperar que esté listo
            await new Promise(resolve => {
                const unbind = eventBus.on('automaton:ready', () => {
                    unbind();
                    resolve();
                });
            });

            // 5. Crear PatternManager
            this.patternManager = new PatternManager(this.automaton);
            window.patternManager = this.patternManager;

            // 6. Crear UI Controller
            this.uiController = new UIController(this.automaton);

            // Compartir el estado de patrón entre UIController y PatternManager
            // usando la API pública en lugar del campo interno _patternState.
            this.patternManager.setPatternState(this.uiController.getPatternState());

            // 7. Cleanup global
            this._setupGlobalCleanup();

            eventBus.emit('app:ready');

        } catch (error) {
            console.error('❌ Error en inicialización:', error);
            eventBus.emit('app:error', error);
            this._emergencyCleanup();
        }
    }

    async _loadRules() {
        if (!window.rulesLoader) {
            throw new Error('RulesLoader no está disponible');
        }
        return window.rulesLoader.load();
    }

    _setupGlobalCleanup() {
        window.addEventListener('beforeunload', () => this._emergencyCleanup());
        window.addEventListener('error', (e) => {
            console.error('Error crítico:', e.error);
            this._emergencyCleanup();
        });
    }

    _emergencyCleanup() {
        try {
            this.uiController?.destroy();
            this.automaton?.destroy();
            this.patternManager?.destroy();
            window.eventBus?.destroy();
        } catch (e) {
            console.warn('Error en cleanup de emergencia:', e);
        }
    }
}

// Inicialización ÚNICA
document.addEventListener('DOMContentLoaded', () => {
    window.app = new Application();

    // ResponsiveController recibe automaton y uiController directamente
    // para evitar el acoplamiento a window.app dentro del controlador.
    eventBus.on('app:ready', () => {
        setTimeout(() => {
            if (!window.responsiveController) {
                window.responsiveController = new ResponsiveController();
            }
            const {automaton, uiController} = window.app;
            window.responsiveController.init(automaton, uiController);
        }, 50);
    });
});