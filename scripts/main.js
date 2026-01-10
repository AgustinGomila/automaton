// scripts/main.js - VERSIÓN FINAL CORREGIDA
class Application {
    constructor() {
        this.automaton = null;
        this.uiController = null;
        this.responsiveController = null;
        this.patternManager = null;

        this._appState = {
            selectedPattern: null,
            selectedPatternKey: null,
            selectedPatternRotation: 0
        };

        this._init();
    }

    async _init() {
        try {
            // 1. Cargar reglas primero
            await this._loadRules();

            // 2. Crear autómata
            this.automaton = new CellularAutomaton();

            // 3. Esperar que esté listo
            await new Promise(resolve => {
                const unbind = eventBus.on('automaton:ready', () => {
                    unbind();
                    resolve();
                });
            });

            // 4. Crear PatternManager (ESTO LLAMA A renderPatterns() INTERNAMENTE)
            this.patternManager = new PatternManager(this.automaton);
            window.patternManager = this.patternManager;

            // 5. Crear UI Controller
            this.uiController = new UIController(this.automaton);

            // 6. Crear Responsive Controller
            this.responsiveController = new ResponsiveController();

            // 7. Cleanup global
            this._setupGlobalCleanup();

            console.debug('✅ Aplicación inicializada completamente');
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

            if (this.automaton?.worker) {
                this.automaton.worker.terminate();
                this.automaton.worker = null;
            }

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
});

// =========================================
// BRIDGE TEMPORAL PARA COMPATIBILIDAD RETROACTIVA
// Eliminar tras migrar completamente todo el código a eventos
// =========================================

// Solo crear el bridge después de que la app esté lista
eventBus.on('app:ready', () => {
    // Getter/Setter para selectedPattern
    Object.defineProperty(window, 'selectedPattern', {
        get: () => window.app?.uiController?._patternState?.pattern || null,
        set: (val) => {
            if (window.app?.uiController) {
                window.app.uiController._patternState.pattern = val;
            }
        },
        configurable: true
    });

    // Getter/Setter para selectedPatternKey
    Object.defineProperty(window, 'selectedPatternKey', {
        get: () => window.app?.uiController?._patternState?.key || null,
        set: (val) => {
            if (window.app?.uiController) {
                window.app.uiController._patternState.key = val;
            }
        },
        configurable: true
    });

    // Getter/Setter para selectedPatternRotation
    Object.defineProperty(window, 'selectedPatternRotation', {
        get: () => window.app?.uiController?._patternState?.rotation || 0,
        set: (val) => {
            if (window.app?.uiController) {
                window.app.uiController._patternState.rotation = val;
            }
        },
        configurable: true
    });
});
