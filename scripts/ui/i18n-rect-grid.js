/**
 * i18n-rect-grid.js
 *
 * Añade las claves de traducción para los controles de grid rectangular
 * al objeto i18n existente, y parchea ResponsiveController para usar
 * dimensiones independientes en móvil.
 *
 * Cargar después de i18n.js y responsive-controller.js.
 */

(function patchI18nAndResponsive() {
    'use strict';

    // ── 1. Claves i18n ────────────────────────────────────────────────────────

    function addI18nKeys() {
        if (typeof window.i18n === 'undefined') {
            setTimeout(addI18nKeys, 50);
            return;
        }

        const esKeys = {
            'config.gridWidth': 'Ancho',
            'config.gridHeight': 'Alto',
            'config.gridAspectLock': 'Proporción fija',
            'config.gridPresets': 'Presets',
            'notif.grid.resized': 'Grid: {w}×{h}'
        };

        const enKeys = {
            'config.gridWidth': 'Width',
            'config.gridHeight': 'Height',
            'config.gridAspectLock': 'Lock ratio',
            'config.gridPresets': 'Presets',
            'notif.grid.resized': 'Grid: {w}×{h}'
        };

        // Inyectar en las traducciones existentes
        Object.assign(window.i18n.translations.es || {}, esKeys);
        Object.assign(window.i18n.translations.en || {}, enKeys);

        // Actualizar DOM por si ya se renderizó
        if (window.i18n._initialized) window.i18n.updateDOM();
    }

    addI18nKeys();

    // ── 2. ResponsiveController patch ────────────────────────────────────────
    // Añade la gestión de gridWidth / gridHeight independientes en móvil.

    function patchResponsive() {
        if (typeof ResponsiveController === 'undefined') {
            setTimeout(patchResponsive, 50);
            return;
        }

        const origAdjust = ResponsiveController.prototype.adjustForMobile;

        ResponsiveController.prototype.adjustForMobile = function () {
            if (!this.isMobile || !this.automaton) return;

            const defaultW = 200;
            const defaultH = 200;
            const defaultCellSize = 2;

            // Sliders rectangulares
            const wSlider = document.getElementById('gridWidth');
            const hSlider = document.getElementById('gridHeight');

            const currentW = this.automaton.gridWidth;
            const currentH = this.automaton.gridHeight;

            let needsResize = false;

            if (currentW !== defaultW || currentH !== defaultH) {
                if (wSlider) wSlider.value = defaultW;
                if (hSlider) hSlider.value = defaultH;
                needsResize = true;
            }

            if (needsResize) {
                // Actualizar displays rectangulares
                const wDisplay = document.getElementById('gridWidthValue');
                const hDisplay = document.getElementById('gridHeightValue');
                const badge = document.getElementById('gridDimensionsBadge');
                if (wDisplay) wDisplay.textContent = defaultW;
                if (hDisplay) hDisplay.textContent = defaultH;
                if (badge) badge.textContent = `${defaultW}×${defaultH}`;

                // Actualizar slider legacy
                const legacySlider = document.getElementById('gridSize');
                const legacyDisplay = document.getElementById('gridSizeValue');
                if (legacySlider) legacySlider.value = defaultW;
                if (legacyDisplay) legacyDisplay.textContent = `${defaultW}×${defaultH}`;

                this.uiController?.updateGridSizeDisplay?.();
                this.automaton.resizeGrid(defaultW, defaultH);
            }

            // Cell size
            const cellSizeInput = document.getElementById('cellSize');
            const currentCellSize = this.automaton.cellSize;
            if (currentCellSize !== defaultCellSize) {
                if (cellSizeInput) cellSizeInput.value = defaultCellSize;
                this.uiController?.updateCellSizeDisplay?.();
                this.automaton.setCellSize(defaultCellSize);
            }

            this.automaton._markAllDirty();
            this.automaton.render();
        };

        console.debug('✅ ResponsiveController parcheado para grids rectangulares');
    }

    patchResponsive();

    // ── 3. Notificación al redimensionar ──────────────────────────────────────
    // Emitir una notificación breve cuando el grid cambia de forma

    eventBus?.on('automaton:resized', ({width, height}) => {
        // Solo notificar si la app ya está lista (no durante la inicialización)
        if (!window.app?.uiController) return;
        const isRect = width !== height;
        if (isRect) {
            // La notificación la mostrará UIController si quiere; aquí sólo
            // actualizamos el badge de dimensiones en la cabecera si existe.
            const badge = document.getElementById('gridDimensionsBadge');
            if (badge) {
                badge.textContent = `${width}×${height}`;
                badge.classList.toggle('rect-badge', width !== height);
            }
        }
    });

})();