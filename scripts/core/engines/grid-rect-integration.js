/**
 * grid-rect-integration.js
 *
 * Integra la UI de grid rectangular en la instancia viva de UIController.
 *
 * Se ejecuta DESPUÉS de que app:ready sea emitido, cuando UIController
 * ya existe en window.app.uiController. Realiza tres tareas:
 *
 *   1. Sincroniza los sliders #gridWidth / #gridHeight con las dimensiones
 *      actuales del autómata al arrancar.
 *
 *   2. Activa el display de ratio y el feedback visual del candado.
 *
 *   3. Registra los listeners de los botones de preset .btn-grid-preset.
 *
 * El parche de métodos sobre el prototipo ya fue aplicado por
 * ui-grid-rect-patch.js, que se carga antes de este archivo.
 */

(function initRectGridUI() {
    'use strict';

    function run() {
        const app = window.app;
        if (!app?.uiController || !app?.automaton) {
            setTimeout(run, 100);
            return;
        }

        const ui = app.uiController;
        const automaton = app.automaton;

        // ── 1. Sincronizar sliders con el estado actual del autómata ──────────
        _syncSlidersToAutomaton(automaton);

        // ── 2. Display de ratio + feedback visual del candado ─────────────────
        _setupAspectLockFeedback(automaton);

        // ── 3. Botones de preset ──────────────────────────────────────────────
        _bindPresetButtons(ui, automaton);

        // ── 4. Actualizar displays al cambiar el grid (por resize externo) ────
        eventBus.on('automaton:resized', ({width, height}) => {
            const wSlider = document.getElementById('gridWidth');
            const hSlider = document.getElementById('gridHeight');
            const wDisplay = document.getElementById('gridWidthValue');
            const hDisplay = document.getElementById('gridHeightValue');
            if (wSlider) wSlider.value = width;
            if (hSlider) hSlider.value = height;
            if (wDisplay) wDisplay.textContent = width;
            if (hDisplay) hDisplay.textContent = height;
            _updateRatioBadge(width, height);
        });
    }

    // ─── Sincronización inicial ───────────────────────────────────────────────

    function _syncSlidersToAutomaton(automaton) {
        const w = automaton.gridWidth;
        const h = automaton.gridHeight;

        const wSlider = document.getElementById('gridWidth');
        const hSlider = document.getElementById('gridHeight');
        const wDisplay = document.getElementById('gridWidthValue');
        const hDisplay = document.getElementById('gridHeightValue');
        const badge = document.getElementById('gridDimensionsBadge');

        if (wSlider) wSlider.value = w;
        if (hSlider) hSlider.value = h;
        if (wDisplay) wDisplay.textContent = w;
        if (hDisplay) hDisplay.textContent = h;
        if (badge) {
            badge.textContent = `${w}×${h}`;
            badge.classList.toggle('rect-badge', w !== h);
        }

        _updateRatioBadge(w, h);
    }

    // ─── Feedback visual del candado ──────────────────────────────────────────

    function _setupAspectLockFeedback(automaton) {
        const lockChk = document.getElementById('gridAspectLock');
        const lockIcon = document.getElementById('gridAspectLockIcon');
        const ratioBadge = document.getElementById('gridAspectRatioDisplay');

        if (!lockChk) return;

        lockChk.addEventListener('change', () => {
            const locked = lockChk.checked;

            // Actualizar icono
            if (lockIcon) {
                lockIcon.innerHTML = locked
                    ? '<i class="fas fa-lock"></i>'
                    : '<i class="fas fa-link"></i>';
                lockIcon.classList.toggle('locked', locked);
            }

            if (locked) {
                // Calcular ratio actual y almacenarla en la instancia de UI
                const w = parseInt(document.getElementById('gridWidth')?.value || automaton.gridWidth);
                const h = parseInt(document.getElementById('gridHeight')?.value || automaton.gridHeight);
                if (window.app?.uiController) {
                    window.app.uiController._rectAspectRatio = h > 0 ? w / h : 1;
                }
                _updateRatioBadge(w, h);
            }
        });

        // Actualizar badge de ratio cada vez que cambia cualquier slider
        ['gridWidth', 'gridHeight'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const w = parseInt(document.getElementById('gridWidth')?.value || automaton.gridWidth);
                const h = parseInt(document.getElementById('gridHeight')?.value || automaton.gridHeight);
                _updateRatioBadge(w, h);
            });
        });
    }

    /**
     * Calcula el GCD para reducir la razón de aspecto a su forma simple.
     */
    function _gcd(a, b) {
        a = Math.abs(a);
        b = Math.abs(b);
        while (b) {
            [a, b] = [b, a % b];
        }
        return a;
    }

    /**
     * Actualiza el badge de razón de aspecto (ej. "16:9", "1:1", "5:2").
     */
    function _updateRatioBadge(w, h) {
        const badge = document.getElementById('gridAspectRatioDisplay');
        if (!badge) return;
        if (!w || !h) {
            badge.textContent = '—';
            return;
        }

        const g = _gcd(w, h);
        const rw = w / g;
        const rh = h / g;

        // Si la razón simplificada es muy grande (ratio rara), mostrar decimal
        if (rw > 20 || rh > 20) {
            badge.textContent = `${(w / h).toFixed(2)}:1`;
        } else {
            badge.textContent = `${rw}:${rh}`;
        }
    }

    // ─── Botones de preset ────────────────────────────────────────────────────

    function _bindPresetButtons(ui, automaton) {
        document.querySelectorAll('.btn-grid-preset[data-w]').forEach(btn => {
            btn.addEventListener('click', () => {
                const w = parseInt(btn.dataset.w);
                const h = parseInt(btn.dataset.h);
                if (!w || !h) return;

                // Actualizar sliders
                const wSlider = document.getElementById('gridWidth');
                const hSlider = document.getElementById('gridHeight');
                if (wSlider) wSlider.value = w;
                if (hSlider) hSlider.value = h;

                // Actualizar displays
                ui._updateRectDisplays?.();
                _updateRatioBadge(w, h);

                // Desactivar bloqueo de aspecto al aplicar preset (evita conflicto)
                const lockChk = document.getElementById('gridAspectLock');
                if (lockChk) lockChk.checked = false;
                const lockIcon = document.getElementById('gridAspectLockIcon');
                if (lockIcon) {
                    lockIcon.innerHTML = '<i class="fas fa-link"></i>';
                    lockIcon.classList.remove('locked');
                }

                // Aplicar
                automaton.resizeGrid(w, h);

                // Sincronizar slider legacy
                const legacySlider = document.getElementById('gridSize');
                const legacyDisplay = document.getElementById('gridSizeValue');
                if (legacySlider) legacySlider.value = Math.max(w, h);
                if (legacyDisplay) legacyDisplay.textContent = `${w}×${h}`;
            });
        });
    }

    // ─── Arrancar ─────────────────────────────────────────────────────────────
    eventBus.on('app:ready', () => setTimeout(run, 60));

})();