class EventBus {
    constructor() {
        this.events = new Map();
        console.debug('🔌 EventBus inicializado');
    }

    on(event, callback, context = null) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }

        const handler = context ? callback.bind(context) : callback;
        handler._original = callback;
        this.events.get(event).add(handler);

        console.debug(`📡 Suscripción a "${event}" registrada`);

        return () => {
            const handlers = this.events.get(event);
            if (handlers) {
                handlers.forEach(h => {
                    if (h._original === callback) {
                        handlers.delete(h);
                        console.debug(`📡 Suscripción a "${event}" eliminada`);
                    }
                });
            }
        };
    }

    emit(event, ...args) {
        if (!this.events.has(event)) {
            console.debug(`📡 Evento "${event}" emitido (sin listeners)`);
            return;
        }

        const handlers = this.events.get(event);
        console.debug(`📡 Evento "${event}" emitido a ${handlers.size} listeners`, args);

        handlers.forEach(handler => {
            try {
                handler(...args);
            } catch (e) {
                console.error(`❌ Error en handler del evento ${event}:`, e);
            }
        });
    }

    destroy() {
        console.debug('🔌 EventBus destruido');
        this.events.clear();
    }
}

window.eventBus = new EventBus();