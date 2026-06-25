/**
 * EventBus — Canal de comunicación desacoplado entre subsistemas.
 *
 * on()   devuelve una función de cleanup que desuscribe en O(1).
 * emit() no loguea nada: se llama hasta miles de veces por segundo
 *        durante la simulación y el logging destruye el rendimiento.
 * Los errores en handlers sí se loguean (console.error) porque son
 * condiciones excepcionales que necesitan visibilidad.
 */
class EventBus {
    constructor() {
        this.events = new Map();
    }

    /**
     * Suscribe callback al evento.
     * @param {string}   event
     * @param {Function} callback
     * @param {Object}   [context]  — si se pasa, callback se bindea al contexto
     * @returns {Function} unsuscribe — llamar para cancelar la suscripción en O(1)
     */
    on(event, callback, context = null) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }

        // Guardar la referencia al handler ya-bound para poder borrarlo
        // directamente del Set en O(1), sin iterar.
        const handler = context ? callback.bind(context) : callback;
        this.events.get(event).add(handler);

        return () => {
            this.events.get(event)?.delete(handler);
        };
    }

    /**
     * Suscribe callback al evento y lo desuscribe automáticamente
     * tras la primera invocación.
     * @param   {string}   event
     * @param   {Function} callback
     * @param   {Object}   [context]
     * @returns {Function} unsuscribe anticipado (si se necesita cancelar antes del disparo)
     */
    once(event, callback, context = null) {
        const unsub = this.on(event, (...args) => {
            unsub();
            callback.apply(context, args);
        });
        return unsub;
    }

    /**
     * Emite un evento hacia todos sus listeners.
     * No loguea: este método se ejecuta en el hot path de la simulación.
     */
    emit(event, ...args) {
        const handlers = this.events.get(event);
        if (!handlers) return;

        for (const handler of handlers) {
            try {
                handler(...args);
            } catch (e) {
                console.error(`EventBus: error en handler de "${event}":`, e);
            }
        }
    }

    destroy() {
        this.events.clear();
    }
}

/**
 * Catálogo de nombres de evento.
 *
 * Centraliza los identificadores que antes vivían como strings sueltos en cada
 * emit/on. Usar la constante (en vez del literal) hace que un typo sea un
 * ReferenceError inmediato en vez de un listener que nunca dispara, y habilita
 * "buscar referencias" en el IDE.
 *
 * Convención: NAMESPACE_ACCION → 'namespace:accion'.
 */
export const Events = Object.freeze({
    // app
    APP_ERROR: 'app:error',
    APP_READY: 'app:ready',

    // automaton
    AUTOMATON_DESTROYED: 'automaton:destroyed',
    AUTOMATON_ERROR: 'automaton:error',
    AUTOMATON_FILTER_CHANGED: 'automaton:filterChanged',
    AUTOMATON_GRID_HIGHLIGHTS_TOGGLED: 'automaton:gridHighlightsToggled',
    AUTOMATON_GRID_TOGGLED: 'automaton:gridToggled',
    AUTOMATON_LIMIT_CHANGED: 'automaton:limitChanged',
    AUTOMATON_MODE_CHANGED: 'automaton:modeChanged',
    AUTOMATON_NEIGHBORHOOD_CHANGED: 'automaton:neighborhoodChanged',
    AUTOMATON_RADIUS_CHANGED: 'automaton:radiusChanged',
    AUTOMATON_RANDOMIZED: 'automaton:randomized',
    AUTOMATON_READY: 'automaton:ready',
    AUTOMATON_RESIZED: 'automaton:resized',
    AUTOMATON_RULE_CHANGED: 'automaton:ruleChanged',
    AUTOMATON_RUNNING_CHANGED: 'automaton:runningChanged',
    AUTOMATON_SHOW_ACTIVITY_EFFECT_CHANGED: 'automaton:showActivityEffectChanged',
    AUTOMATON_SPEED_CHANGED: 'automaton:speedChanged',
    AUTOMATON_WRAP_CHANGED: 'automaton:wrapChanged',
    AUTOMATON_ZOOM_CHANGED: 'automaton:zoomChanged',

    // history / state / stats / perf
    HISTORY_CHANGED: 'history:changed',
    STATE_CHANGED: 'state:changed',
    STATS_UPDATED: 'stats:updated',
    PERF_UPDATE: 'perf:update',

    // pattern(s)
    PATTERN_CLEARED: 'pattern:cleared',
    PATTERN_ROTATION_CHANGED: 'pattern:rotationChanged',
    PATTERN_SELECTED: 'pattern:selected',
    PATTERN_UPDATED: 'pattern:updated',
    PATTERNS_LOADED: 'patterns:loaded',
    PATTERNS_RENDERED: 'patterns:rendered',

    // rules
    RULES_LOADED: 'rules:loaded',

    // ui
    UI_DESTROYED: 'ui:destroyed',
    UI_READY: 'ui:ready',
});

/** Instancia singleton compartida por toda la aplicación. */
export const eventBus = new EventBus();