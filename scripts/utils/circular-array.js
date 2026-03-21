/**
 * CircularArray — Buffer circular de tamaño fijo con política LRU.
 *
 * Cuando está lleno, push() sobreescribe el elemento más antiguo.
 * Útil para el historial de población donde solo interesa la ventana reciente.
 */
class CircularArray {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.buffer = new Array(maxSize);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }

    get length() {
        return this.size;
    }

    push(item) {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.maxSize;
        if (this.size < this.maxSize) {
            this.size++;
        } else {
            // Buffer lleno: avanzar head para descartar el más antiguo
            this.head = this.tail;
        }
    }

    get(index) {
        if (index < 0 || index >= this.size) return undefined;
        return this.buffer[(this.head + index) % this.maxSize];
    }

    clear() {
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }

    /**
     * Devuelve los elementos en orden de inserción como Array plano.
     * Usado por StateManager.getPopulationHistory(), getPopulationTrend()
     * y serializeFull().
     * @returns {Array}
     */
    toArray() {
        const result = new Array(this.size);
        for (let i = 0; i < this.size; i++) {
            result[i] = this.buffer[(this.head + i) % this.maxSize];
        }
        return result;
    }

    * [Symbol.iterator]() {
        for (let i = 0; i < this.size; i++) {
            yield this.get(i);
        }
    }
}

window.CircularArray = CircularArray;