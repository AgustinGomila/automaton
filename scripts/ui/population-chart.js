import {eventBus, Events} from '../infrastructure/event-bus.js';

/**
 * PopulationChart — Overlay de gráfico de líneas con la evolución poblacional.
 *
 * Anclado en la parte inferior del frame del CA, dibuja en vivo el número de
 * células por generación a lo largo de toda la corrida.
 *
 * Diseño:
 *   - Acumula SIEMPRE (suscrito a STATS_UPDATED desde su construcción), aunque
 *     el overlay esté oculto, para garantizar la semántica de "corrida completa"
 *     si se activa más tarde. El push de un número por paso es trivial.
 *   - Solo dibuja cuando es visible.
 *   - Buffer decimante de capacidad fija: cuando se llena, fusiona pares
 *     adyacentes (promedio) y duplica las muestras por punto. Toda la extensión
 *     de la corrida queda representada con memoria acotada y resolución que
 *     degrada suavemente.
 *   - Reinicia la curva al detectar inicio de corrida nueva (generación 0 o
 *     menor que la anterior), cubriendo clear/randomize/import/redimensionado
 *     sin acoplarse a sus internals.
 */
class PopulationChart {
    static CAPACITY = 512;

    constructor() {
        this._canvas = document.getElementById('populationChart');
        this._ctx = this._canvas?.getContext('2d') ?? null;
        this._visible = false;

        // Buffer decimante de puntos finalizados.
        this._values = new Float64Array(PopulationChart.CAPACITY);
        this._count = 0;
        this._samplesPerBucket = 1;
        // Acumulador del bucket en formación.
        this._acc = 0;
        this._accCount = 0;

        this._lastGen = -1;
        this._lastPopulation = 0;

        // Color cacheado (evita getComputedStyle por frame).
        const styles = getComputedStyle(document.documentElement);
        this._color = (styles.getPropertyValue('--primary') || '#22d3ee').trim();
        this._labelColor = (styles.getPropertyValue('--gray-text') || '#9ca3af').trim();

        this._removeListener = eventBus.on(Events.STATS_UPDATED, (stats) => this._onStats(stats));
    }

    _onStats({generation, population}) {
        const gen = generation || 0;
        if (gen === 0 || gen < this._lastGen) this._reset();
        this._lastGen = gen;
        this._lastPopulation = population || 0;

        this._pushSample(this._lastPopulation);
        if (this._visible) this._draw();
    }

    _reset() {
        this._count = 0;
        this._samplesPerBucket = 1;
        this._acc = 0;
        this._accCount = 0;
    }

    _pushSample(v) {
        this._acc += v;
        this._accCount++;
        if (this._accCount < this._samplesPerBucket) return;

        // Bucket completo: finalizar y guardar su promedio.
        this._values[this._count++] = this._acc / this._accCount;
        this._acc = 0;
        this._accCount = 0;

        if (this._count >= PopulationChart.CAPACITY) this._decimate();
    }

    /** Halva la resolución fusionando pares adyacentes; duplica muestras/punto. */
    _decimate() {
        const vals = this._values;
        const half = this._count >> 1;
        for (let i = 0; i < half; i++) {
            vals[i] = (vals[2 * i] + vals[2 * i + 1]) / 2;
        }
        this._count = half;
        this._samplesPerBucket *= 2;
    }

    _draw() {
        const cv = this._canvas, ctx = this._ctx;
        if (!cv || !ctx) return;

        const cssW = cv.clientWidth, cssH = cv.clientHeight;
        if (cssW === 0 || cssH === 0) return; // oculto / sin layout

        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
        if (cv.width !== w || cv.height !== h) {
            cv.width = w;
            cv.height = h;
        }
        ctx.clearRect(0, 0, w, h);

        // Punto provisional del bucket en formación: hace que la curva avance
        // cada generación aunque el bucket aún no se haya finalizado.
        const pending = this._accCount > 0 ? this._acc / this._accCount : 0;
        const n = this._count + (this._accCount > 0 ? 1 : 0);
        if (n === 0) return;

        let max = 0;
        for (let i = 0; i < this._count; i++) if (this._values[i] > max) max = this._values[i];
        if (pending > max) max = pending;
        if (max <= 0) max = 1;

        const padX = 6 * dpr, padTop = 20 * dpr, padBot = 6 * dpr;
        const plotW = w - padX * 2, plotH = h - padTop - padBot;
        const valAt = (i) => (i < this._count ? this._values[i] : pending);
        const xFor = (i) => n === 1 ? padX + plotW / 2 : padX + (i / (n - 1)) * plotW;
        const yFor = (v) => padTop + plotH - (v / max) * plotH;

        // Línea base.
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.moveTo(padX, padTop + plotH);
        ctx.lineTo(w - padX, padTop + plotH);
        ctx.stroke();

        // Curva de población.
        ctx.strokeStyle = this._color;
        ctx.lineWidth = 1.5 * dpr;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const x = xFor(i), y = yFor(valAt(i));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Etiquetas: valor actual y máximo de la ventana.
        ctx.font = `${12 * dpr}px 'Courier New', monospace`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = this._color;
        ctx.textAlign = 'left';
        ctx.fillText(this._lastPopulation.toLocaleString(), padX, 4 * dpr);
        ctx.fillStyle = this._labelColor;
        ctx.textAlign = 'right';
        ctx.fillText(`▲ ${Math.round(max).toLocaleString()}`, w - padX, 4 * dpr);
    }

    show() {
        this._visible = true;
        if (this._canvas) this._canvas.style.display = 'block';
        this._draw();
    }

    hide() {
        this._visible = false;
        if (this._canvas) this._canvas.style.display = 'none';
    }

    destroy() {
        this._removeListener?.();
        this._removeListener = null;
        this._canvas = null;
        this._ctx = null;
        this._values = null;
    }
}

export {PopulationChart};
