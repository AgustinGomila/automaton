/**
 * scripts/main.js — Punto de entrada ESM de la aplicación.
 *
 * Cambios respecto a la versión global:
 *   - Todo importado explícitamente; sin dependencias en window.*.
 *   - eventBus.once() usado en lugar del patrón manual unbind/resolve.
 *   - window.app permanece para compatibilidad con grid-autofit y depuración.
 *   - patternManager se pasa a través de CanvasController vía UIController.
 */

import {eventBus} from './infrastructure/event-bus.js';
import {rulesLoader} from './config/rules-loader.js';
import {patternLoader} from './config/pattern-loader.js';
import {i18n} from './ui/i18n.js';
import {CellularAutomaton} from './app/automaton.js';
import {UIController} from './ui/ui-controller.js';
import {PatternManager} from './config/patterns.js';
import {ResponsiveController} from './ui/responsive-controller.js';
import {WelcomeModal} from './ui/welcome-modal.js';

class Application {
    constructor() {
        this.automaton = null;
        this.uiController = null;
        this.patternManager = null;

        this._init();
    }

    async _init() {
        try {
            // 1. Cargar reglas y patrones antes de construir la UI
            await rulesLoader.load();
            await patternLoader.load();

            // 2. Inicializar DOM de i18n (con reglas disponibles)
            i18n.initDOM();

            // 3. Crear autómata
            this.automaton = new CellularAutomaton();

            // 4. Esperar señal de listo usando eventBus.once()
            await new Promise(resolve => eventBus.once('automaton:ready', resolve));

            // 5. Crear PatternManager
            this.patternManager = new PatternManager(this.automaton);

            // 6. Crear UIController — recibe un getter de patternManager para
            //    inyectarlo en CanvasController sin acoplamiento directo al módulo.
            this.uiController = new UIController(this.automaton, {
                getPatternManager: () => this.patternManager
            });

            // Sincronizar el estado de patrón compartido entre UIController y PatternManager
            this.patternManager.setPatternState(this.uiController.getPatternState());

            // 7. Cleanup global
            this._setupGlobalCleanup();

            eventBus.emit('app:ready', {automaton: this.automaton, uiController: this.uiController});

        } catch (error) {
            console.error('❌ Error en inicialización:', error);
            eventBus.emit('app:error', error);
            this._emergencyCleanup();
        }
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
            eventBus.destroy();
        } catch (e) {
            console.warn('Error en cleanup de emergencia:', e);
        }
    }
}

// Inicialización única al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
    // Exponer window.app para compatibilidad con grid-autofit y herramientas de depuración
    window.app = new Application();

    // ResponsiveController se inicializa una vez que app:ready lleva las dependencias
    eventBus.on('app:ready', ({automaton, uiController}) => {
        // requestAnimationFrame garantiza que el layout esté pintado antes de medir
        // el área disponible para el canvas (necesario para el autofit inicial).
        requestAnimationFrame(() => {
            if (!window.responsiveController) {
                window.responsiveController = new ResponsiveController();
            }
            window.responsiveController.init(automaton, uiController);

            // Mostrar cartel de bienvenida la primera vez
            new WelcomeModal().show();
        });
    });
});