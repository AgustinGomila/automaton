class PatternLoader {
    constructor() {
        this.PATTERNS = {};
        this.isLoaded = false;
    }

    async load() {
        try {
            const response = await fetch('assets/patterns.json');
            const data = await response.json();
            this.PATTERNS = data.patterns || {};
            this.isLoaded = true;
            window.PATTERNS = this.PATTERNS;
            eventBus.emit('patterns:loaded', {patterns: this.PATTERNS});
            return this.PATTERNS;
        } catch (error) {
            console.error('Error cargando patrones:', error);
            // Fallback: cargar embedded
            return this.loadEmbeddedPatterns();
        }
    }

    async loadEmbeddedPatterns() {
        // Definición de patrones predefinidos
        this.PATTERNS = defaultPatterns;
        window.PATTERNS = this.PATTERNS;
        eventBus.emit('patterns:loaded', {patterns: this.PATTERNS});
        return this.PATTERNS;
    }
}

window.patternLoader = new PatternLoader();