/**
 * scripts/app/automaton.js
 *
 * CellularAutomaton — Coordinador del autómata celular.
 *
 * Cambios ESM:
 *   - window.RULES / polling → rulesLoader.RULES + eventBus.once('rules:loaded')
 *   - Todas las clases colaboradoras importadas explícitamente.
 *   - Sin `window.CellularAutomaton`.
 */

import {AppConfig} from '../utils/config.js';
import {eventBus} from '../infrastructure/event-bus.js';

import {CellularAutomatonCore} from '../core/cellular-automaton.js';
import {GridRenderer} from '../rendering/grid-renderer.js';
import {GridWorkerManager} from '../infrastructure/workers/grid-worker-manager.js';
import {SpecialEngineManager} from '../core/engines/special-engine-manager.js';
import {AnimationLoop} from './automaton-loop.js';
import {SimulationLimiter} from './simulator-limiter.js';
import {StateManager} from './state-manager.js';
import {EditCoordinator} from './edit-coordinator.js';
import {rulesLoader} from '../config/rules-loader.js';

class CellularAutomaton {
    constructor(gridWidth = AppConfig.GRID.DEFAULT_WIDTH, gridHeight = gridWidth, cellSize = AppConfig.GRID.DEFAULT_CELL_SIZE) {
        // Compatibilidad con firma legacy: constructor(gridSize, cellSize)
        if (gridHeight >= 1 && gridHeight <= AppConfig.GRID.MAX_CELL_SIZE && gridWidth > AppConfig.GRID.MAX_CELL_SIZE) {
            cellSize = gridHeight;
            gridHeight = gridWidth;
        }

        this.gridWidth = Math.min(Math.max(gridWidth, AppConfig.GRID.MIN_CELLS), AppConfig.GRID.MAX_CELLS);
        this.gridHeight = Math.min(Math.max(gridHeight, AppConfig.GRID.MIN_CELLS), AppConfig.GRID.MAX_CELLS);
        this.cellSize = Math.min(Math.max(cellSize, AppConfig.GRID.MIN_CELL_SIZE), AppConfig.GRID.MAX_CELL_SIZE);

        // === CORE MATEMÁTICO ===
        this.core = new CellularAutomatonCore({
            width: this.gridWidth,
            height: this.gridHeight,
            rule: {birth: [3], survival: [2, 3]},
            neighborhoodType: 'moore',
            neighborhoodRadius: AppConfig.NEIGHBORHOOD.DEFAULT_RADIUS,
            wrapEdges: true
        });

        // === STATE MANAGER ===
        this.stateManager = new StateManager(this.core.gridManager, {
            maxHistory: AppConfig.STATE.MAX_HISTORY,
            maxPopulationHistory: AppConfig.STATE.MAX_POPULATION_HISTORY
        });
        this.stateManager.on({
            onStateChange: (event) => this._handleStateChange(event),
            onHistoryChange: (stats) => this._handleHistoryChange(stats)
        });
        this.stateManager.startTracking();

        this.core.on({
            onGeneration: (stats) => this._handleCoreGeneration(stats),
            onCellChange: (indices, count) => this._handleCoreCellChange(indices, count),
            onStateChange: (event) => this._handleCoreStateChange(event)
        });

        // === RENDERIZADO VISUAL ===
        this.renderer = new GridRenderer({
            canvas: document.getElementById('canvas'),
            container: document.getElementById('canvas-container'),
            gridWidth: this.gridWidth,
            gridHeight: this.gridHeight,
            cellSize: this.cellSize,
            showGrid: AppConfig.GRID.DEFAULT_SHOW_GRID ?? false,
            showActivityEffect: true,
            getCell: (x, y) => this.core.getCell(x, y),
            getRD2DState: (x, y) => this.rd2dEngine?.stateGrid?.[x]?.[y],
            isRD2DActive: () => this.specialMode === SpecialEngineManager.MODES.RD2D && this.rd2dEngine?.isActive,
            getGridWidth: () => this.gridWidth,
            getGridHeight: () => this.gridHeight,
            getGridColumns: () => this.core.gridManager.grid,
            showGridHighlights: AppConfig.GRID.DEFAULT_SHOW_HIGHLIGHTS ?? false
        });

        // === ESTADO DE EJECUCIÓN ===
        this.generation = 0;
        this._loop = new AnimationLoop({onStep: () => this._step()});

        // === WORKERS ===
        this._workerManager = new GridWorkerManager({
            workerPath: 'scripts/infrastructure/workers/automaton-worker.js',
            threshold: AppConfig.WORKER.THRESHOLD,
            getGridWidth: () => this.gridWidth,
            getGridHeight: () => this.gridHeight,
            getCore: () => this.core,
            onResult: ({generation, population, changedCells, changedCount}) => {
                const tStep = performance.now();
                this.generation = generation;
                this.stateManager.recordPopulation(population);
                if (changedCount > 0) {
                    for (let i = 0; i < changedCount; i++) {
                        this.renderer.markDirtyIndex(changedCells[i]);
                    }
                } else {
                    this.renderer.markAllDirty();
                }
                this.updateStats(population);
                this.checkLimits();
                this.renderer.updateActivityAges(changedCells, changedCount);
                this.render();
                if (this._workerStartTime && this._perfVisible) {
                    const modeLabel = this._getPerfModeLabel();
                    this._debugTiming(modeLabel, this._workerStartTime, tStep, performance.now());
                    this._workerStartTime = null;
                }
            },
            onError: () => {
                this.renderer.markAllDirty();
                this.render();
            }
        });
        this._workerManager.init();

        // === MOTORES ESPECIALES ===
        this._engineManager = new SpecialEngineManager({
            getRenderer: () => this.renderer,
            setRenderer: (r) => {
                this.renderer = r;
            },
            getCore: () => this.core,
            setCore: (c) => {
                this.core = c;
            },
            getGridWidth: () => this.gridWidth,
            getGridHeight: () => this.gridHeight,
            getCellSize: () => this.cellSize,
            getAutomaton: () => this
        });

        // === LÍMITES ===
        this._limiter = new SimulationLimiter({
            onLimitReached: () => {
                this.stop();
                eventBus.emit('automaton:runningChanged', {isRunning: false});
            }
        });

        // === EDITOR ===
        this._editor = new EditCoordinator(this);

        // === EVENTOS GLOBALES ===
        this._cleanupResize = this._addEventListener(window, 'resize', () => {
            setTimeout(() => this.render(), 100);
        });

        this._init().catch(err => {
            console.error('Error inicializando autómata:', err);
            eventBus.emit('automaton:error', err);
        });
    }

    // =========================================
    // PROPIEDADES DELEGADAS
    // =========================================

    get canvas() {
        return this.renderer?.canvas;
    }

    get ctx() {
        return this.renderer?.ctx;
    }

    get showGrid() {
        return this.renderer?.getConfig('showGrid');
    }

    get grid() {
        return this.core?.gridManager?.grid;
    }

    set grid(value) {
        if (this.core?.gridManager) this.core.gridManager.grid = value;
    }

    get limitType() {
        return this._limiter.limitType;
    }

    get isLimitReached() {
        return this._limiter.isLimitReached;
    }

    set isLimitReached(v) {
        this._limiter.isLimitReached = v;
    }

    get rule() {
        return {
            birth: this.core?.ruleEngine?.birth || [3],
            survival: this.core?.ruleEngine?.survival || [2, 3]
        };
    }

    get neighborhoodType() {
        return this.core?.neighborhood?.type || 'moore';
    }

    get neighborhoodRadius() {
        return this.core?.neighborhood?.radius || AppConfig.NEIGHBORHOOD.MIN_RADIUS;
    }

    get wrapEdges() {
        return this.core?.neighborhood?.wrapEdges ?? true;
    }

    set wrapEdges(value) {
        this.core?.neighborhood?.configure({wrapEdges: value});
        this._workerManager?.updateConfig({
            wrapX: this.core.neighborhood.wrapX,
            wrapY: this.core.neighborhood.wrapY
        });
    }

    get wrapMode() {
        return this.core?.neighborhood?.wrapMode ?? 'both';
    }

    set wrapMode(value) {
        this.core?.neighborhood?.configure({wrapMode: value});
        // Propagar al worker en caliente — no requiere reinit completo porque
        // solo cambia el comportamiento de borde, no el grid ni la regla.
        this._workerManager.updateConfig({
            wrapX: this.core.neighborhood.wrapX,
            wrapY: this.core.neighborhood.wrapY
        });
    }

    get undoCount() {
        return this.stateManager?.undoCount || 0;
    }

    get redoCount() {
        return this.stateManager?.redoCount || 0;
    }

    get canUndo() {
        return this.stateManager?.canUndo || false;
    }

    get canRedo() {
        return this.stateManager?.canRedo || false;
    }

    get populationHistory() {
        return this.stateManager?.populationHistory;
    }

    get specialMode() {
        return this._engineManager.specialMode;
    }

    set specialMode(v) {
        this._engineManager.specialMode = v;
    }

    get wolframEngine() {
        return this._engineManager.wolframEngine;
    }

    set wolframEngine(v) {
        this._engineManager.wolframEngine = v;
    }

    get rd2dEngine() {
        return this._engineManager.rd2dEngine;
    }

    set rd2dEngine(v) {
        this._engineManager.rd2dEngine = v;
    }

    get triangleEngine() {
        return this._engineManager.triangleEngine;
    }

    set triangleEngine(v) {
        this._engineManager.triangleEngine = v;
    }

    get uwEngine() {
        return this._engineManager.uwEngine;
    }

    set uwEngine(v) {
        this._engineManager.uwEngine = v;
    }

    get langtonEngine() {
        return this._engineManager.langtonEngine;
    }

    set langtonEngine(v) {
        this._engineManager.langtonEngine = v;
    }

    get wireworldEngine() {
        return this._engineManager.wireworldEngine;
    }

    set wireworldEngine(v) {
        this._engineManager.wireworldEngine = v;
    }

    get generationsEngine() {
        return this._engineManager.generationsEngine;
    }

    set generationsEngine(v) {
        this._engineManager.generationsEngine = v;
    }

    get hexEngine() {
        return this._engineManager.hexEngine;
    }

    set hexEngine(v) {
        this._engineManager.hexEngine = v;
    }

    get worker() {
        return this._workerManager._worker;
    }

    get workerThreshold() {
        return this._workerManager.threshold;
    }

    get isWorkerProcessing() {
        return this._workerManager.isProcessing;
    }

    set isWorkerProcessing(v) {
        this._workerManager.isProcessing = v;
    }

    get isRunning() {
        return this._loop.isRunning;
    }

    set isRunning(_) { /* no-op — compatibilidad */
    }

    // =========================================
    // INICIALIZACIÓN
    // =========================================

    async _init() {
        await this._initRule();
        this.renderer.markAllDirty();
        this.renderer.render({generation: 0});
        eventBus.emit('automaton:ready', this);
    }

    /**
     * Aplica la regla por defecto (Conway) una vez que las reglas están disponibles.
     * Usa el evento 'rules:loaded' en lugar de polling activo sobre window.RULES.
     */
    async _initRule() {
        let rules = rulesLoader.RULES;

        // Si las reglas aún no están cargadas, esperar el evento con timeout de seguridad
        if (!rules || Object.keys(rules).length === 0) {
            rules = await Promise.race([
                new Promise(resolve => eventBus.once('rules:loaded', ({rules}) => resolve(rules))),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout esperando rules:loaded')), 5000)
                )
            ]).catch(() => null);
        }

        if (!rules) return;

        const ruleKey = rules.conway ? 'conway' : Object.keys(rules)[0];
        if (ruleKey && rules[ruleKey]) {
            const rule = rules[ruleKey];
            this.core.setRule({birth: rule.birth, survival: rule.survival});
        }
    }

    // =========================================
    // CALLBACKS DEL CORE
    // =========================================

    _handleCoreGeneration(stats) {
        this.generation = stats.generation;
        this.stateManager.recordPopulation(stats.population);
        eventBus.emit('stats:updated', stats);
    }

    _handleCoreCellChange(indices, count) {
        for (let i = 0; i < count; i++) {
            this.renderer.markDirtyIndex(indices[i]);
        }
    }

    _handleCoreStateChange(event) {
        switch (event.type) {
            case 'clear':
                this.renderer.resetActivity();
                this.renderer.markAllDirty();
                break;
            case 'resize':
                this.gridWidth = event.width ?? this.gridWidth;
                this.gridHeight = event.height ?? this.gridHeight;
                this.renderer.markAllDirty();
                break;
            case 'ruleChange':
                this.generation = 0;
                this.isLimitReached = false;
                this.renderer.markAllDirty();
                this.render();
                this._initWorker();
                eventBus.emit('automaton:ruleChanged', this.core.ruleEngine);
                break;
            case 'neighborhoodChange':
                this.generation = 0;
                this.isLimitReached = false;
                this.renderer.markAllDirty();
                this._initWorker();
                eventBus.emit('automaton:neighborhoodChanged', event.info);
                break;
            case 'randomize':
                this.renderer.resetActivity();
                this.renderer.markAllDirty();
                eventBus.emit('automaton:randomized', event);
                break;
            case 'deserialize':
                this.renderer.markAllDirty();
                this.updateStats();
                break;
        }
    }

    _handleStateChange(event) {
        eventBus.emit('state:changed', event);
        switch (event.type) {
            case 'clear':
            case 'randomize':
            case 'import':
            case 'paste':
                this.renderer.markAllDirty();
                this.updateStats();
                this.render();
                break;
        }
    }

    _handleHistoryChange(stats) {
        eventBus.emit('history:changed', stats);
    }

    // =========================================
    // WORKERS
    // =========================================

    _initWorker() {
        this._cleanupWorker();
        this._workerManager.init();
    }

    _syncWorkerGrid() {
        this._workerManager.syncGrid();
    }

    _cleanupWorker() {
        this._workerManager.cleanup();
    }

    // =========================================
    // GENERACIÓN — dispatch polimórfico
    // =========================================

    nextGeneration() {
        if (this.checkLimits()) return 0;
        const t0 = performance.now();
        return this.specialMode
            ? this._stepEngineMode(t0)
            : this._stepStandardMode(t0);
    }

    _stepEngineMode(t0) {
        const desc = this._engineManager.stepActive();
        if (!desc) return 0;

        if (!desc.continued) {
            this.stop();
            eventBus.emit('automaton:runningChanged', {isRunning: false});
            if (desc.stopMessage) console.debug(desc.stopMessage);
        }

        this.generation = desc.generation;
        this.updateStats(desc.population);

        const cc = desc.changedCells;
        if (!desc.skipActivity) this.renderer.updateActivityAges(cc);
        if (desc.markDirtyFromCells) {
            for (let i = 0; i < cc.length; i++) {
                this.renderer.markDirty(cc[i] >>> 16, cc[i] & 0xFFFF);
            }
        }

        const tStep = performance.now();
        this.render();
        this._debugTiming(desc.label, t0, tStep, performance.now());
        return 1;
    }

    _stepStandardMode(t0) {
        const result = (this.worker && Math.max(this.gridWidth, this.gridHeight) >= AppConfig.WORKER.THRESHOLD)
            ? this._nextGenerationWorker()
            : this._nextGenerationCore();
        this._pendingStepT0 = t0;
        this._pendingStepTime = performance.now();
        return result;
    }

    // =========================================
    // WRAPPERS DE RENDERER
    // =========================================

    _resetRendererCanvas() {
        this.renderer.resizeCanvas();
    }

    _reGrid() {
        this.renderer.reGrid();
    }

    _resizeRenderer(gw, gh, cs) {
        this.renderer.resize(
            gw ?? this.gridWidth,
            gh ?? this.gridHeight,
            cs ?? this.cellSize
        );
    }

    _setRendererGridManager(gm) {
        this.renderer.setGridManager?.(gm);
    }

    // =========================================
    // CORE — PASO
    // =========================================

    _nextGenerationCore() {
        const stats = this.core.step();
        const changed = stats.births + stats.deaths;
        if (changed > this.gridWidth * this.gridHeight * 0.1) {
            this.renderer.markAllDirty();
        }
        this._checkLimitsWithPop(stats.population);
        this.renderer.updateActivityAges(stats.changedCells, stats.changedCount);
        return changed;
    }

    _nextGenerationWorker(stepsPerFrame = 1) {
        this._workerStartTime = performance.now();
        this._workerManager.requestNextGeneration(stepsPerFrame);
        return 0;
    }

    _getPerfModeLabel() {
        if (!this.specialMode) return 'Standard';
        return this.specialMode.name;
    }

    _debugTiming(mode, t0, tStep, tRender) {
        const stepMs = tStep - t0;
        const renderMs = tRender - tStep;
        const totalMs = tRender - t0;
        const alpha = 0.15;

        if (!this._perf || this._perf.mode !== mode) {
            this._perf = {
                stepMs, renderMs, totalMs,
                lastSecond: tRender, lastGenSnapshot: this.generation,
                genPerSec: 0, mode
            };
        } else {
            this._perf.stepMs = alpha * stepMs + (1 - alpha) * this._perf.stepMs;
            this._perf.renderMs = alpha * renderMs + (1 - alpha) * this._perf.renderMs;
            this._perf.totalMs = alpha * totalMs + (1 - alpha) * this._perf.totalMs;
            this._perf.mode = mode;
        }

        if (tRender - this._perf.lastSecond >= 1000) {
            this._perf.genPerSec = this.generation - this._perf.lastGenSnapshot;
            this._perf.lastGenSnapshot = this.generation;
            this._perf.lastSecond = tRender;
        }

        if (this._perfVisible) eventBus.emit('perf:update', this._perf);

        if (!this._lastDebugLog || tRender - this._lastDebugLog >= 2000) {
            this._lastDebugLog = tRender;
            console.debug(
                `⏱ [${mode}] Gen ${this.generation} | ` +
                `step: ${stepMs.toFixed(2)}ms | render: ${renderMs.toFixed(2)}ms | ` +
                `total: ${totalMs.toFixed(2)}ms`
            );
        }
    }

    // =========================================
    // BUCLE DE ANIMACIÓN
    // =========================================

    _step(stepsPerFrame = 1) {
        if (this.specialMode) {
            this.nextGeneration();
            return;
        }
        if (this._workerManager.isProcessing) return;

        if (this._workerManager.isAvailable) {
            this._nextGenerationWorker(stepsPerFrame);
            return;
        }

        for (let i = 0; i < stepsPerFrame; i++) {
            if (!this.isRunning) break;
            if (this.nextGeneration() === 0) break;
        }
        this.render();
        if (this._pendingStepTime !== undefined) {
            const modeLabel = this._getPerfModeLabel();
            this._debugTiming(modeLabel, this._pendingStepT0, this._pendingStepTime, performance.now());
            this._pendingStepT0 = this._pendingStepTime = undefined;
        }
    }

    // =========================================
    // API PÚBLICA — consulta y configuración
    // =========================================

    render() {
        if (!this.renderer || this._isDestroyed) return;
        this.renderer.render({generation: this.generation});
    }

    _markAllDirty() {
        this.renderer?.markAllDirty();
    }

    setCell(x, y, state, markDirty = true) {
        if (markDirty && this.stateManager?.isTracking) {
            this.stateManager.saveState(this.generation);
        }
        const changed = this.core.setCell(x, y, state);
        if (changed) {
            this.renderer.markDirty(x, y);
            this._engineManager.onCellSet?.(x, y, state);
        }
        return changed;
    }

    getCell(x, y) {
        return this.core.getCell(x, y);
    }

    /**
     * @param {number[]} birth    — vecinos que hacen nacer una celda muerta
     * @param {number[]} survival — vecinos que mantienen viva una celda viva
     */
    setRule(birth, survival) {
        this.core.setRule({birth, survival});
    }

    setRuleByKey(ruleKey) {
        const rules = rulesLoader.RULES;
        if (!rules?.[ruleKey]) throw new Error(`Regla ${ruleKey} no encontrada`);
        const rule = rules[ruleKey];
        this.setRule(rule.birth, rule.survival);
        return true;
    }

    resizeGrid(newWidth, newHeight = newWidth) {
        const w = Math.min(Math.max(newWidth, AppConfig.GRID.MIN_CELLS), AppConfig.GRID.MAX_CELLS);
        const h = Math.min(Math.max(newHeight, AppConfig.GRID.MIN_CELLS), AppConfig.GRID.MAX_CELLS);

        if (this.isRunning) {
            this.stop();
            eventBus.emit('automaton:runningChanged', {isRunning: false});
        }

        this.core.resize(w, h);
        this.gridWidth = this.core.gridManager.width;
        this.gridHeight = this.core.gridManager.height;

        // Delegar resize a motores con geometría propia (Triangle, Hex) y
        // sincronizar dimensiones de RD2D. handledRenderer indica si el motor
        // ya ajustó su renderer — en ese caso no llamar renderer.resize().
        const {handledRenderer} = this._engineManager.onResize(this.gridWidth, this.gridHeight);
        if (!handledRenderer) {
            this.renderer.resize(this.gridWidth, this.gridHeight, this.cellSize);
        }

        this.renderer.markAllDirty();
        this.updateStats();
        this.render();

        if (Math.max(w, h) >= AppConfig.WORKER.THRESHOLD && !this._engineManager.usesOwnWorker()) {
            this._initWorker();
        } else {
            this._cleanupWorker();
        }

        eventBus.emit('automaton:resized', {width: w, height: h});
    }

    setCellSize(size) {
        const newSize = Math.min(Math.max(size, AppConfig.GRID.MIN_CELL_SIZE), AppConfig.GRID.MAX_CELL_SIZE);
        this.cellSize = newSize;

        const {handled} = this._engineManager.onCellSizeChange(this.gridWidth, this.gridHeight, newSize);
        if (!handled) {
            this.renderer.resize(this.gridWidth, this.gridHeight, newSize);
        }

        this.renderer.resetActivity();
        this.render();
        eventBus.emit('automaton:zoomChanged', {zoom: newSize});
    }

    setNeighborhoodType(type) {
        this.core.setNeighborhood({type});
    }

    setNeighborhoodRadius(radius) {
        this.core.setNeighborhood({radius});
    }

    updateStats(populationOverride = null) {
        const population = populationOverride !== null
            ? populationOverride
            : this.core.gridManager.countPopulation();
        const density = (population / (this.gridWidth * this.gridHeight) * 100).toFixed(1);
        eventBus.emit('stats:updated', {generation: this.generation, population, density});
    }

    checkLimits() {
        return this._limiter.check(this.generation, () => this.core.gridManager.countPopulation());
    }

    _checkLimitsWithPop(population) {
        return this._limiter.check(this.generation, () => population);
    }

    setLimit(type, value) {
        this._limiter.setLimit(type, value);
        eventBus.emit('automaton:limitChanged', {type, value});
    }

    getCellFromMouse(e) {
        return this.renderer.getCellFromMouse(e);
    }

    toggleGrid() {
        const newState = this.renderer.toggleGrid();
        this.render();
        eventBus.emit('automaton:gridToggled', {showGrid: newState});
        return newState;
    }

    toggleGridHighlights() {
        const newState = this.renderer.toggleGridHighlights();
        this.render();
        eventBus.emit('automaton:gridHighlightsToggled', {showGridHighlights: newState});
        return newState;
    }

    setShowActivityEffect(enabled) {
        this.renderer.setConfig('showActivityEffect', enabled);
        this.render();
        eventBus.emit('automaton:showActivityEffectChanged', {enabled});
        return enabled;
    }

    setPerfVisible(visible) {
        this._perfVisible = visible;
        if (!visible) this._perf = null;
    }

    // =========================================
    // CONTROL DE EJECUCIÓN
    // =========================================

    toggleRunning() {
        if (this.checkLimits()) {
            this.isLimitReached = false;
            this.generation = 0;
            this.updateStats();
        }
        if (this._loop.isRunning) {
            this.stop();
        } else {
            this.start();
        }
        return this._loop.isRunning;
    }

    start() {
        if (this._loop.isRunning) return;
        if (!this.specialMode) this.renderer.markAllDirty();
        this._loop.start();
    }

    stop() {
        this._loop.stop();
    }

    setSpeed(level) {
        const result = this._loop.setSpeed(level);
        eventBus.emit('automaton:speedChanged', {speed: result.interval, stepsPerFrame: result.stepsPerFrame});
        return result.interval;
    }

    // =========================================
    // DELEGACIÓN A EditCoordinator
    // =========================================

    randomize(density) {
        return this._editor.randomize(density);
    }

    clear() {
        return this._editor.clear();
    }

    copyArea(minX, minY, maxX, maxY) {
        return this._editor.copyArea(minX, minY, maxX, maxY);
    }

    async pasteArea(area, ox, oy) {
        return this._editor.pasteArea(area, ox, oy);
    }

    clearPatternCells(area, ox, oy) {
        return this._editor.clearPatternCells(area, ox, oy);
    }

    clearArea(minX, minY, maxX, maxY) {
        return this._editor.clearArea(minX, minY, maxX, maxY);
    }

    async importPattern(pat, cx, cy) {
        return this._editor.importPattern(pat, cx, cy);
    }

    exportPattern(bounds) {
        return this._editor.exportPattern(bounds);
    }

    exportWireworldState(name, desc) {
        return this._editor.exportWireworldState(name, desc);
    }

    importWireworldState(sg, pw, ph) {
        return this._editor.importWireworldState(sg, pw, ph);
    }

    shiftGrid(dx, dy) {
        return this._editor.shiftGrid(dx, dy);
    }

    undo() {
        return this._editor.undo();
    }

    redo() {
        return this._editor.redo();
    }

    // =========================================
    // MOTORES ESPECIALES
    // =========================================

    async _initSpecialEngine(engineName) {
        return this._engineManager.activate(engineName);
    }

    // =========================================
    // API DE DIBUJO
    // =========================================

    getCellCoords(clientX, clientY) {
        // Motores con geometría propia (Triangle, Hex) pasan las coordenadas
        // de cliente directamente al renderer. El path estándar las envuelve
        // en un objeto tipo Event para getCellFromMouse.
        const coords = this._engineManager.getCellCoords(clientX, clientY);
        if (coords !== null) return coords;
        return this.renderer.getCellFromMouse({clientX, clientY});
    }

    drawCellAt(coords, state) {
        const result = this._engineManager.onDrawCell(coords, state);
        if (result.handled) {
            if (result.changed) {
                this.renderer.markDirty(result.dirtyX, result.dirtyY);
                this.render();
                if (result.population !== null) this.updateStats(result.population);
            }
            return result.changed;
        }
        // Path estándar — grid rectangular
        const changed = this.setCell(coords.x, coords.y, state ? 1 : 0);
        if (changed) {
            this.updateStats();
            this.render();
        }
        return changed;
    }

    getEngineStateAt(x, y) {
        if (this.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.wireworldEngine?.isActive) {
            return this.wireworldEngine.stateGrid[x]?.[y] ?? 0;
        }
        return this.core.getCell(x, y);
    }

    setEngineStateAt(x, y, state) {
        if (this.specialMode === SpecialEngineManager.MODES.WIREWORLD && this.wireworldEngine?.isActive) {
            const changed = this.wireworldEngine.setStateAt(x, y, state);
            if (changed) {
                this.updateStats();
                this.render();
            }
            return changed;
        }
        return this.setCell(x, y, state);
    }

    eraseEngineAt(x, y) {
        if (this.specialMode === SpecialEngineManager.MODES.LANGTON && this.langtonEngine?.isActive) {
            this.langtonEngine.eraseAt(x, y);
            this.renderer.markDirty(x, y);
            this.render();
            return;
        }
        const changed = this.setCell(x, y, 0);
        if (changed) {
            this.updateStats();
            this.render();
        }
    }

    addEngineAgentAt(x, y, dir = 0) {
        if (this.specialMode === SpecialEngineManager.MODES.LANGTON && this.langtonEngine?.isActive) {
            this.langtonEngine.addAnt(x, y, dir);
            this.renderer.markDirty(x, y);
            this.render();
            return;
        }
        this.drawCellAt({x, y}, 1);
    }

    syncEngineAfterEdit() {
        this.renderer.resetActivity();
        const {specialMode, langtonEngine, rd2dEngine, wireworldEngine} = this;
        if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) langtonEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) rd2dEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) wireworldEngine.syncFromGrid();
    }

    syncEngineAfterMove() {
        this.renderer.resetActivity();
        const {specialMode, rd2dEngine, wireworldEngine} = this;
        if (specialMode === SpecialEngineManager.MODES.RD2D && rd2dEngine?.isActive) rd2dEngine.syncFromGrid();
        if (specialMode === SpecialEngineManager.MODES.WIREWORLD && wireworldEngine?.isActive) wireworldEngine.syncFromGrid();
    }

    moveEngineAgents(srcX, srcY, srcW, srcH, dstX, dstY) {
        const {specialMode, langtonEngine} = this;
        if (specialMode === SpecialEngineManager.MODES.LANGTON && langtonEngine?.isActive) {
            langtonEngine.moveAgents(srcX, srcY, srcW, srcH, dstX, dstY);
        }
    }

    getActiveEngineInfo() {
        return this._engineManager.getActiveInfo();
    }

    // =========================================
    // LIFECYCLE
    // =========================================

    destroy() {
        if (this._isDestroyed) return;
        this.stop();

        try {
            this._cleanupResize?.();
        } catch (e) { /* ignorar */
        }
        this._cleanupResize = null;

        this._cleanupWorker();
        this.stateManager?.destroy();
        this.stateManager = null;
        this.renderer?.destroy();
        this.renderer = null;
        this.core?.destroy();
        this.core = null;
        this._loop?.destroy();
        this._loop = null;
        this._limiter?.destroy();
        this._limiter = null;
        this._engineManager?.destroy();
        this._engineManager = null;
        this._workerManager?.destroy();
        this._workerManager = null;
        this._editor = null;

        this._isDestroyed = true;
        eventBus.emit('automaton:destroyed');
    }

    _addEventListener(target, event, handler, options) {
        target.addEventListener(event, handler, options);
        return () => target.removeEventListener(event, handler, options);
    }
}

export {CellularAutomaton};