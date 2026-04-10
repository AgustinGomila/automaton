/**
 * scripts/config/patterns.js
 *
 * PatternManager: gestión de selección, preview e influencia de patrones.
 * Funciones auxiliares: rotateMatrix, getPatternWithRotation.
 *
 * Cambios respecto a la versión global:
 *   - window.PATTERNS → patternLoader.PATTERNS
 *   - window.RULES    → rulesLoader.RULES
 *   - window.t()      → importado de i18n.js
 *   - Exporta PatternManager, rotateMatrix, getPatternWithRotation.
 */

import {eventBus} from '../infrastructure/event-bus.js';
import {t} from '../ui/i18n.js';
import {SpecialEngineManager} from '../core/engines/special-engine-manager.js';
import {rulesLoader} from './rules-loader.js';
import {patternLoader} from './pattern-loader.js';

// =========================================
// FUNCIONES AUXILIARES
// =========================================

/**
 * Rota una matriz 90° en sentido horario.
 * @param   {number[][]|string} matrix
 * @returns {number[][]|string}
 */
function rotateMatrix(matrix) {
    if (!matrix || matrix === 'random') return matrix;

    const rows = matrix.length;
    const cols = matrix[0].length;
    const rotated = [];

    for (let col = 0; col < cols; col++) {
        const newRow = [];
        for (let row = rows - 1; row >= 0; row--) {
            newRow.push(matrix[row][col]);
        }
        rotated.push(newRow);
    }
    return rotated;
}

/**
 * Devuelve el patrón con la rotación indicada aplicada.
 * @param   {string} patternKey
 * @param   {number} rotation   — 0 | 90 | 180 | 270
 * @returns {{ name, description, color, pattern, rotation } | null}
 */
function getPatternWithRotation(patternKey, rotation = 0) {
    const patterns = patternLoader.PATTERNS;
    if (!patterns[patternKey]) return null;

    const original = patterns[patternKey];
    if (original.pattern === 'random' || rotation === 0) {
        return {
            name: original.name,
            description: original.description,
            color: original.color,
            pattern: original.pattern,
            rotation: 0
        };
    }

    let rotatedPattern = original.pattern;
    const rotations = rotation / 90;
    for (let i = 0; i < rotations; i++) {
        rotatedPattern = rotateMatrix(rotatedPattern);
    }

    return {
        name: original.name,
        description: original.description,
        color: original.color,
        pattern: rotatedPattern,
        rotation
    };
}

// =========================================
// PATTERN MANAGER
// =========================================

class PatternManager {
    constructor(automatonInstance) {
        this.automaton = automatonInstance;
        this.isPreviewVisible = false;
        this.isInfluenceVisible = false;
        this._cleanups = [];

        // Estado del patrón seleccionado — puede ser reemplazado por una
        // referencia compartida con UIController via setPatternState().
        this._patternState = {pattern: null, key: null, rotation: 0};

        // Filtro activo: { mode, rule }
        this._filter = {mode: SpecialEngineManager.MODES.STANDARD, rule: null};
        this._showAll = false;

        // Canvas reutilizables para los overlays de preview e influencia
        this._previewCanvas = null;
        this._influenceCanvas = null;

        this._init();
    }

    /**
     * Recibe la referencia compartida de _patternState desde UIController,
     * eliminando la necesidad de cualquier global como fuente de verdad.
     * @param {{ pattern, key, rotation }} sharedState
     */
    setPatternState(sharedState) {
        this._patternState = sharedState;
    }

    destroy() {
        this._cleanups.forEach(cleanup => cleanup());
        this._cleanups = [];
        this.hidePatternPreview();
        this.hideInfluenceArea();
        this._previewCanvas = null;
        this._influenceCanvas = null;
    }

    _init() {
        // Pre-inicializar el filtro de regla desde rulesLoader antes del primer render.
        if (rulesLoader.RULES?.conway) {
            this._filter.rule = this._normalizeRule(rulesLoader.RULES.conway.ruleString);
        }

        this.renderPatterns();

        this._cleanups.push(
            eventBus.on('pattern:selected', () => this._updatePatternInfo()),
            eventBus.on('pattern:updated', () => this._updatePatternInfo()),
            eventBus.on('pattern:rotationChanged', () => this._updatePatternInfo()),
            eventBus.on('automaton:filterChanged', ({mode, rule}) => this.setFilter(mode, rule))
        );

        // Actualizar el thumbnail del patrón "random" al mover el slider de densidad
        const densitySlider = document.getElementById('randomPercentage');
        if (densitySlider) {
            const updateThumb = () => {
                if (!this._randomThumb) return;
                this._renderRandomThumb(
                    this._randomThumb.getContext('2d'),
                    this._getRandomDensity()
                );
                if (this._patternState.key === 'random') this._updatePatternInfo();
            };
            densitySlider.addEventListener('input', updateThumb);
            this._cleanups.push(() => densitySlider.removeEventListener('input', updateThumb));
        }
    }

    // =========================================
    // FILTRADO POR CATEGORÍA / REGLA
    // =========================================

    setFilter(mode, rule) {
        const effectiveMode = mode === SpecialEngineManager.MODES.GENERATIONS
            ? SpecialEngineManager.MODES.STANDARD
            : mode;

        let resolvedRule;
        if (mode === SpecialEngineManager.MODES.GENERATIONS) {
            resolvedRule = null;
        } else if (rule !== null) {
            resolvedRule = this._normalizeRule(rule);
        } else {
            resolvedRule = this._resolveCurrentRule();
        }

        this._filter = {mode: effectiveMode, rule: resolvedRule};
        this.renderPatterns(this._sortByCount);
    }

    setShowAll(showAll) {
        this._showAll = showAll;
        this.renderPatterns(this._sortByCount);
    }

    _resolveCurrentRule() {
        const selector = document.getElementById('ruleSelector');
        if (!selector) return null;
        const ruleString = rulesLoader.RULES?.[selector.value]?.ruleString;
        return ruleString ? this._normalizeRule(ruleString) : null;
    }

    /** Normaliza una cadena B/S quitando slashes y poniendo mayúsculas. 'B3/S23' → 'B3S23' */
    _normalizeRule(ruleString) {
        if (!ruleString) return null;
        return ruleString.replace(/\//g, '').toUpperCase();
    }

    _isPatternVisible(pattern) {
        if (this._showAll) return true;

        const cat = pattern.category;
        if (!cat || cat === 'general') return true;
        if (cat !== this._filter.mode) return false;

        const patRule = pattern.rule;
        if (!patRule || patRule === 'general') return true;
        if (!this._filter.rule) return true;

        return this._normalizeRule(patRule) === this._filter.rule;
    }

    // =========================================
    // RENDERIZADO DE PATRONES
    // =========================================

    renderPatterns(sortByCount = false) {
        this._sortByCount = sortByCount;
        const container = document.getElementById('patternsContainer');
        if (!container) return;

        container.innerHTML = '';

        const patterns = patternLoader.PATTERNS;
        const sortedPatterns = Object.keys(patterns).sort((a, b) => {
            const pA = patterns[a];
            const pB = patterns[b];

            if (pA.pattern === 'random') return 1;
            if (pB.pattern === 'random') return -1;

            if (sortByCount) {
                const countCompare = pA.cellCount - pB.cellCount;
                if (countCompare !== 0) return countCompare;
                return pA.name.localeCompare(pB.name);
            }
            const nameCompare = pA.name.localeCompare(pB.name);
            if (nameCompare !== 0) return nameCompare;
            return pA.cellCount - pB.cellCount;
        });

        sortedPatterns.forEach(key => {
            const pattern = patterns[key];
            if (!this._isPatternVisible(pattern)) return;

            const patternBtn = document.createElement('button');
            patternBtn.className = 'pattern-btn-horizontal';
            if (container.classList.contains('compact-view')) {
                patternBtn.classList.add('compact');
            }
            patternBtn.dataset.patternKey = key;

            const categoryText = pattern.category ? `[${pattern.category}]\n` : '';
            const cellCountText = pattern.cellCount ? `\n ${t('patterns.cells', {count: pattern.cellCount})}` : '';
            patternBtn.dataset.tooltip = `${categoryText}${pattern.description}${cellCountText}\n\n${t('patterns.rotate')}`;

            const thumbnail = document.createElement('div');
            thumbnail.className = 'pattern-thumb-horizontal';

            if (pattern.pattern === 'random') {
                const canvas = document.createElement('canvas');
                canvas.width = 40;
                canvas.height = 40;
                canvas.className = 'pattern-canvas-horizontal';
                const ctx = canvas.getContext('2d');
                this._randomThumb = canvas;
                this._renderRandomThumb(ctx, this._getRandomDensity());
                thumbnail.appendChild(canvas);
            } else {
                const canvas = document.createElement('canvas');
                canvas.width = 40;
                canvas.height = 40;
                canvas.className = 'pattern-canvas-horizontal';
                const ctx = canvas.getContext('2d');
                this._renderPatternToCanvas(ctx, pattern.pattern, pattern.color);
                thumbnail.appendChild(canvas);
            }

            const label = document.createElement('div');
            label.className = 'pattern-label-horizontal';
            label.textContent = pattern.name;

            if (pattern.cellCount && pattern.pattern !== 'random') {
                const sizeBadge = document.createElement('div');
                sizeBadge.className = 'pattern-size-badge';
                sizeBadge.textContent = pattern.cellCount;
                patternBtn.appendChild(sizeBadge);
            }

            patternBtn.appendChild(thumbnail);
            patternBtn.appendChild(label);

            patternBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => btn.classList.remove('active'));
                patternBtn.classList.add('active');
                this._patternState.rotation = 0;
                this._patternState.key = key;
                this._patternState.pattern = getPatternWithRotation(key, 0);
                this._updatePatternInfo();
                eventBus.emit('pattern:selected', {patternKey: key, pattern: patterns[key]});
            });

            patternBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (patternBtn.classList.contains('active') && pattern.pattern !== 'random') {
                    this._patternState.rotation = (this._patternState.rotation + 90) % 360;
                    this._patternState.pattern = getPatternWithRotation(key, this._patternState.rotation);

                    const canvas = thumbnail.querySelector('canvas');
                    if (canvas) {
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, 40, 40);
                        const rotatedPattern = getPatternWithRotation(key, this._patternState.rotation);
                        this._renderPatternToCanvas(ctx, rotatedPattern.pattern, pattern.color);
                    }
                    this._updatePatternInfo();
                    eventBus.emit('pattern:updated', {pattern: this._patternState.pattern});
                }
                return false;
            });

            container.appendChild(patternBtn);
        });

        // Restaurar patrón seleccionado si aún es visible tras el re-render
        const prevKey = this._patternState.key;
        const prevRotation = this._patternState.rotation;
        if (prevKey && patterns[prevKey] && this._isPatternVisible(patterns[prevKey])) {
            const btn = container.querySelector(`[data-pattern-key="${prevKey}"]`);
            if (btn) btn.classList.add('active');
            this._patternState.pattern = getPatternWithRotation(prevKey, prevRotation);
        } else {
            this._patternState.key = null;
            this._patternState.pattern = null;
            this._patternState.rotation = 0;
        }
        this._updatePatternInfo();
        eventBus.emit('patterns:rendered');
    }

    _getRandomDensity() {
        const slider = document.getElementById('randomPercentage');
        return slider ? parseFloat(slider.value) / 100 : 0.35;
    }

    _renderRandomThumb(ctx, density) {
        const SIZE = 10;
        const CELL = 4;
        const GAP = 0;
        const TOTAL = SIZE * (CELL + GAP);
        const OFFSET = (40 - TOTAL) / 2;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 40, 40);
        ctx.fillStyle = '#8b5cf6';

        let seed = Math.round(density * 1000);
        const rng = () => {
            seed = (seed * 1664525 + 1013904223) & 0xffffffff;
            return (seed >>> 0) / 0xffffffff;
        };

        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (rng() < density) {
                    ctx.fillRect(OFFSET + c * (CELL + GAP), OFFSET + r * (CELL + GAP), CELL, CELL);
                }
            }
        }
    }

    _renderPatternToCanvas(ctx, patternData, color) {
        if (!patternData || patternData === 'random') return;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 40, 40);

        const rows = patternData.length;
        const cols = patternData[0].length;
        const maxDim = Math.max(rows, cols);
        const cellSize = Math.min(30 / maxDim, 5);
        const offsetX = (40 - cols * cellSize) / 2;
        const offsetY = (40 - rows * cellSize) / 2;

        ctx.fillStyle = color || '#10b981';
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (patternData[row][col] === 1) {
                    ctx.fillRect(offsetX + col * cellSize, offsetY + row * cellSize, cellSize, cellSize);
                }
            }
        }
    }

    _updatePatternInfo() {
        const nameEl = document.getElementById('patternNameMini');
        const detailsEl = document.getElementById('patternDetailsMini');
        const descEl = document.getElementById('patternDescriptionMini');

        if (!this._patternState.key) {
            if (nameEl) nameEl.textContent = t('patterns.select');
            if (detailsEl) detailsEl.textContent = t('patterns.details');
            if (descEl) descEl.textContent = '';
            return;
        }

        const pattern = getPatternWithRotation(this._patternState.key, this._patternState.rotation);
        const patterns = patternLoader.PATTERNS;

        if (nameEl && detailsEl && pattern) {
            const originalPattern = patterns[this._patternState.key];

            if (pattern.pattern === 'random') {
                const density = Math.round(this._getRandomDensity() * 100);
                nameEl.textContent = pattern.name;
                detailsEl.textContent = `${density}% densidad`;
                if (descEl) descEl.textContent = originalPattern.description || '';
                this._patternState.pattern = pattern;
                return;
            }

            const rotationText = this._patternState.rotation > 0 ? ` (${this._patternState.rotation}°)` : '';
            nameEl.textContent = `${pattern.name}${rotationText}`;

            const categoryText = originalPattern.category
                ? t('patterns.category', {category: originalPattern.category})
                : '';
            const cellCountText = originalPattern.cellCount
                ? t('patterns.cells', {count: originalPattern.cellCount})
                : '';
            detailsEl.textContent = `${categoryText} ${cellCountText}`;
            if (descEl) descEl.textContent = originalPattern.description || '';
        }

        this._patternState.pattern = pattern;
    }

    // =========================================
    // OVERLAY DE PREVIEW — canvas reutilizable
    // =========================================

    showPatternPreview(x, y) {
        const patternData = this._patternState.pattern?.pattern;
        if (!patternData || patternData === 'random') {
            this.hidePatternPreview();
            return;
        }

        const {ctx, w, h} = this._getOverlayCtx('patternPreview', 3);
        if (!ctx) return;

        const cellSize = this.automaton.cellSize;
        const gw = this.automaton.gridWidth;
        const gh = this.automaton.gridHeight;
        const patternOffX = Math.floor(patternData[0].length / 2);
        const patternOffY = Math.floor(patternData.length / 2);

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';

        for (let row = 0; row < patternData.length; row++) {
            for (let col = 0; col < patternData[row].length; col++) {
                if (!patternData[row][col]) continue;
                const gx = x - patternOffX + col;
                const gy = y - patternOffY + row;
                if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) {
                    ctx.fillRect(gx * cellSize, gy * cellSize, cellSize, cellSize);
                }
            }
        }
        this.isPreviewVisible = true;
    }

    hidePatternPreview() {
        if (this._previewCanvas) {
            const ctx = this._previewCanvas.getContext('2d');
            ctx.clearRect(0, 0, this._previewCanvas.width, this._previewCanvas.height);
            this._previewCanvas.parentElement.style.display = 'none';
        }
        this.isPreviewVisible = false;
    }

    // =========================================
    // OVERLAY DE ÁREA DE INFLUENCIA — canvas reutilizable
    // =========================================

    showInfluenceArea(x, y) {
        const {ctx, w, h} = this._getOverlayCtx('influenceArea', 2);
        if (!ctx) return;

        const cellSize = this.automaton.cellSize;
        const gw = this.automaton.gridWidth;
        const gh = this.automaton.gridHeight;
        const radius = this.automaton.neighborhoodRadius;
        const type = this.automaton.neighborhoodType;

        const getNeighborhood = (cx, cy) => {
            const neighbors = [];
            for (let i = -radius; i <= radius; i++) {
                for (let j = -radius; j <= radius; j++) {
                    if (i === 0 && j === 0) continue;
                    if (type === 'neumann' && Math.abs(i) + Math.abs(j) > radius) continue;
                    neighbors.push({x: (cx + i + gw) % gw, y: (cy + j + gh) % gh});
                }
            }
            return neighbors;
        };

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';

        const pattern = this._patternState.pattern?.pattern;

        if (!pattern || pattern === 'random') {
            for (const {x: nx, y: ny} of getNeighborhood(x, y)) {
                ctx.fillRect(nx * cellSize, ny * cellSize, cellSize, cellSize);
            }
        } else {
            const patternOffX = Math.floor(pattern[0].length / 2);
            const patternOffY = Math.floor(pattern.length / 2);
            const patternSet = new Set();

            for (let row = 0; row < pattern.length; row++) {
                for (let col = 0; col < pattern[row].length; col++) {
                    if (!pattern[row][col]) continue;
                    const gx = x - patternOffX + col;
                    const gy = y - patternOffY + row;
                    if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) {
                        patternSet.add(gx * gh + gy);
                    }
                }
            }

            const influenceSet = new Set();
            for (const key of patternSet) {
                const cx = (key / gh) | 0;
                const cy = key % gh;
                for (const {x: nx, y: ny} of getNeighborhood(cx, cy)) {
                    const nk = nx * gh + ny;
                    if (!patternSet.has(nk)) influenceSet.add(nk);
                }
            }

            for (const key of influenceSet) {
                const nx = (key / gh) | 0;
                const ny = key % gh;
                ctx.fillRect(nx * cellSize, ny * cellSize, cellSize, cellSize);
            }
        }
        this.isInfluenceVisible = true;
    }

    hideInfluenceArea() {
        if (this._influenceCanvas) {
            const ctx = this._influenceCanvas.getContext('2d');
            ctx.clearRect(0, 0, this._influenceCanvas.width, this._influenceCanvas.height);
            this._influenceCanvas.parentElement.style.display = 'none';
        }
        this.isInfluenceVisible = false;
    }

    // =========================================
    // UTILIDADES PRIVADAS
    // =========================================

    _getOverlayCtx(divId, zIndex) {
        const div = document.getElementById(divId);
        if (!div) return null;

        const w = this.automaton.canvas.width;
        const h = this.automaton.canvas.height;

        const cacheKey = divId === 'patternPreview' ? '_previewCanvas' : '_influenceCanvas';
        let canvas = this[cacheKey];

        if (!canvas || canvas.width !== w || canvas.height !== h) {
            canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.style.cssText = 'display:block; image-rendering:pixelated; background:transparent;';
            div.innerHTML = '';
            div.appendChild(canvas);
            this[cacheKey] = canvas;
        }

        div.style.cssText = `display:block; z-index:${zIndex};`;
        return {ctx: canvas.getContext('2d'), w, h};
    }
}

export {PatternManager, rotateMatrix, getPatternWithRotation};