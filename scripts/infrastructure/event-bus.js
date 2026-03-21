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

window.eventBus = new EventBus();