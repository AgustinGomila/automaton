/**
 * rect-bug-fixes.js
 *
 * Corrige tres bugs introducidos en la refactorización rectangular:
 *
 * BUG 1 — Celdas dibujadas con mouse no evolucionan (grid ≥ 600)
 * ────────────────────────────────────────────────────────────────
 * Causa: el worker usa XOR de changedCells para actualizar el grid del
 * hilo principal. Si el usuario dibuja celdas manualmente (setCell) sin
 * sincronizar el worker, el worker desconoce esas celdas, computa un paso
 * desde su estado interno, y el XOR resultante deja las celdas nuevas en
 * estado "congelado".
 *
 * Fix: al soltar el botón del mouse (mouseup / mouseleave) se llama
 * automaton._syncWorkerGrid() una única vez, que re-envía el grid completo
 * al worker asegurando coherencia antes del próximo paso.
 *
 * BUG 2 — Al desactivar ETA la altura del grid colapsaba a ~2px
 * ────────────────────────────────────────────────────────────────
 * Causa: SpecialModeController._deactivateTriangleEngine() llamaba
 *   this.automaton._resizeRenderer(this.automaton.gridSize, this.automaton.cellSize)
 * La nueva firma de _resizeRenderer(gw, gh, cs) interpretaba cellSize como
 * la altura → canvas resultante de, ej., 500 × 2.
 *
 * Fix: llamar sin argumentos para que _resizeRenderer use las dimensiones
 * actuales del autómata (gridWidth × gridHeight × cellSize).
 *
 * Cargar DESPUÉS de canvas-controller.js y special-mode-controller.js.
 */

(function applyRectBugFixes() {
    'use strict';

    // ── BUG 1: sincronizar worker tras edición manual con el pincel ──────────

    function patchCanvasControllerSync() {
        if (typeof CanvasController === 'undefined') {
            setTimeout(patchCanvasControllerSync, 50);
            return;
        }

        const proto = CanvasController.prototype;

        // Guardar referencias a los métodos originales
        const origMouseUp = proto._handleMouseUp;
        const origMouseLeave = proto._handleMouseLeave;

        /**
         * Al soltar el botón, sincronizar el worker una sola vez.
         * Esto cubre tanto el punteo simple como el arrastre de pincel.
         */
        proto._handleMouseUp = function (e) {
            origMouseUp.call(this, e);
            // Solo sincronizar si el worker está activo y no estábamos arrastrando
            // una selección o haciendo pan (esos paths ya sincronizan por su cuenta
            // a través de EditCoordinator).
            if (!this.isSelecting && !this.isDragging && !this._isPanning) {
                this.automaton?._syncWorkerGrid();
            }
        };

        /**
         * Al salir del canvas con el botón pulsado también sincronizar,
         * ya que _handleMouseLeave llama a stop del drag pero no al worker.
         */
        proto._handleMouseLeave = function () {
            origMouseLeave.call(this);
            this.automaton?._syncWorkerGrid();
        };

        console.debug('✅ rect-bug-fixes: CanvasController parcheado (worker sync)');
    }

    // ── BUG 2: Triangle deactivation height collapse ─────────────────────────

    function patchSpecialModeControllerTriangle() {
        if (typeof SpecialModeController === 'undefined') {
            setTimeout(patchSpecialModeControllerTriangle, 50);
            return;
        }

        const proto = SpecialModeController.prototype;

        /**
         * Sobrescribir _deactivateTriangleEngine para restaurar el renderer
         * estándar con las dimensiones rectangulares correctas del autómata.
         *
         * Bug original: llamaba _resizeRenderer(gridSize, cellSize) que con
         * la nueva firma (gw, gh, cs) interpretaba cellSize como altura.
         * Fix: llamar sin args → usa this.gridWidth × this.gridHeight × this.cellSize.
         */
        proto._deactivateTriangleEngine = function () {
            if (this.automaton.triangleEngine) {
                this.automaton.triangleEngine.clear?.();
                this.automaton.triangleEngine.deactivate();
                this.automaton.triangleEngine = null;
            }

            if (this.automaton._originalRenderer) {
                const oldRenderer = this.automaton.renderer;
                this.automaton.renderer = this.automaton._originalRenderer;
                this.automaton._originalRenderer = null;
                oldRenderer?.destroy?.();

                // Sin argumentos: _resizeRenderer usa gridWidth × gridHeight × cellSize
                this.automaton._resizeRenderer();
            }

            if (this.automaton._originalCore) {
                this.automaton.core = this.automaton._originalCore;
                this.automaton._originalCore = null;
            }
        };

        console.debug('✅ rect-bug-fixes: SpecialModeController parcheado (Triangle deactivate)');
    }

    patchCanvasControllerSync();
    patchSpecialModeControllerTriangle();

})();