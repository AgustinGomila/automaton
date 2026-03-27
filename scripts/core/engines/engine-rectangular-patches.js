/**
 * engine-rectangular-patches.js — STUB (deuda técnica completamente saldada)
 *
 * Todos los engines especiales han sido migrados a sus respectivos archivos
 * maincode con soporte nativo de grids rectangulares:
 *
 *   ✓ ulam-warburton-engine.js
 *   ✓ langton-engine.js
 *   ✓ wireworld-engine.js
 *   ✓ generations-engine.js
 *   ✓ wolfram-engine.js
 *   ✓ rd2d-engine.js
 *
 * Este archivo se mantiene únicamente porque SpecialEngineManager._loadScript()
 * invoca window.patchEnginesForRectangularGrids() tras cada carga lazy.
 * La función es ahora un no-op seguro.
 */

window.patchEnginesForRectangularGrids = function () {
    'use strict';

    /**
     * Parchea un método de forma idempotente.
     * Si el flag `_rectPatched_<method>` ya existe en el prototipo, no hace nada.
     */
    function patch(proto, method, factory) {
        if (!proto || typeof proto[method] !== 'function') return;
        const flag = `_rectPatched_${method}`;
        if (proto[flag]) return;
        proto[method] = factory(proto[method]);
        proto[flag] = true;
    }

};

// Todos los engines han sido migrados al maincode.
// Esta función se mantiene para compatibilidad (SpecialEngineManager._loadScript la invoca
// tras cada carga lazy) pero ya no aplica ningún parche.
window.patchEnginesForRectangularGrids();