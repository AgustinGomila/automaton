/**
 * scripts/ui/ui-controller.js
 *
 * Coordinador de toda la interfaz de usuario.
 *
 * Cambios ESM:
 *   - window.RULES          → eliminado; rulesLoader importado por RuleController
 *   - window.patternManager → inyectado via options.getPatternManager()
 *   - window.t()            → importado de i18n.js
 *   - getPatternWithRotation → importado de patterns.js
 *   - SpecialEngineManager  → importado para acceder a MODES
 *   - Todos los sub-controladores importados explícitamente.
 */

import {eventBus} from '../infrastructure/event-bus.js';
import {i18n, t} from './i18n.js';
import {SpecialEngineManager} from '../core/engines/special-engine-manager.js';
import {getPatternWithRotation} from '../config/patterns.js';
import {CanvasController} from './canvas-controller.js';
import {SpecialModeController} from './special-mode-controller.js';
import {GridController} from './grid-controller.js';
import {ImportExportController} from './import-export-controller.js';
import {NeighborhoodController, RuleController} from './rule-neighborhood-controller.js';
import {EffectsController} from './effects-controller.js';
import {DisplayController} from './display-controller.js';
import {AppConfig} from '../utils/config.js';

class UIController {
    /**
     * @param {CellularAutomaton} automatonInstance
     * @param {Object} options
     * @param {Function} options.getPatternManager — () => PatternManager | null
     */
    constructor(automatonInstance, options = {}) {
        if (!automatonInstance) {
            throw new Error('UIController requiere una instancia de CellularAutomaton');
        }

        this.automaton = automatonInstance;
        this._getPatternManager = options.getPatternManager || (() => null);

        this.showInfluenceArea = true;
        this.patternsTwoRows = false;
        this.patternsCompactView = true;
        this.patternsSortByCount = false;
        this.patternsShowAll = false;

        this._cleanups = [];

        this._patternState = {pattern: null, key: null, rotation: 0};

        // Sub-controladores
        this._canvasController = new CanvasController({
            automaton: this.automaton,
            patternState: this._patternState,
            onUpdateDrawMode: () => this._displayController?.updateDrawModeIndicator(),
            getPatternManager: () => this._getPatternManager()
        });

        this._specialModeController = new SpecialModeController({
            automaton: this.automaton,
            onUpdateHeader: () => this._displayController?.updateHeaderInfo(),
            onSyncPlayButton: () => this._syncPlayButtonState(),
            onShowNotification: (msg, type, dur) => this._showNotification(msg, type, dur)
        });

        this._gridController = new GridController({
            automaton: this.automaton,
            onStopAutomaton: () => this._stopAutomaton(),
            onSyncPlayButton: () => this._syncPlayButtonState(),
            onShowNotification: (msg, type, dur) => this._showNotification(msg, type, dur),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
        });

        this._importExportController = new ImportExportController({
            automaton: this.automaton,
            getSelection: () => this._canvasController?.selection,
            onShowNotification: (msg, type, dur) => this._showNotification(msg, type, dur),
            onGridResized: (newSize) => {
                const slider = document.getElementById('gridSize');
                const display = document.getElementById('gridSizeValue');
                if (slider) slider.value = newSize;
                if (display) display.textContent = `${newSize}×${newSize}`;
            },
            addEventListener: (target, event, handler, opts) =>
                this._addEventListener(target, event, handler, opts)
        });

        this._ruleController = new RuleController({
            automaton: this.automaton,
            onActivateGenerations: (b, s, c) => this._specialModeController.activateGenerationsMode(b, s, c),
            onDeactivateGenerations: () => this._specialModeController.deactivateGenerationsMode(),
            onUpdateHeader: () => this._displayController?.updateHeaderInfo(),
            onUpdateRuleInfo: (rule) => this._displayController?.updateRuleInfo(rule),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
        });

        this._neighborhoodController = new NeighborhoodController({
            automaton: this.automaton,
            onUpdateHeader: () => this._displayController?.updateHeaderInfo(),
            onUpdateNeighborhood: () => this._displayController?.updateNeighborhoodInfo(),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
        });

        this._effectsController = new EffectsController({
            automaton: this.automaton,
            getShowInfluenceArea: () => this._canvasController.showInfluenceArea,
            setShowInfluenceArea: (v) => {
                this._canvasController.showInfluenceArea = v;
            },
            onHideInfluenceArea: () => this._getPatternManager()?.hideInfluenceArea(),
            addEventListener: (t, e, h, o) => this._addEventListener(t, e, h, o)
        });

        this._subscribeToAutomatonEvents();

        // _displayController debe crearse ANTES de _waitForRulesAndInit porque
        // loadRules() → _onUpdateRuleInfo(conway) → _displayController.updateRuleInfo()
        // se ejecuta sincrónicamente cuando las reglas ya están cargadas.
        this._displayController = new DisplayController(this.automaton, this._patternState);

        this._waitForRulesAndInit();

        this._cleanups.push(
            i18n.onLocaleChange(() => this._onLocaleChanged())
        );
    }

    /**
     * Devuelve la referencia compartida del estado de patrón activo.
     * @returns {{ pattern: Object|null, key: string|null, rotation: number }}
     */
    getPatternState() {
        return this._patternState;
    }

    _onLocaleChanged() {
        this._displayController?.updateHeaderInfo();
        this.updateSpeedDisplay();
        this._displayController?.updateNeighborhoodInfo();
        this._displayController?.updateDrawModeIndicator();

        const isRunning = this.automaton.isRunning;
        const playText = document.querySelector('#playBtn [data-i18n]');
        if (playText) {
            playText.textContent = t(isRunning ? 'controls.pause' : 'controls.play');
        }
    }

    _waitForRulesAndInit() {
        // Esperar event rules:loaded si las reglas aún no están
        const proceed = () => this._init();
        if (document.getElementById('ruleSelector')?.options?.length > 0) {
            proceed();
        } else {
            // Las reglas se cargan vía rulesLoader que ya emitió 'rules:loaded'
            // antes de construir UIController (ver main.js), por lo que siempre
            // llegamos aquí con las reglas disponibles. El eventBus.once es
            // un seguro ante condiciones de carrera en entornos lentos.
            const unsub = eventBus.on('rules:loaded', () => {
                unsub();
                proceed();
            });
            // Llamar inmediatamente por si el evento ya ocurrió
            proceed();
        }
    }

    async _init() {
        this._bindEvents();
        this._bindAccordionEvents();
        this._bindKeyboardEvents();
        this._bindPatternEvents();
        this._neighborhoodController.bindEvents();
        this._bindPatternsControls();

        this.updateSpeedDisplay();
        this._gridController.initDisplays();
        this._displayController?.updateNeighborhoodInfo();
        this._ruleController.loadRules();

        eventBus.on('automaton:runningChanged', () => this._syncPlayButtonState());
        eventBus.on('app:ready', () => setTimeout(() => this._gridController.initGridRectUI(), 60));

        eventBus.emit('ui:ready');
    }

    // =========================================
    // LIFECYCLE & CLEANUP
    // =========================================

    destroy() {
        this._gridController?.destroy();
        this._gridController = null;
        this._canvasController?.destroy();
        this._canvasController = null;

        this._cleanups.forEach(cleanup => {
            try {
                cleanup();
            } catch (e) {
                console.warn('Error en cleanup:', e);
            }
        });
        this._cleanups = [];

        if (this._patternState?.pattern) this._patternState.pattern = null;
        if (this._patternState?.key) this._patternState.key = null;
        if (this._patternState?.rotation) this._patternState.rotation = 0;

        this.automaton = null;
        this._patternState = null;

        this._specialModeController?.destroy();
        this._specialModeController = null;
        this._displayController?.destroy();
        this._displayController = null;

        eventBus.emit('ui:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        const cleanup = () => target.removeEventListener(event, handler, options);
        this._cleanups.push(cleanup);
        return cleanup;
    }

    _subscribeToAutomatonEvents() {
        const weakThis = new WeakRef(this);
        this._cleanups.push(
            eventBus.on('stats:updated', (stats) => {
                weakThis.deref()?._displayController?.updateStats(stats);
            }),
            eventBus.on('automaton:ruleChanged', () => {
                weakThis.deref()?._displayController?.updateHeaderInfo();
            }),
            eventBus.on('automaton:neighborhoodChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui._displayController?.updateHeaderInfo();
                    ui._displayController?.updateNeighborhoodInfo();
                }
            }),
            eventBus.on('automaton:radiusChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui._displayController?.updateHeaderInfo();
                    ui._displayController?.updateNeighborhoodInfo();
                }
            }),
            eventBus.on('automaton:wrapChanged', () => {
                const ui = weakThis.deref();
                if (ui) {
                    ui._displayController?.updateHeaderInfo();
                    ui._displayController?.updateNeighborhoodInfo();
                }
            })
        );
    }

    // =========================================
    // BINDING DE EVENTOS
    // =========================================

    _bindEvents() {
        this._addEventListener(document.getElementById('languageSelect'), 'change', (e) => {
            i18n.setLocale(e.target.value);
        });

        this._addEventListener(document.getElementById('playBtn'), 'click', () => this.togglePlay());
        this._addEventListener(document.getElementById('stepBtn'), 'click', () => this.step());
        this._addEventListener(document.getElementById('stepBackBtn'), 'click', () => this.undo());
        this._addEventListener(document.getElementById('clearBtn'), 'click', () => this.clear());
        this._addEventListener(document.getElementById('cancelPatternBtn'), 'click', () => {
            this.deselectPattern();
        });

        const randomBtn = document.getElementById('randomBtn');
        if (randomBtn) {
            this._addEventListener(randomBtn, 'click', () => {
                const percentage = this._getPercentage();
                this.automaton.randomize(percentage);
                this._showNotification(
                    t('notif.randomized', {density: Math.round(percentage * 100)}), 'info', 1500
                );
                this._displayController?.updateHeaderInfo();
            });
        }

        this._addEventListener(document.getElementById('instructionsBtn'), 'click', () => {
            document.getElementById('instructionsModal').classList.add('show');
        });
        this._addEventListener(document.getElementById('closeModalBtn'), 'click', () => {
            document.getElementById('instructionsModal').classList.remove('show');
        });
        this._addEventListener(document.getElementById('instructionsModal'), 'click', (e) => {
            if (e.target.id === 'instructionsModal') {
                document.getElementById('instructionsModal').classList.remove('show');
            }
        });

        this._ruleController.bindEvents();
        this._effectsController.bindEvents();

        const wrapModeSelect = document.getElementById('wrapModeSelect');
        if (wrapModeSelect) {
            // Sincronizar select con el estado inicial del autómata
            wrapModeSelect.value = this.automaton.wrapMode;

            this._addEventListener(wrapModeSelect, 'change', () => {
                const mode = wrapModeSelect.value;
                this.automaton.wrapMode = mode;
                this.automaton._markAllDirty();
                this.automaton.render();
                this._displayController?.updateNeighborhoodInfo();
                if (this.automaton.specialMode === SpecialEngineManager.MODES.TRIANGLE && this.automaton.triangleEngine) {
                    this.automaton.triangleEngine.wrapEdges = (mode === 'both');
                }
                eventBus.emit('automaton:wrapChanged', {wrapMode: mode, wrap: mode === 'both'});
                wrapModeSelect.blur();
            });
        }

        this._bindRandomPercentageControl();

        const workerToggle = document.getElementById('workerToggle');
        if (workerToggle) {
            const syncWorkerToggle = () => {
                const exceedsThreshold = Math.max(this.automaton.gridWidth, this.automaton.gridHeight)
                    >= AppConfig.WORKER.THRESHOLD;
                if (exceedsThreshold && !this.automaton.worker) {
                    this.automaton._initWorker();
                } else if (!exceedsThreshold && this.automaton.worker) {
                    this.automaton._cleanupWorker();
                }
                workerToggle.checked = this.automaton.worker !== null;
            };
            syncWorkerToggle();
            this._cleanups.push(eventBus.on('automaton:resized', syncWorkerToggle));
            this._addEventListener(workerToggle, 'change', (e) => {
                if (e.target.checked) {
                    this.automaton._initWorker();
                } else {
                    this.automaton._cleanupWorker();
                }
            });
        }

        this._addEventListener(document.getElementById('speedControl'), 'input', () => this.updateSpeed());
        this._addEventListener(document.getElementById('speedDown'), 'click', () => this.decreaseSpeed());
        this._addEventListener(document.getElementById('speedUp'), 'click', () => this.increaseSpeed());
        this._gridController.bindEvents();
        this._importExportController.bindEvents();
        this._addEventListener(document.getElementById('limitType'), 'change', () => this.updateLimitType());
        this._addEventListener(document.getElementById('limitValue'), 'input', () => this.updateLimitValue());

        const perfToggle = document.getElementById('perfToggle');
        if (perfToggle) {
            this._addEventListener(perfToggle, 'click', () => this._togglePerf());
        }
        this._cleanups.push(eventBus.on('perf:update', (perf) => this._updatePerfOverlay(perf)));

        this._specialModeController.bindEvents();
    }

    _bindAccordionEvents() {
        document.querySelectorAll('.accordion-header').forEach(header => {
            this._addEventListener(header, 'click', (e) => {
                e.preventDefault();
                const isActive = header.classList.contains('active');
                if (isActive) {
                    header.classList.remove('active');
                } else {
                    header.classList.add('active');
                    if (header.dataset.accordion === 'neighborhood') {
                        requestAnimationFrame(() => {
                            this._renderNeighborhoodGrid(this.automaton.neighborhoodRadius);
                        });
                    }
                }
            });
        });
    }

    _bindRandomPercentageControl() {
        const slider = document.getElementById('randomPercentage');
        const display = document.getElementById('randomPercentageDisplay');
        if (!slider || !display) return;
        this._addEventListener(slider, 'input', () => {
            display.textContent = `${parseInt(slider.value, 10)}%`;
        });
    }

    _bindKeyboardEvents() {
        this._addEventListener(document, 'keydown', (e) => this._handleKeyDown(e));
        this._addEventListener(document, 'keyup', (e) => this._handleKeyUp(e));
    }

    _handleKeyDown(e) {
        this._canvasController.ctrlPressed = e.key === 'Control' ? true : this._canvasController._ctrlPressed;
        this._canvasController.shiftPressed = e.key === 'Shift' ? true : this._canvasController.shiftPressed;
        if (e.key === 'Alt') {
            e.preventDefault();
            this._canvasController.altPressed = true;
        }

        if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
        }
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.redo();
            return;
        }

        switch (e.key.toLowerCase()) {
            case 'escape':
                this.deselectPattern();
                this._canvasController.cancelDrag();
                this._canvasController.clearSelection();
                if (this._canvasController.bucketToolActive) {
                    this._canvasController.bucketToolActive = false;
                    document.getElementById('bucketToolBtn')?.classList.remove('active');
                    this._canvasController._updateCursor();
                }
                break;
            case '+':
                this.increaseSpeed();
                break;
            case '-':
                this.decreaseSpeed();
                break;
            case ' ':
                e.preventDefault();
                this.togglePlay();
                break;
            case 's':
                this.step();
                break;
            case 'r':
                if (this._patternState.pattern?.pattern !== 'random') {
                    this._patternState.rotation = (this._patternState.rotation + 90) % 360;
                    this._patternState.pattern = getPatternWithRotation(
                        this._patternState.key, this._patternState.rotation
                    );
                    eventBus.emit('pattern:rotationChanged', {
                        pattern: this._patternState.pattern,
                        rotation: this._patternState.rotation
                    });
                }
                break;
            case 'b': {
                const cc = this._canvasController;
                cc.bucketToolActive = !cc.bucketToolActive;
                document.getElementById('bucketToolBtn')?.classList.toggle('active', cc.bucketToolActive);
                if (cc.bucketToolActive) this.deselectPattern();
                cc._updateCursor();
                break;
            }
            case 'a':
                this.randomize();
                break;
            case 'c':
                this.clear();
                break;
            case 'delete':
                if (this._canvasController.selection) {
                    e.preventDefault();
                    this._canvasController.deleteSelection();
                }
                break;
            case 'g':
                this.toggleGrid();
                break;
            case 'h':
                this.toggleHighlightsGrid();
                break;
            case 'i':
                this._togglePerf();
                break;
            case '?':
                e.preventDefault();
                document.getElementById('instructionsModal').classList.add('show');
                break;
        }
    }

    _handleKeyUp(e) {
        if (e.key === 'Control') this._canvasController.ctrlPressed = false;
        if (e.key === 'Shift') this._canvasController.shiftPressed = false;
        if (e.key === 'Alt') this._canvasController.altPressed = false;
    }

    // =========================================
    // CONTROL PRINCIPAL
    // =========================================

    _syncPlayButtonState() {
        const isRunning = this.automaton.isRunning;
        const playIcon = document.getElementById('playIcon');
        const playBtn = document.getElementById('playBtn');
        const playText = document.getElementById('playText');
        const stepBtn = document.getElementById('stepBtn');
        if (playIcon) playIcon.className = isRunning ? 'fas fa-pause' : 'fas fa-play';
        const textEl = playText || playBtn?.querySelector('span');
        if (textEl) textEl.textContent = t(isRunning ? 'controls.pause' : 'controls.play');
        if (stepBtn) stepBtn.disabled = isRunning;
    }

    togglePlay() {
        if (this.automaton.isLimitReached) {
            this.automaton.isLimitReached = false;
            this.automaton.generation = 0;
            this.automaton.updateStats();
        }
        const isRunning = this.automaton.toggleRunning();
        if (isRunning) {
            this.automaton.stateManager?.stopTracking();
        } else {
            this.automaton.stateManager?.startTracking();
        }
        this._syncPlayButtonState();
    }

    step() {
        this.automaton.stateManager?.saveState(this.automaton.generation);
        this.automaton.nextGeneration();
        this.automaton.render();
    }

    _getPercentage() {
        const slider = document.getElementById('randomPercentage');
        return slider ? parseInt(slider.value, 10) / 100 : 0.35;
    }

    randomize() {
        const wasRunning = this.automaton.isRunning;
        if (wasRunning) this.togglePlay();
        this.automaton.randomize(this._getPercentage());
        if (wasRunning) requestAnimationFrame(() => this.togglePlay());
    }

    _stopAutomaton() {
        this.automaton.stop();
        this.automaton.isRunning = false;
        eventBus.emit('automaton:runningChanged', {isRunning: false});
    }

    clear() {
        if (this.automaton.isRunning) this._stopAutomaton();
        this.automaton.clear();
        this._syncPlayButtonState();
    }

    undo() {
        if (this.automaton.undoCount === 0) {
            this._showNotification(t('notif.noUndo'), 'warning', 1500);
            return;
        }
        if (this.automaton.undo()) {
            this._showNotification(t('notif.undo'), 'info', 1000);
        }
    }

    redo() {
        if (this.automaton.redoCount === 0) {
            this._showNotification(t('notif.noRedo'), 'warning', 1500);
            return;
        }
        if (this.automaton.redo()) {
            this._showNotification(t('notif.redo'), 'info', 1000);
        }
    }

    updateSpeed() {
        const slider = document.getElementById('speedControl');
        this.automaton.setSpeed(parseInt(slider.value));
        this.updateSpeedDisplay();
    }

    decreaseSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value, 10);
        if (value <= 1) return;
        slider.value = value - 1;
        slider.dispatchEvent(new Event('input'));
    }

    increaseSpeed() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value, 10);
        if (value >= 10) return;
        slider.value = value + 1;
        slider.dispatchEvent(new Event('input'));
    }

    updateSpeedDisplay() {
        const slider = document.getElementById('speedControl');
        const value = parseInt(slider.value);
        const speedTexts = [
            t('speed.very_slow'), t('speed.slow'), t('speed.normal'),
            t('speed.fast'), t('speed.very_fast')
        ];
        const index = Math.min(Math.max(Math.floor((value - 1) / 2), 0), speedTexts.length - 1);
        const display = document.getElementById('speedValue');
        if (display) display.textContent = `${speedTexts[index]} (${value}/10)`;
    }

    updateGridSizeDisplay() {
        this._gridController.updateGridSizeDisplay();
    }

    updateCellSize() {
        this._gridController.updateCellSize();
    }

    updateCellSizeDisplay() {
        this._gridController.updateCellSizeDisplay();
    }

    autoSizeGrid() {
        this._gridController.autoSizeGrid();
    }

    toggleGrid() {
        return this._gridController.toggleGrid();
    }

    toggleHighlightsGrid() {
        return this._gridController.toggleHighlightsGrid();
    }

    _togglePerf() {
        const btn = document.getElementById('perfToggle');
        const overlay = document.getElementById('perfOverlay');
        if (!btn || !overlay) return;
        const active = btn.classList.toggle('active');
        overlay.style.display = active ? 'block' : 'none';
        this.automaton.setPerfVisible(active);
        if (active) {
            this._updatePerfOverlay({
                genPerSec: 0, stepMs: 0, renderMs: 0,
                mode: this.automaton.specialMode || 'Standard'
            });
        }
    }

    _updatePerfOverlay(perf) {
        const overlay = document.getElementById('perfOverlay');
        if (!overlay || overlay.style.display === 'none') return;
        const stepMs = perf.stepMs.toFixed(1);
        const renderMs = perf.renderMs.toFixed(1);
        const totalMs = (perf.stepMs + perf.renderMs).toFixed(1);
        const cls = (ms) => ms < 16 ? '' : ms < 33 ? 'warn' : 'slow';
        overlay.innerHTML = `
            <div class="perf-row"><span class="perf-label">gen/s</span><span class="perf-value">${perf.genPerSec}</span></div>
            <div class="perf-row"><span class="perf-label">step</span><span class="perf-value ${cls(perf.stepMs)}">${stepMs}ms</span></div>
            <div class="perf-row"><span class="perf-label">render</span><span class="perf-value ${cls(perf.renderMs)}">${renderMs}ms</span></div>
            <div class="perf-row"><span class="perf-label">total</span><span class="perf-value ${cls(perf.stepMs + perf.renderMs)}">${totalMs}ms</span></div>
            <div class="perf-row"><span class="perf-label">modo</span><span class="perf-value" style="color:var(--gray-text)">${perf.mode}</span></div>`;
    }

    toggleInfluenceArea() {
        this._effectsController.toggleInfluenceArea();
    }

    quickToggleInfluenceArea() {
        this._effectsController.quickToggleInfluenceArea();
    }

    toggleActivityEffect() {
        this._effectsController.toggleActivityEffect();
    }

    _toggleActivityEffect(v) {
        this._effectsController._toggleActivityEffect(v);
    }

    toggleActivityEffectCheckbox() {
        this._effectsController._syncActivityEffectCheckbox();
    }

    _syncActivityColorsBlock(active) {
        this._effectsController.syncActivityColorsBlock(active);
    }

    exportPattern() {
        this._importExportController.exportPattern();
    }

    importPatternFromFile() {
        this._importExportController.importPatternFromFile();
    }

    updateLimitType() {
        const select = document.getElementById('limitType');
        const valueGroup = document.getElementById('limitValueGroup');
        const limitValue = document.getElementById('limitValue');
        if (select.value === 'none') {
            valueGroup.style.display = 'none';
            this.automaton.setLimit('none', 0);
        } else {
            valueGroup.style.display = 'block';
            this.automaton.setLimit(select.value, parseInt(limitValue.value));
        }
        this.automaton.isLimitReached = false;
    }

    updateLimitValue() {
        const select = document.getElementById('limitType');
        const slider = document.getElementById('limitValue');
        const value = parseInt(slider.value);
        const display = document.getElementById('limitValueDisplay');
        if (display) display.textContent = value.toLocaleString();
        if (select.value !== 'none') this.automaton.setLimit(select.value, value);
    }

    changeRule() {
        this._ruleController.changeRule();
    }

    applyCustomRule() {
        this._ruleController.applyCustomRule();
    }

    changeNeighborhoodType(type) {
        this._neighborhoodController.changeNeighborhoodType(type);
    }

    changeNeighborhoodRadius(radius) {
        this._neighborhoodController.changeNeighborhoodRadius(radius);
    }

    _renderNeighborhoodGrid(radius) {
        this._neighborhoodController.renderGrid(radius);
    }

    loadRules() {
        this._ruleController.loadRules();
    }

    _showNotification(message, type = 'info', duration = 2000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position:fixed;top:20px;right:20px;padding:12px 20px;
            background:${type === 'warning' ? '#f59e0b' : '#10b981'};
            color:white;border-radius:4px;font-size:14px;font-weight:500;
            z-index:10000;opacity:0;transform:translateY(-10px);
            transition:opacity .3s,transform .3s;pointer-events:none;`;
        document.body.appendChild(notification);
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
            notification.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(-10px)';
            setTimeout(() => notification.parentNode?.removeChild(notification), 300);
        }, duration);
    }

    _bindPatternsControls() {
        const toggleRowsBtn = document.getElementById('patternsToggleRows');
        const toggleCompactBtn = document.getElementById('patternsToggleCompact');
        const toggleSortBtn = document.getElementById('patternsToggleSort');
        const bucketBtn = document.getElementById('bucketToolBtn');
        const container = document.getElementById('patternsContainer');

        if (bucketBtn) {
            this._addEventListener(bucketBtn, 'click', () => {
                const cc = this._canvasController;
                if (!cc) return;
                cc.bucketToolActive = !cc.bucketToolActive;
                bucketBtn.classList.toggle('active', cc.bucketToolActive);
                if (cc.bucketToolActive) this.deselectPattern();
                cc._updateCursor();
            });
        }

        this._cleanups.push(
            eventBus.on('pattern:selected', () => {
                if (this._canvasController?.bucketToolActive) {
                    this._canvasController.bucketToolActive = false;
                    document.getElementById('bucketToolBtn')?.classList.remove('active');
                    this._canvasController._updateCursor();
                }
                this._displayController?.updateDrawModeIndicator();
            })
        );

        if (toggleRowsBtn && container) {
            this._addEventListener(toggleRowsBtn, 'click', () => {
                this.patternsTwoRows = !this.patternsTwoRows;
                container.classList.toggle('two-rows', this.patternsTwoRows);
                const icon = toggleRowsBtn.querySelector('i');
                if (icon) icon.className = this.patternsTwoRows
                    ? 'fas fa-grip-lines-vertical'
                    : 'fas fa-grip-lines';
            });
        }

        if (toggleCompactBtn && container) {
            this._addEventListener(toggleCompactBtn, 'click', () => {
                this.patternsCompactView = !this.patternsCompactView;
                container.classList.toggle('compact-view', this.patternsCompactView);
                document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
                    btn.classList.toggle('compact', this.patternsCompactView);
                });
                const icon = toggleCompactBtn.querySelector('i');
                if (icon) icon.className = this.patternsCompactView ? 'fas fa-expand-alt' : 'fas fa-compress';
            });
        }

        const pm = this._getPatternManager();
        if (toggleSortBtn && pm) {
            this._addEventListener(toggleSortBtn, 'click', () => {
                this.patternsSortByCount = !this.patternsSortByCount;
                const icon = toggleSortBtn.querySelector('i');
                if (icon) icon.className = this.patternsSortByCount
                    ? 'fas fa-sort-numeric-down'
                    : 'fas fa-sort-alpha-down';
                pm.renderPatterns(this.patternsSortByCount);
            });
            pm.renderPatterns(false);
            toggleSortBtn.querySelector('i')?.classList.add('fa-sort-alpha-down');
        }

        // Aplicar estado inicial DESPUÉS de renderPatterns para que los botones existan.
        // PatternManager llama renderPatterns() en su constructor (antes de que UIController
        // corra), por lo que cualquier clase aplicada antes quedaría sin efecto sobre los
        // botones recién creados por ese primer render.
        if (container) {
            // 1 fila por defecto
            this.patternsTwoRows = false;
            container.classList.remove('two-rows');
            if (toggleRowsBtn) {
                const icon = toggleRowsBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-grip-lines';
            }

            // Vista compacta por defecto
            this.patternsCompactView = true;
            container.classList.add('compact-view');
            document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => btn.classList.add('compact'));
            if (toggleCompactBtn) {
                const icon = toggleCompactBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-expand-alt';
            }
        }

        const showAllBtn = document.getElementById('patternsShowAll');
        if (showAllBtn && pm) {
            this._addEventListener(showAllBtn, 'click', () => {
                this.patternsShowAll = !this.patternsShowAll;
                showAllBtn.classList.toggle('active', this.patternsShowAll);
                pm.setShowAll(this.patternsShowAll);
            });
            this._cleanups.push(
                eventBus.on('automaton:filterChanged', () => {
                    if (this.patternsShowAll) {
                        this.patternsShowAll = false;
                        showAllBtn.classList.remove('active');
                        pm.setShowAll(false);
                    }
                })
            );
        }
    }

    _bindPatternEvents() {
        this._cleanups.push(
            eventBus.on('pattern:selected', () => this._displayController?.updateDrawModeIndicator()),
            eventBus.on('pattern:updated', () => this._displayController?.updateDrawModeIndicator()),
            eventBus.on('pattern:cleared', () => this._displayController?.updateDrawModeIndicator())
        );

        const cancelBtn = document.getElementById('cancelPatternBtn');
        if (cancelBtn) {
            this._addEventListener(cancelBtn, 'click', () => this.deselectPattern());
        }
    }

    deselectPattern() {
        this._patternState.pattern = null;
        this._patternState.key = null;
        this._patternState.rotation = 0;

        document.querySelectorAll('.pattern-btn-horizontal').forEach(btn => {
            btn.classList.remove('active');
        });

        const nameEl = document.getElementById('patternNameMini');
        const detailsEl = document.getElementById('patternDetailsMini');
        const descEl = document.getElementById('patternDescriptionMini');
        if (nameEl) nameEl.textContent = t('patterns.select');
        if (detailsEl) detailsEl.textContent = t('patterns.details');
        if (descEl) descEl.textContent = '';

        this._getPatternManager()?.hidePatternPreview();
        this._getPatternManager()?.hideInfluenceArea();
        this._displayController?.updateDrawModeIndicator();
    }
}

export {UIController};