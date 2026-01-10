class Cache {
    constructor() {
        this._cache = new WeakMap();
        this._timeouts = new Map();
    }

    set(key, value, ttl = 60000) { // TTL por defecto 1 minuto
        const item = {value, expiry: Date.now() + ttl};
        this._cache.set(key, item);

        // Auto-cleanup
        const timeout = setTimeout(() => {
            this._cache.delete(key);
            this._timeouts.delete(key);
        }, ttl);

        this._timeouts.set(key, timeout);
    }

    get(key) {
        const item = this._cache.get(key);
        if (!item) return undefined;

        if (Date.now() > item.expiry) {
            this._cache.delete(key);
            return undefined;
        }

        return item.value;
    }

    clear() {
        this._cache = new WeakMap();
        this._timeouts.forEach(timeout => clearTimeout(timeout));
        this._timeouts.clear();
    }
}

// Uso para optimizar cálculos de vecindad
window.neighborCache = new Cache();