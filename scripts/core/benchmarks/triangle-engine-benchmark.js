/**
 * TriangleEngineBenchmark - Sistema de testeo de rendimiento
 *
 * Tests incluidos:
 * 1. Latencia de paso individual (step)
 * 2. Throughput de generaciones por segundo
 * 3. Tiempo de inicialización
 * 4. Comparativa Worker vs Sync
 * 5. Memory profiling
 * 6. FPS durante ejecución continua
 *
 * // Crear instancia
 * const benchmark = new TriangleEngineBenchmark(window.app.automaton);
 *
 * // Test individual
 * await benchmark.testStepLatency({ gridSize: 200, iterations: 100 });
 *
 * // Test comparativo Worker vs Sync
 * await benchmark.testWorkerComparison({ gridSize: 200, iterations: 50 });
 *
 * // Suite completa (~30 segundos)
 * await benchmark.runFullSuite({ gridSize: 200 });
 */

class TriangleEngineBenchmark {
    constructor(automaton) {
        this.automaton = automaton;
        this.results = [];
        this.isRunning = false;
        this._rafId = null;
    }

    /**
     * Método para esperar que worker esté completamente listo
     */
    async _waitForWorkerReady(engine, maxWaitMs = 10000) {
        if (!engine.useWorker) return true;

        const start = performance.now();

        while (performance.now() - start < maxWaitMs) {
            // Enviar ping y esperar respuesta
            const isReady = await new Promise((resolve) => {
                const check = () => {
                    if (engine._workerReady) {
                        resolve(true);
                    } else {
                        setTimeout(check, 10);
                    }
                };

                // Trigger ping
                if (engine.worker) {
                    engine.worker.postMessage({type: 'ping'});
                }

                setTimeout(check, 50);

                // Timeout individual
                setTimeout(() => resolve(false), 1000);
            });

            if (isReady) return true;
        }

        return false;
    }

    /**
     * Setup con warm-up garantizado
     */
    async _setupTriangleMode(gridSize, rule, forceWorker = null) {
        // Desactivar modo anterior
        if (this.automaton.triangleEngine?.isActive) {
            this.automaton.triangleEngine.deactivate();
        }

        // Configurar grid
        this.automaton.resizeGrid(gridSize);

        // Forzar modo worker o sync si se especifica
        if (forceWorker !== null) {
            const engine = this.automaton.triangleEngine;
            if (engine) {
                engine.workerThreshold = forceWorker ? 0 : 9999;
            }
        }

        // Activar modo triangular
        const triangleToggle = document.getElementById('triangleToggle');
        if (triangleToggle) {
            triangleToggle.checked = true;
            triangleToggle.dispatchEvent(new Event('change'));
        }

        // Setear regla
        const ruleInput = document.getElementById('triangleRule');
        if (ruleInput) {
            ruleInput.value = rule;
            ruleInput.dispatchEvent(new Event('input'));
        }

        // Esperar inicialización completa incluyendo worker
        await this._waitForInitialization();

        // Si usa worker, esperar a que esté listo
        const engine = this.automaton.triangleEngine;
        if (engine?.useWorker) {
            const workerReady = await this._waitForWorkerReady(engine);
            if (!workerReady) {
                console.warn('Worker no se inicializó, usando sync');
                engine.useWorker = false;
            }
        }

        // Warm-up adicional - hacer un paso no medido
        await this._safeStep();
        await new Promise(r => setTimeout(r, 100)); // Dejar que se asiente
    }

    async _waitForInitialization() {
        await new Promise(resolve => {
            const check = () => {
                if (this.automaton.triangleEngine?.initialized) {
                    resolve();
                } else {
                    setTimeout(check, 10);
                }
            };
            check();
        });
    }

    async _safeStep() {
        return new Promise((resolve) => {
            const engine = this.automaton.triangleEngine;
            if (!engine?.isActive) {
                resolve(false);
                return;
            }

            if (engine.useWorker) {
                const check = () => {
                    if (!engine.isWorkerProcessing) {
                        resolve(true);
                    } else {
                        setTimeout(check, 1);
                    }
                };

                engine.step();
                check();
            } else {
                engine.step();
                setTimeout(() => resolve(true), 0);
            }
        });
    }

    /**
     * Test 1: Latencia de paso individual - CON WARM-UP CORREGIDO
     */
    async testStepLatency(options = {}) {
        const {
            gridSize = 200,
            rule = 50,
            iterations = 100,
            warmup = 10
        } = options;

        console.log(`🔺 Test Latencia - Grid: ${gridSize}x${gridSize}, Rule: ${rule}`);

        // Setup con warm-up completo
        await this._setupTriangleMode(gridSize, rule);

        // Warmup adicional
        console.log(`  Warm-up: ${warmup} pasos...`);
        for (let i = 0; i < warmup; i++) {
            await this._safeStep();
        }

        // Medición
        console.log(`  Midiendo: ${iterations} pasos...`);
        const times = [];
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await this._safeStep();
            const duration = performance.now() - start;
            times.push(duration);

            // Loggear si hay anomalías durante la medición
            if (duration > 100) {
                console.warn(`    Paso ${i}: ${duration.toFixed(2)}ms (ANOMALÍA)`);
            }
        }

        const stats = this._calculateStats(times);

        console.log(`  Media: ${stats.mean.toFixed(2)}ms`);
        console.log(`  P50: ${stats.p50.toFixed(2)}ms`);
        console.log(`  P95: ${stats.p95.toFixed(2)}ms`);
        console.log(`  P99: ${stats.p99.toFixed(2)}ms`);
        console.log(`  Min/Max: ${stats.min.toFixed(2)}ms / ${stats.max.toFixed(2)}ms`);
        console.log(`  Desv. Est.: ${stats.std.toFixed(2)}ms`);

        // Alerta si hay alta variabilidad
        if (stats.std > stats.mean * 2) {
            console.warn(`  ⚠️ ALTA VARIABILIDAD - Revisar inicialización del worker`);
        }

        return {
            test: 'step-latency',
            gridSize,
            rule,
            iterations,
            ...stats,
            raw: times
        };
    }

    /**
     * Test 3: Comparativa Worker vs Sync - CON AISLAMIENTO CORRECTO
     */
    async testWorkerComparison(options = {}) {
        const {
            gridSize = 200,
            rule = 50,
            iterations = 30
        } = options;

        console.log(`🔺 Test Worker vs Sync - Grid: ${gridSize}x${gridSize}`);

        const results = {
            worker: null,
            sync: null
        };

        // Test con Worker - FORZADO y con warm-up completo
        console.log('  Modo: Worker...');
        await this._setupTriangleMode(gridSize, rule, true); // forceWorker = true

        const workerTimes = [];
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await this._safeStep();
            workerTimes.push(performance.now() - start);
        }
        results.worker = this._calculateStats(workerTimes);

        // PAUSA entre tests para limpieza
        await new Promise(r => setTimeout(r, 500));

        // Test Síncrono - FORZADO y con warm-up completo
        console.log('  Modo: Sync...');
        await this._setupTriangleMode(gridSize, rule, false); // forceWorker = false

        const syncTimes = [];
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await this._safeStep();
            syncTimes.push(performance.now() - start);
        }
        results.sync = this._calculateStats(syncTimes);

        // Comparativa
        const speedup = results.sync.mean / results.worker.mean;
        const uiBlockingSync = syncTimes.filter(t => t > 16).length;
        const uiBlockingWorker = workerTimes.filter(t => t > 16).length;

        console.log(`  Worker - Media: ${results.worker.mean.toFixed(2)}ms`);
        console.log(`  Sync   - Media: ${results.sync.mean.toFixed(2)}ms`);
        console.log(`  Speedup: ${speedup.toFixed(2)}x`);
        console.log(`  Frames bloqueados (>16ms) - Sync: ${uiBlockingSync}, Worker: ${uiBlockingWorker}`);

        return {
            test: 'worker-comparison',
            gridSize,
            rule,
            iterations,
            worker: results.worker,
            sync: results.sync,
            speedup,
            uiBlocking: {sync: uiBlockingSync, worker: uiBlockingWorker}
        };
    }

    // ... resto de tests sin cambios ...

    async testThroughput(options = {}) {
        const {
            gridSize = 200,
            rule = 50,
            durationMs = 5000
        } = options;

        console.log(`🔺 Test Throughput - Grid: ${gridSize}x${gridSize}, Duración: ${durationMs}ms`);

        await this._setupTriangleMode(gridSize, rule);

        let generations = 0;
        const start = performance.now();

        while (performance.now() - start < durationMs) {
            await this._safeStep();
            generations++;
        }

        const actualDuration = performance.now() - start;
        const gensPerSecond = (generations / actualDuration) * 1000;

        console.log(`  Generaciones: ${generations}`);
        console.log(`  Tiempo real: ${actualDuration.toFixed(2)}ms`);
        console.log(`  Gen/segundo: ${gensPerSecond.toFixed(2)}`);

        return {
            test: 'throughput',
            gridSize,
            rule,
            durationMs: actualDuration,
            generations,
            gensPerSecond
        };
    }

    async testScalability(options = {}) {
        const {
            gridSizes = [50, 100, 150, 200, 300, 400],
            rule = 50,
            iterations = 30
        } = options;

        console.log(`🔺 Test Escalabilidad - Grids: ${gridSizes.join(', ')}`);

        const results = [];

        for (const gridSize of gridSizes) {
            const result = await this.testStepLatency({
                gridSize,
                rule,
                iterations,
                warmup: 5
            });
            results.push(result);
        }

        console.log('\n  Análisis de complejidad:');
        for (let i = 1; i < results.length; i++) {
            const prev = results[i - 1];
            const curr = results[i];
            const sizeRatio = (curr.gridSize / prev.gridSize) ** 2;
            const timeRatio = curr.mean / prev.mean;

            console.log(`  ${prev.gridSize}→${curr.gridSize}: ${timeRatio.toFixed(2)}x tiempo (esperado: ${sizeRatio.toFixed(2)}x para O(n²))`);
        }

        return {
            test: 'scalability',
            rule,
            results
        };
    }

    async testFPS(options = {}) {
        const {
            gridSize = 200,
            rule = 50,
            durationMs = 3000
        } = options;

        console.log(`🔺 Test FPS - Grid: ${gridSize}x${gridSize}, Duración: ${durationMs}ms`);

        await this._setupTriangleMode(gridSize, rule);

        let frames = 0;
        let frameTimes = [];
        let lastFrame = performance.now();

        const start = performance.now();

        return new Promise((resolve) => {
            const measureFrame = () => {
                const now = performance.now();
                const delta = now - lastFrame;
                lastFrame = now;

                frames++;
                frameTimes.push(delta);

                if (now - start < durationMs) {
                    this._rafId = requestAnimationFrame(measureFrame);
                } else {
                    const actualDuration = now - start;
                    const fps = (frames / actualDuration) * 1000;
                    const stats = this._calculateStats(frameTimes);

                    console.log(`  Frames renderizados: ${frames}`);
                    console.log(`  FPS promedio: ${fps.toFixed(2)}`);
                    console.log(`  Frame time - Media: ${stats.mean.toFixed(2)}ms, P95: ${stats.p95.toFixed(2)}ms`);

                    resolve({
                        test: 'fps',
                        gridSize,
                        rule,
                        durationMs: actualDuration,
                        frames,
                        fps,
                        frameTime: stats
                    });
                }
            };

            this.automaton.start();
            measureFrame();

            setTimeout(() => {
                this.automaton.stop();
                cancelAnimationFrame(this._rafId);
            }, durationMs + 100);
        });
    }

    async testMemory(options = {}) {
        const {
            gridSize = 200,
            rule = 50,
            steps = 100
        } = options;

        console.log(`🔺 Test Memory - Grid: ${gridSize}x${gridSize}, Steps: ${steps}`);

        if (performance.memory) {
            const memBefore = performance.memory.usedJSHeapSize;

            await this._setupTriangleMode(gridSize, rule);

            for (let i = 0; i < steps; i++) {
                await this._safeStep();
            }

            if (window.gc) {
                window.gc();
                await new Promise(r => setTimeout(r, 100));
            }

            const memAfter = performance.memory.usedJSHeapSize;
            const memDelta = memAfter - memBefore;

            console.log(`  Memoria antes: ${this._formatBytes(memBefore)}`);
            console.log(`  Memoria después: ${this._formatBytes(memAfter)}`);
            console.log(`  Delta: ${this._formatBytes(memDelta)}`);
            console.log(`  Por paso: ${this._formatBytes(memDelta / steps)}`);

            return {
                test: 'memory',
                gridSize,
                rule,
                steps,
                memoryBefore: memBefore,
                memoryAfter: memAfter,
                memoryDelta: memDelta,
                memoryPerStep: memDelta / steps
            };
        } else {
            console.log('  ⚠️ performance.memory no disponible en este navegador');
            return {test: 'memory', error: 'Not available'};
        }
    }

    _calculateStats(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const n = sorted.length;
        const sum = sorted.reduce((a, b) => a + b, 0);

        return {
            mean: sum / n,
            min: sorted[0],
            max: sorted[n - 1],
            p50: sorted[Math.floor(n * 0.5)],
            p95: sorted[Math.floor(n * 0.95)],
            p99: sorted[Math.floor(n * 0.99)],
            std: Math.sqrt(sorted.reduce((sq, n) => sq + Math.pow(n - sum / sorted.length, 2), 0) / n)
        };
    }

    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async runFullSuite(options = {}) {
        const {
            gridSize = 200,
            rule = 50
        } = options;

        console.log('╔════════════════════════════════════════════════════════╗');
        console.log('║     TRIANGLE ENGINE BENCHMARK - SUITE COMPLETA         ║');
        console.log('╚════════════════════════════════════════════════════════╝');

        const results = [];
        const startTime = performance.now();

        results.push(await this.testStepLatency({gridSize, rule, iterations: 50}));
        results.push(await this.testThroughput({gridSize, rule, durationMs: 3000}));

        if (gridSize >= 100) {
            results.push(await this.testWorkerComparison({gridSize, rule, iterations: 30}));
        }

        results.push(await this.testScalability({
            gridSizes: [50, 100, 150, 200],
            rule,
            iterations: 20
        }));

        results.push(await this.testFPS({gridSize, rule, durationMs: 2000}));
        results.push(await this.testMemory({gridSize, rule, steps: 50}));

        const totalTime = performance.now() - startTime;

        console.log('\n╔════════════════════════════════════════════════════════╗');
        console.log(`║  SUITE COMPLETADA EN ${totalTime.toFixed(0)}ms                          ║`);
        console.log('╚════════════════════════════════════════════════════════╝');

        this._generateReport(results);

        return results;
    }

    _generateReport(results) {
        const report = {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            results: results
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `triangle-benchmark-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        console.log('📊 Reporte descargado como JSON');
    }
}

window.TriangleEngineBenchmark = TriangleEngineBenchmark;