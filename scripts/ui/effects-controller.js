/**
 * EffectsController — Gestión del efecto de actividad y el área de influencia.
 *
 * Responsabilidades:
 *   - Toggle del efecto de actividad (colores dead/born/alive/dying)
 *   - Toggle del área de influencia de patrones
 *   - Sincronización del bloque de color swatches (binario ↔ Generations)
 *   - Color pickers de los 4 estados binarios y de Generations
 *
 * Dependencias externas (inyectadas):
 *   - automaton              — instancia de CellularAutomaton
 *   - getShowInfluenceArea   — () => boolean  (estado en CanvasController)
 *   - setShowInfluenceArea   — (v: boolean) => void
 *   - onHideInfluenceArea    — () => void
 *   - addEventListener       — helper compartido de registro+cleanup
 */
class EffectsController {

    /**
     * @param {Object}   options
     * @param {Object}   options.automaton
     * @param {Function} options.getShowInfluenceArea  — () => boolean
     * @param {Function} options.setShowInfluenceArea  — (v) => void
     * @param {Function} options.onHideInfluenceArea   — () => void
     * @param {Function} options.addEventListener
     */
    constructor({
                    automaton,
                    getShowInfluenceArea,
                    setShowInfluenceArea,
                    onHideInfluenceArea,
                    addEventListener
                }) {
        this.automaton = automaton;
        this._getShowInfluenceArea = getShowInfluenceArea;
        this._setShowInfluenceArea = setShowInfluenceArea;
        this._onHideInfluenceArea = onHideInfluenceArea;
        this._addEventListener = addEventListener;

        // Estado propio: actividad visual
        this.showActivityEffect = true;
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    /**
     * Enlaza los controles de efectos.
     * Llamado desde UIController._bindEvents().
     */
    bindEvents() {
        this._addEventListener(
            document.getElementById('influenceToggle'), 'change',
            () => this.toggleInfluenceArea()
        );
        this._addEventListener(
            document.getElementById('quickInfluenceToggle'), 'click',
            () => this.quickToggleInfluenceArea()
        );
        this._addEventListener(
            document.getElementById('activityEffectToggle'), 'change',
            () => this.toggleActivityEffect()
        );
        this._bindActivityColorPickers();
    }

    // =========================================
    // ÁREA DE INFLUENCIA
    // =========================================

    toggleInfluenceArea() {
        const toggle = document.getElementById('influenceToggle');
        this._setShowInfluenceArea(toggle.checked);

        const quickToggle = document.getElementById('quickInfluenceToggle');
        if (quickToggle) {
            quickToggle.className = this._getShowInfluenceArea() ? 'btn-toggle active' : 'btn-toggle';
            quickToggle.style.color = this._getShowInfluenceArea() ? 'var(--secondary)' : '';
        }

        if (!this._getShowInfluenceArea()) this._onHideInfluenceArea();
    }

    quickToggleInfluenceArea() {
        this._setShowInfluenceArea(!this._getShowInfluenceArea());
        const toggle = document.getElementById('influenceToggle');
        if (toggle) toggle.checked = this._getShowInfluenceArea();
        this.toggleInfluenceArea();
    }

    // =========================================
    // EFECTO DE ACTIVIDAD
    // =========================================

    toggleActivityEffect() {
        const toggle = document.getElementById('activityEffectToggle');
        this._toggleActivityEffect(toggle.checked);
    }

    /**
     * Aplica el estado del efecto de actividad al renderer.
     * Llamado directamente por SpecialModeController vía callback.
     * @param {boolean} checked
     */
    _toggleActivityEffect(checked) {
        this.showActivityEffect = checked;
        this.automaton.setShowActivityEffect(checked);
        this.automaton._markAllDirty();
        this.automaton.render();
        this._syncActivityEffectCheckbox();
    }

    _syncActivityEffectCheckbox() {
        const toggle = document.getElementById('activityEffectToggle');
        if (toggle) toggle.checked = this.showActivityEffect;
    }

    // =========================================
    // SWATCHES DE COLOR
    // =========================================

    /**
     * Conmuta el bloque activityColors entre modo binario (4 swatches fijos)
     * y modo Generations (N swatches dinámicos por estado del engine).
     *
     * Llamado por SpecialModeController al activar/desactivar Generations.
     * @param {boolean} generationsActive
     */
    syncActivityColorsBlock(generationsActive) {
        const block = document.getElementById('activityColors');
        if (!block) return;

        const swatchesContainer = block.querySelector('.activity-color-swatches');
        if (!swatchesContainer) return;

        if (!generationsActive) {
            // Restaurar swatches binarios originales
            swatchesContainer.innerHTML = `
                <div class="activity-swatch-item">
                    <div class="activity-swatch" id="swatchDead" data-state="dead" style="--swatch-color:#0f172a" title="Muerto (0→0)">
                        <span class="activity-swatch-label">0</span>
                        <input type="color" value="#0f172a" id="colorDead">
                    </div>
                </div>
                <div class="activity-swatch-item">
                    <div class="activity-swatch" id="swatchBorn" data-state="born" style="--swatch-color:#b9b610" title="Naciendo (0→1)">
                        <span class="activity-swatch-label">+1</span>
                        <input type="color" value="#b9b610" id="colorBorn">
                    </div>
                </div>
                <div class="activity-swatch-item">
                    <div class="activity-swatch" id="swatchAlive" data-state="alive" style="--swatch-color:#059669" title="Vivo (1→1)">
                        <span class="activity-swatch-label">1</span>
                        <input type="color" value="#059669" id="colorAlive">
                    </div>
                </div>
                <div class="activity-swatch-item">
                    <div class="activity-swatch" id="swatchDying" data-state="dying" style="--swatch-color:#ef4444" title="Muriendo (1→0)">
                        <span class="activity-swatch-label">−1</span>
                        <input type="color" value="#ef4444" id="colorDying">
                    </div>
                </div>`;
            this._bindActivityColorPickers();
            return;
        }

        // Modo Generations: swatches dinámicos por estado
        const engine = this.automaton.generationsEngine;
        if (!engine?.isActive) return;

        const C = engine.numStates;
        swatchesContainer.innerHTML = engine._palette.map((color, i) => {
            const safeColor = color ?? '#0f172a';
            const label = i === 0 ? '0' : String(i);
            const title = i === 0 ? 'Muerto' : i === 1 ? 'Vivo' : `Estado ${i}`;
            return `
                <div class="activity-swatch-item">
                    <div class="activity-swatch" id="genSwatch${i}" style="--swatch-color:${safeColor}" title="${title}">
                        <span class="activity-swatch-label">${label}</span>
                        <input type="color" value="${this._cssToHex(safeColor)}" id="genColor${i}" data-state-index="${i}">
                    </div>
                </div>`;
        }).join('');

        for (let i = 0; i < C; i++) {
            const input = document.getElementById(`genColor${i}`);
            const swatch = document.getElementById(`genSwatch${i}`);
            if (!input || !swatch) continue;
            this._addEventListener(input, 'input', () => {
                const color = input.value;
                swatch.style.setProperty('--swatch-color', color);
                engine._palette[i] = i === 0 ? null : color;
                this.automaton._markAllDirty();
                this.automaton.render();
            });
        }
    }

    // =========================================
    // PRIVADOS
    // =========================================

    /**
     * Enlaza los 4 color pickers del modo binario (dead/born/alive/dying).
     * Se llama al init y al restaurar el bloque binario desde syncActivityColorsBlock.
     */
    _bindActivityColorPickers() {
        const map = [
            {id: 'colorDead', swatchId: 'swatchDead', prop: 'colorDead'},
            {id: 'colorBorn', swatchId: 'swatchBorn', prop: 'colorBorn'},
            {id: 'colorAlive', swatchId: 'swatchAlive', prop: 'colorAlive'},
            {id: 'colorDying', swatchId: 'swatchDying', prop: 'colorDying'},
        ];

        for (const {id, swatchId, prop} of map) {
            const input = document.getElementById(id);
            const swatch = document.getElementById(swatchId);
            if (!input || !swatch) continue;

            this._addEventListener(input, 'input', () => {
                const color = input.value;
                swatch.style.setProperty('--swatch-color', color);
                this.automaton.renderer[prop] = color;
                this.automaton._markAllDirty();
                this.automaton.render();
            });
        }
    }

    /**
     * Convierte un color CSS (hsl, hex, rgb) a hex #rrggbb.
     * Usa un canvas 1×1 como intermediario para cualquier formato CSS.
     * @param {string} css
     * @returns {string}
     */
    _cssToHex(css) {
        if (!css || css === 'null') return '#000000';
        if (/^#[0-9a-f]{6}$/i.test(css)) return css;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
}

export {EffectsController};