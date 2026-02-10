// scripts/utils/circular-array.js
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
        if (this.size < this.maxSize) {
            this.buffer[this.tail] = item;
            this.tail = (this.tail + 1) % this.maxSize;
            this.size++;
        } else {
            this.buffer[this.tail] = item;
            this.tail = (this.tail + 1) % this.maxSize;
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

    * [Symbol.iterator]() {
        for (let i = 0; i < this.size; i++) {
            yield this.get(i);
        }
    }
}

window.CircularArray = CircularArray;