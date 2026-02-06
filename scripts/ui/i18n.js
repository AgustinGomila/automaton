/**
 * Sistema de Internacionalización (i18n) para Autómata Celular
 * Soporta: Español (es) - default, Inglés (en)
 */
class I18n {
    constructor() {
        this.currentLocale = 'es';
        this.fallbackLocale = 'es';
        this.translations = {};
        this.observers = new Set();
        this._initialized = false;

        this._init();
    }

    _init() {
        // Cargar traducciones embebidas
        this._loadTranslations();

        // Detectar idioma preferido
        const savedLocale = localStorage.getItem('automaton-locale');
        const browserLocale = navigator.language?.split('-')[0];
        const detectedLocale = savedLocale || (browserLocale === 'en' ? 'en' : 'es');

        this.setLocale(detectedLocale, false); // false = no actualizar DOM todavía

        console.debug(`🌐 I18n inicializado: ${this.currentLocale}`);
    }

    /**
     * Inicialización completa después de que el DOM esté listo
     * Llamar esto desde main.js o DOMContentLoaded
     */
    initDOM() {
        if (this._initialized) return;

        this._initialized = true;
        this.updateDOM();

        // Escuchar cambios de idioma del selector
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.value = this.currentLocale;
            languageSelect.addEventListener('change', (e) => {
                this.setLocale(e.target.value);
            });
        }

        console.debug('🌐 I18n DOM inicializado');
    }

    /**
     * Carga todas las traducciones embebidas
     * @private
     */
    _loadTranslations() {
        this.translations = {
            es: {
                // Meta
                'app.title': 'Autómata Celular',
                'app.title.wolfram': 'Autómata Celular - Wolfram R{rule}',
                'app.title.rd2d': 'Autómata Celular - RD-2D',

                // Header
                'header.title': 'Autómata - {ruleName}',
                'header.rules.birth': 'Nacimiento:',
                'header.rules.survival': 'Supervivencia:',
                'header.rules.neighbors': 'vecinos',
                'header.rules.notation': 'Notación:',
                'header.neighborhood': 'Vecindad: {type} (R{radius}) {wrap}',
                'header.coords': 'X: {x}, Y: {y}',

                // Controles principales
                'controls.play': 'Ejecutar',
                'controls.pause': 'Pausar',
                'controls.step': 'Paso',
                'controls.undo': 'Atrás',
                'controls.clear': 'Limpiar',
                'controls.cancel': 'Cancelar',
                'controls.help': 'Ayuda',
                'controls.random': 'Aleatorio',
                'controls.export': 'Exportar',

                // Tooltips
                'tooltip.grid': 'Mostrar/Ocultar Grilla (G)',
                'tooltip.influence': 'Área de Influencia',
                'tooltip.export': 'Exportar Patrón',
                'tooltip.speed.slower': 'Más lento',
                'tooltip.speed.faster': 'Más rápido',
                'tooltip.patterns.rows': 'Alternar 1/2 filas',
                'tooltip.patterns.compact': 'Vista compacta',

                // Configuración
                'config.title': 'Configuración',
                'config.rule': 'Regla:',
                'config.rule.custom': 'Personalizada',
                'config.rule.custom.apply': 'Aplicar Regla',
                'config.neighborhood': 'Vecindad:',
                'config.neighborhood.moore': 'Moore (8 vecinos)',
                'config.neighborhood.neumann': 'Neumann (4 vecinos)',
                'config.neighborhood.neumann.short': 'vecinos',
                'config.radius': 'Radio:',
                'config.radius.near': 'Cerca',
                'config.radius.far': 'Lejos',
                'config.gridSize': 'Tamaño:',
                'config.gridSize.small': 'Pequeño',
                'config.gridSize.medium': 'Medio',
                'config.gridSize.large': 'Grande',
                'config.zoom': 'Zoom:',
                'config.wrap': 'Modo Toroidal (wrap)',
                'config.worker': 'Usar Worker (grids >100)',
                'config.influence': 'Mostrar área de influencia',
                'config.activity': 'Colorear células activas',
                'config.density': 'Densidad',
                'config.speed': 'Velocidad:',
                'config.speed.slow': 'Lento',
                'config.speed.normal': 'Normal',
                'config.speed.fast': 'Rápido',
                'config.language': 'Idioma:',

                // Límites
                'config.limit': 'Límite:',
                'config.limit.none': 'Sin límite',
                'config.limit.generations': 'Generaciones',
                'config.limit.population': 'Población',
                'config.limit.value': 'Valor:',
                'config.limit.low': 'Bajo',
                'config.limit.medium': 'Medio',
                'config.limit.high': 'Alto',

                // Wolfram
                'wolfram.title': 'Wolfram 1D',
                'wolfram.enable': 'Activar Modo 1D',
                'wolfram.rule': 'Regla (0-255):',
                'wolfram.direction': 'Dirección de evolución',
                'wolfram.vertical': '↓ Vertical (top-down)',
                'wolfram.horizontal': '→ Horizontal (left-right)',
                'wolfram.preset.30': '30 (Caos)',
                'wolfram.preset.90': '90 (Sierpiński)',
                'wolfram.preset.110': '110 (Universal)',
                'wolfram.preset.184': '184 (Tráfico)',
                'wolfram.resetSeed': 'Semilla restablecida',
                'wolfram.vertical.short': 'Vertical',
                'wolfram.horizontal.short': 'Horizontal',
                'wolfram.binary': 'Binario:',
                'wolfram.progress': 'Progreso:',
                'wolfram.neighborhood': 'Wolfram 1D (Vecindad: 3 celdas)',

                // RD-2D
                'rd2d.title': 'RD-2D',
                'rd2d.enable': 'Distinción Recursiva 2D',
                'rd2d.states': '16 estados: [N,S,E,W]',
                'rd2d.rule': 'Regla: XOR de vecinos',
                'rd2d.states.label': 'Estados',
                'rd2d.rule.label': 'Regla',
                'rd2d.neighbors': 'vecinos',
                'rd2d.alive': 'Activas',
                'rd2d.neighborhood': 'RD-2D: Von Neumann (4 vecinos)',

                // Estadísticas
                'stats.generation': 'Generación',
                'stats.population': 'Población',
                'stats.density': 'Densidad',

                // Patrones
                'patterns.title': 'Patrones',
                'patterns.select': 'Selecciona un patrón',
                'patterns.details': 'Clic en un patrón para seleccionarlo',
                'patterns.rotate': 'Clic derecho para rotar 90°',
                'patterns.cells': 'Células: {count}',
                'patterns.category': 'Categoría: {category}',
                'patterns.export.name': 'Patrón personalizado',
                'patterns.export.description': 'Patrón exportado desde el autómata',

                // Velocidad
                'speed.very_slow': 'Muy Lento',
                'speed.slow': 'Lento',
                'speed.normal': 'Normal',
                'speed.fast': 'Rápido',
                'speed.very_fast': 'Muy Rápido',

                // Modal de instrucciones
                'instructions.title': 'Instrucciones',
                'instructions.draw': 'Clic + arrastrar para dibujar',
                'instructions.erase': 'Ctrl + clic + arrastrar para borrar',
                'instructions.select': 'Shift + arrastrar para seleccionar área',
                'instructions.move': 'Ctrl + arrastrar selección para mover',
                'instructions.copy': 'Ctrl+Shift + arrastrar selección para copiar',
                'instructions.delete': 'Delete para borrar selección',
                'instructions.rotate': 'Clic derecho en patrón para rotar',
                'instructions.cancel': 'Botón "Cancelar" para volver a dibujo libre',
                'instructions.shortcuts': 'Atajos de teclado',
                'instructions.shortcut.space': 'Play/Pausa',
                'instructions.shortcut.s': 'Siguiente paso',
                'instructions.shortcut.r': 'Rotar patrón',
                'instructions.shortcut.a': 'Aleatorio',
                'instructions.shortcut.c': 'Limpiar',
                'instructions.shortcut.esc': 'Cancelar/Clear',
                'instructions.shortcut.undo': 'Deshacer',
                'instructions.shortcut.redo': 'Rehacer',
                'instructions.click': 'clic',
                'instructions.drag': 'arrastrar',
                'instructions.draw.suffix': 'para dibujar',
                'instructions.erase.suffix': 'para borrar',
                'instructions.select.suffix': 'para seleccionar área',
                'instructions.move.suffix': 'selección para mover',
                'instructions.copy.suffix': 'selección para copiar',
                'instructions.delete.suffix': 'para borrar selección',
                'instructions.rightClick': 'Clic derecho',
                'instructions.rotate.suffix': 'en patrón para rotar',
                'instructions.cancel.prefix': 'Botón',
                'instructions.cancel.suffix': 'para volver a dibujo libre',

                // Modos
                'mode.freeDraw': 'Modo: Dibujo libre',
                'mode.pattern': 'Modo: Patrón - {name}',

                // Notificaciones
                'notif.randomized': 'Tablero aleatorio: {density}% densidad',
                'notif.undo': 'Deshacer ejecutado',
                'notif.redo': 'Rehacer ejecutado',
                'notif.noUndo': 'No hay acciones para deshacer',
                'notif.noRedo': 'No hay acciones para rehacer',
                'notif.wolfram.enabled': 'Modo Wolfram: Regla {rule}',
                'notif.rd2d.enabled': 'Modo RD-2D: 16 estados activado',
                'notif.standard.enabled': 'Modo 2D estándar',
                'notif.pattern.exported': 'Patrón exportado correctamente',
                'notif.pattern.empty': 'No hay patrón para exportar',
                'notif.rd2d.error': 'Error cargando motor RD-2D',
                'notif.wolfram.error': 'Error cargando motor Wolfram',
                'notif.automata.error': 'Error: Autómata no listo',
                'notif.rule.enabled': 'Regla {rule} activada',

                // Footer
                'footer.github': 'Código en GitHub',
                'footer.config': 'Configuración',

                // Botones móviles
                'mobile.close': 'Cerrar',
                'mobile.menu': 'Menú',

                // Diálogos
                'confirm.resize': 'Cambiar el tamaño detendrá la simulación. ¿Continuar?',
            },

            en: {
                // Meta
                'app.title': 'Cellular Automaton',
                'app.title.wolfram': 'Cellular Automaton - Wolfram R{rule}',
                'app.title.rd2d': 'Cellular Automaton - RD-2D',

                // Header
                'header.title': 'Automaton - {ruleName}',
                'header.rules.birth': 'Birth:',
                'header.rules.survival': 'Survival:',
                'header.rules.neighbors': 'neighbors',
                'header.rules.notation': 'Notation:',
                'header.neighborhood': 'Neighborhood: {type} (R{radius}) {wrap}',
                'header.coords': 'X: {x}, Y: {y}',

                // Controles principales
                'controls.play': 'Play',
                'controls.pause': 'Pause',
                'controls.step': 'Step',
                'controls.undo': 'Undo',
                'controls.clear': 'Clear',
                'controls.cancel': 'Cancel',
                'controls.help': 'Help',
                'controls.random': 'Random',
                'controls.export': 'Export',

                // Tooltips
                'tooltip.grid': 'Show/Hide Grid (G)',
                'tooltip.influence': 'Influence Area',
                'tooltip.export': 'Export Pattern',
                'tooltip.speed.slower': 'Slower',
                'tooltip.speed.faster': 'Faster',
                'tooltip.patterns.rows': 'Toggle 1/2 rows',
                'tooltip.patterns.compact': 'Compact view',

                // Configuración
                'config.title': 'Configuration',
                'config.rule': 'Rule:',
                'config.rule.custom': 'Custom',
                'config.rule.custom.apply': 'Apply Rule',
                'config.neighborhood': 'Neighborhood:',
                'config.neighborhood.moore': 'Moore (8 neighbors)',
                'config.neighborhood.neumann': 'Neumann (4 neighbors)',
                'config.neighborhood.neumann.short': 'neighbors',
                'config.radius': 'Radius:',
                'config.radius.near': 'Near',
                'config.radius.far': 'Far',
                'config.gridSize': 'Size:',
                'config.gridSize.small': 'Small',
                'config.gridSize.medium': 'Medium',
                'config.gridSize.large': 'Large',
                'config.zoom': 'Zoom:',
                'config.wrap': 'Toroidal Mode (wrap)',
                'config.worker': 'Use Worker (grids >100)',
                'config.influence': 'Show influence area',
                'config.activity': 'Color active cells',
                'config.density': 'Density',
                'config.speed': 'Speed:',
                'config.speed.slow': 'Slow',
                'config.speed.normal': 'Normal',
                'config.speed.fast': 'Fast',
                'config.language': 'Language:',

                // Límites
                'config.limit': 'Limit:',
                'config.limit.none': 'No limit',
                'config.limit.generations': 'Generations',
                'config.limit.population': 'Population',
                'config.limit.value': 'Value:',
                'config.limit.low': 'Low',
                'config.limit.medium': 'Medium',
                'config.limit.high': 'High',

                // Wolfram
                'wolfram.title': 'Wolfram 1D',
                'wolfram.enable': 'Enable 1D Mode',
                'wolfram.rule': 'Rule (0-255):',
                'wolfram.direction': 'Evolution direction',
                'wolfram.vertical': '↓ Vertical (top-down)',
                'wolfram.horizontal': '→ Horizontal (left-right)',
                'wolfram.preset.30': '30 (Chaos)',
                'wolfram.preset.90': '90 (Sierpiński)',
                'wolfram.preset.110': '110 (Universal)',
                'wolfram.preset.184': '184 (Traffic)',
                'wolfram.resetSeed': 'Seed reset',
                'wolfram.vertical.short': 'Vertical',
                'wolfram.horizontal.short': 'Horizontal',
                'wolfram.binary': 'Binary:',
                'wolfram.progress': 'Progress:',
                'wolfram.neighborhood': 'Wolfram 1D (Neighborhood: 3 cells)',

                // RD-2D
                'rd2d.title': 'RD-2D',
                'rd2d.enable': 'Recursive Distinction 2D',
                'rd2d.states': '16 states: [N,S,E,W]',
                'rd2d.rule': 'Rule: XOR of neighbors',
                'rd2d.states.label': 'States',
                'rd2d.rule.label': 'Rule',
                'rd2d.neighbors': 'neighbors',
                'rd2d.alive': 'Alive',
                'rd2d.neighborhood': 'RD-2D: Von Neumann (4 neighbors)',

                // Estadísticas
                'stats.generation': 'Generation',
                'stats.population': 'Population',
                'stats.density': 'Density',

                // Patrones
                'patterns.title': 'Patterns',
                'patterns.select': 'Select a pattern',
                'patterns.details': 'Click a pattern to select it',
                'patterns.rotate': 'Right-click to rotate 90°',
                'patterns.cells': 'Cells: {count}',
                'patterns.category': 'Category: {category}',
                'patterns.export.name': 'Custom pattern',
                'patterns.export.description': 'Pattern exported from the automaton',

                // Velocidad
                'speed.very_slow': 'Very slow',
                'speed.slow': 'Slow',
                'speed.normal': 'Normal',
                'speed.fast': 'Fast',
                'speed.very_fast': 'Very fast',

                // Modal de instrucciones
                'instructions.title': 'Instructions',
                'instructions.draw': 'Click + drag to draw',
                'instructions.erase': 'Ctrl + click + drag to erase',
                'instructions.select': 'Shift + drag to select area',
                'instructions.move': 'Ctrl + drag selection to move',
                'instructions.copy': 'Ctrl+Shift + drag selection to copy',
                'instructions.delete': 'Delete to remove selection',
                'instructions.rotate': 'Right-click on pattern to rotate',
                'instructions.cancel': '"Cancel" button to return to free draw',
                'instructions.shortcuts': 'Keyboard shortcuts',
                'instructions.shortcut.space': 'Play/Pause',
                'instructions.shortcut.s': 'Next step',
                'instructions.shortcut.r': 'Rotate pattern',
                'instructions.shortcut.a': 'Random',
                'instructions.shortcut.c': 'Clear',
                'instructions.shortcut.esc': 'Cancel/Clear',
                'instructions.shortcut.undo': 'Undo',
                'instructions.shortcut.redo': 'Redo',
                'instructions.click': 'click',
                'instructions.drag': 'drag',
                'instructions.draw.suffix': 'to draw',
                'instructions.erase.suffix': 'to erase',
                'instructions.select.suffix': 'to select area',
                'instructions.move.suffix': 'selection to move',
                'instructions.copy.suffix': 'selection to copy',
                'instructions.delete.suffix': 'to delete selection',
                'instructions.rightClick': 'Right click',
                'instructions.rotate.suffix': 'on pattern to rotate',
                'instructions.cancel.prefix': 'Button',
                'instructions.cancel.suffix': 'to return to free draw',

                // Modos
                'mode.freeDraw': 'Mode: Free draw',
                'mode.pattern': 'Mode: Pattern - {name}',

                // Notificaciones
                'notif.randomized': 'Random board: {density}% density',
                'notif.undo': 'Undo executed',
                'notif.redo': 'Redo executed',
                'notif.noUndo': 'No actions to undo',
                'notif.noRedo': 'No actions to redo',
                'notif.wolfram.enabled': 'Wolfram Mode: Rule {rule}',
                'notif.rd2d.enabled': 'RD-2D Mode: 16 states active',
                'notif.standard.enabled': 'Standard 2D mode',
                'notif.pattern.exported': 'Pattern exported successfully',
                'notif.pattern.empty': 'No pattern to export',
                'notif.rd2d.error': 'Engine RD-2D loading error',
                'notif.wolfram.error': 'Engine Wolfram loading error',
                'notif.automata.error': 'Error: Automaton not ready',
                'notif.rule.enabled': 'Rule {rule} enabled',

                // Footer
                'footer.github': 'Code on GitHub',
                'footer.config': 'Settings',

                // Botones móviles
                'mobile.close': 'Close',
                'mobile.menu': 'Menu',

                // Diálogos
                'confirm.resize': 'Changing the size will stop the simulation. Continue?',
            }
        };
    }

    /**
     * Cambia el idioma actual
     * @param {string} locale - Código de idioma ('es', 'en')
     * @param {boolean} updateDOM - Si debe actualizar el DOM (default: true)
     */
    setLocale(locale, updateDOM = true) {
        if (!this.translations[locale]) {
            console.warn(`🌐 Locale '${locale}' no disponible, usando fallback`);
            locale = this.fallbackLocale;
        }

        const previousLocale = this.currentLocale;
        this.currentLocale = locale;
        localStorage.setItem('automaton-locale', locale);

        // Actualizar selector si existe
        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.value = locale;
        }

        // Notificar a observadores solo si cambió
        if (previousLocale !== locale) {
            this._notifyObservers();
            eventBus?.emit('i18n:localeChanged', {
                locale,
                previous: previousLocale
            });

            // Actualizar DOM si está inicializado
            if (updateDOM && this._initialized) {
                this.updateDOM();
            }
        }

        return this;
    }

    /**
     * Obtiene el idioma actual
     * @returns {string}
     */
    getLocale() {
        return this.currentLocale;
    }

    /**
     * Lista de idiomas disponibles
     * @returns {Array<{code: string, name: string}>}
     */
    getAvailableLocales() {
        return [
            {code: 'es', name: 'Español'},
            {code: 'en', name: 'English'}
        ];
    }

    /**
     * Traduce una clave con interpolación de variables
     * @param {string} key - Clave de traducción
     * @param {Object} vars - Variables para interpolación {varName: value}
     * @returns {string}
     */
    t(key, vars = {}) {
        const translation = this._getTranslation(key);
        return this._interpolate(translation, vars);
    }

    /**
     * Obtiene la traducción raw (sin interpolar)
     * @private
     */
    _getTranslation(key) {
        const localeData = this.translations[this.currentLocale];
        const fallbackData = this.translations[this.fallbackLocale];

        if (localeData?.[key] !== undefined) {
            return localeData[key];
        }

        if (fallbackData?.[key] !== undefined) {
            console.warn(`🌐 Key '${key}' no encontrada en '${this.currentLocale}', usando fallback`);
            return fallbackData[key];
        }

        console.warn(`🌐 Key '${key}' no encontrada en ningún locale`);
        return key; // Devolver la clave como fallback último
    }

    /**
     * Interpola variables en el string de traducción
     * @private
     */
    _interpolate(str, vars) {
        return str.replace(/\{(\w+)\}/g, (match, varName) => {
            return vars[varName] !== undefined ? vars[varName] : match;
        });
    }

    /**
     * Registra un observador para cambios de idioma
     * @param {Function} callback - Función a llamar cuando cambie el idioma
     * @returns {Function} - Función para desregistrar
     */
    onLocaleChange(callback) {
        this.observers.add(callback);
        return () => this.observers.delete(callback);
    }

    /**
     * Notifica a todos los observadores
     * @private
     */
    _notifyObservers() {
        this.observers.forEach(cb => {
            try {
                cb(this.currentLocale);
            } catch (e) {
                console.error('Error en observer de i18n:', e);
            }
        });
    }

    /**
     * Actualiza todos los elementos DOM con atributo data-i18n
     * SOLO elementos estáticos, NO elementos dinámicos
     */
    updateDOM() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const varsAttr = el.getAttribute('data-i18n-vars');
            let vars = {};

            if (varsAttr && varsAttr.trim() !== '') {
                try {
                    vars = JSON.parse(varsAttr);
                } catch (e) {
                    console.warn('Error parseando data-i18n-vars:', e);
                    vars = {};
                }
            }

            const translation = this.t(key, vars);

            if (el.hasAttribute('data-i18n-attr')) {
                const attr = el.getAttribute('data-i18n-attr');
                el.setAttribute(attr, translation);
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = translation;
            } else {
                el.textContent = translation;
            }
        });

        // Actualizar título del documento (sin variables)
        document.title = this.t('app.title');
    }
}

// Instancia global
window.i18n = new I18n();

// Función helper global para acceso rápido
window.t = (key, vars) => window.i18n.t(key, vars);