/**
 * Grid resize UI patch — reemplaza la lógica de un único slider gridSize
 * por dos sliders independientes (gridWidth / gridHeight) con opción de
 * bloquear la proporción.
 *
 * Este archivo exporta las funciones que UIController debe incorporar.
 * Se aplican como métodos adicionales al prototipo de UIController después
 * de la carga del script principal para no duplicar la clase completa.
 *
 * Métodos públicos añadidos:
 *   updateGridWidth()    — reacciona al slider de ancho
 *   updateGridHeight()   — reacciona al slider de alto
 *   updateGridSizeDisplay() — actualiza ambos displays
 *   _applyGridSizeChange()  — aplica el resize pendiente (debounced)
 *   _syncAspectRatio(axis)  — propaga cambio al otro eje si está bloqueado
 *
 * El HTML correspondiente agrega:
 *   #gridWidth   — slider 20-1000
 *   #gridHeight  — slider 20-1000
 *   #gridAspectLock — checkbox de bloqueo
 *   #gridWidthValue  / #gridHeightValue — displays
 *   (El slider original #gridSize se puede ocultar o eliminar)
 */

(function patchUIControllerForRectangularGrid() {
    'use strict';

    // Espera a que UIController esté disponible, luego aplica el parche
    function applyPatch() {
        if (typeof UIController === 'undefined') {
            setTimeout(applyPatch, 50);
            return;
        }

        const proto = UIController.prototype;

        // ─── Estado interno del resize rectangular ────────────────────────────
        // Se guarda en la instancia con prefijo _rect para no colisionar con
        // los campos existentes.

        // ─── Sobrescribir _bindEvents para añadir listeners rectangulares ──────
        const _origBindEvents = proto._bindEvents;
        proto._bindEvents = function () {
            _origBindEvents.call(this);
            this._bindRectGridEvents();
        };

        // ─── Nuevos listeners ─────────────────────────────────────────────────
        proto._bindRectGridEvents = function () {
            const widthSlider = document.getElementById('gridWidth');
            const heightSlider = document.getElementById('gridHeight');
            const lockChk = document.getElementById('gridAspectLock');

            if (widthSlider) {
                this._addEventListener(widthSlider, 'input', () => this.updateGridWidth());
            }
            if (heightSlider) {
                this._addEventListener(heightSlider, 'input', () => this.updateGridHeight());
            }
            if (lockChk) {
                this._addEventListener(lockChk, 'change', () => {
                    // Al activar bloqueo, calcular la ratio actual
                    if (lockChk.checked) {
                        const w = parseInt(document.getElementById('gridWidth')?.value || this.automaton.gridWidth);
                        const h = parseInt(document.getElementById('gridHeight')?.value || this.automaton.gridHeight);
                        this._rectAspectRatio = h > 0 ? w / h : 1;
                    }
                });
            }
        };

        // ─── Actualización de los displays ────────────────────────────────────
        const _origUpdateGridSizeDisplay = proto.updateGridSizeDisplay;
        proto.updateGridSizeDisplay = function () {
            // Actualizar display del slider legacy (#gridSize) si existe
            const legacySlider = document.getElementById('gridSize');
            const legacyDisplay = document.getElementById('gridSizeValue');
            if (legacySlider && legacyDisplay) {
                const v = parseInt(legacySlider.value);
                legacyDisplay.textContent = `${v}×${v}`;
            }
            // Actualizar displays rectangulares
            this._updateRectDisplays();
        };

        proto._updateRectDisplays = function () {
            const wSlider = document.getElementById('gridWidth');
            const hSlider = document.getElementById('gridHeight');
            const wDisplay = document.getElementById('gridWidthValue');
            const hDisplay = document.getElementById('gridHeightValue');
            if (wSlider && wDisplay) wDisplay.textContent = wSlider.value;
            if (hSlider && hDisplay) hDisplay.textContent = hSlider.value;

            // Badge de dimensiones combinadas
            const badge = document.getElementById('gridDimensionsBadge');
            if (badge) {
                const w = wSlider ? parseInt(wSlider.value) : this.automaton.gridWidth;
                const h = hSlider ? parseInt(hSlider.value) : this.automaton.gridHeight;
                badge.textContent = `${w}×${h}`;
                badge.classList.toggle('rect-badge', w !== h);
            }
        };

        // ─── Handlers de los sliders ──────────────────────────────────────────

        proto.updateGridWidth = function () {
            const slider = document.getElementById('gridWidth');
            if (!slider) return;
            const value = parseInt(slider.value);
            this._syncAspectRatio('width', value);
            this._updateRectDisplays();
            this._scheduleRectResize();
        };

        proto.updateGridHeight = function () {
            const slider = document.getElementById('gridHeight');
            if (!slider) return;
            const value = parseInt(slider.value);
            this._syncAspectRatio('height', value);
            this._updateRectDisplays();
            this._scheduleRectResize();
        };

        /**
         * Si el bloqueo de aspecto está activo, propaga el cambio al otro eje.
         * @param {'width'|'height'} axis  — eje que cambió
         * @param {number}           value — nuevo valor del eje que cambió
         */
        proto._syncAspectRatio = function (axis, value) {
            const lockChk = document.getElementById('gridAspectLock');
            if (!lockChk?.checked) return;

            const ratio = this._rectAspectRatio || 1;
            const clamp = v => Math.max(20, Math.min(1000, Math.round(v)));

            if (axis === 'width') {
                const newH = clamp(value / ratio);
                const hSlider = document.getElementById('gridHeight');
                if (hSlider) {
                    hSlider.value = newH;
                    const hDisplay = document.getElementById('gridHeightValue');
                    if (hDisplay) hDisplay.textContent = newH;
                }
            } else {
                const newW = clamp(value * ratio);
                const wSlider = document.getElementById('gridWidth');
                if (wSlider) {
                    wSlider.value = newW;
                    const wDisplay = document.getElementById('gridWidthValue');
                    if (wDisplay) wDisplay.textContent = newW;
                }
            }
        };

        /**
         * Programa el redimensionado con debounce compartido para ambos sliders.
         */
        proto._scheduleRectResize = function () {
            if (this._gridSizeDebounceTimer) clearTimeout(this._gridSizeDebounceTimer);
            const w = parseInt(document.getElementById('gridWidth')?.value || this.automaton.gridWidth);
            const h = parseInt(document.getElementById('gridHeight')?.value || this.automaton.gridHeight);
            this._gridSizePendingValue = w;  // reutilizar campo existente
            this._gridSizePendingHeight = h;

            this._gridSizeDebounceTimer = setTimeout(() => {
                this._applyRectGridSizeChange();
            }, 500);
        };

        // ─── Sobrescribir _applyGridSizeChange para aceptar rectangulares ─────
        const _origApplyGridSizeChange = proto._applyGridSizeChange;
        proto._applyGridSizeChange = function () {
            // Si hay dimensiones rectangulares pendientes, usarlas
            if (this._gridSizePendingHeight !== undefined) {
                this._applyRectGridSizeChange();
            } else {
                _origApplyGridSizeChange.call(this);
            }
        };

        proto._applyRectGridSizeChange = function () {
            const w = this._gridSizePendingValue;
            const h = this._gridSizePendingHeight;
            if (w == null || h == null) return;

            this._gridSizePendingValue = null;
            this._gridSizePendingHeight = undefined;

            if (this.automaton.isRunning) {
                this.automaton.stop();
                eventBus.emit('automaton:runningChanged', {isRunning: false});
                this._syncPlayButtonState?.();
            }

            this.automaton.resizeGrid(w, h);
            this._gridSizeDebounceTimer = null;

            // Sincronizar slider legacy si existe
            const legacySlider = document.getElementById('gridSize');
            const legacyDisplay = document.getElementById('gridSizeValue');
            const maxDim = Math.max(w, h);
            if (legacySlider) legacySlider.value = maxDim;
            if (legacyDisplay) legacyDisplay.textContent = `${w}×${h}`;
        };

        // ─── Presets rápidos de aspecto ────────────────────────────────────────

        /**
         * Aplica un preset de dimensiones.
         * @param {number} w
         * @param {number} h
         */
        proto.applyGridPreset = function (w, h) {
            const wSlider = document.getElementById('gridWidth');
            const hSlider = document.getElementById('gridHeight');
            if (wSlider) wSlider.value = w;
            if (hSlider) hSlider.value = h;
            this._updateRectDisplays();
            this.automaton.resizeGrid(w, h);
        };

        console.debug('✅ UIController parcheado para grids rectangulares');
    }

    applyPatch();
})();