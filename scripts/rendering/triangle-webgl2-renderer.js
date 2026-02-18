/**
 * TriangleWebGL2Renderer - Renderizador WebGL2 para autómata triangular
 *
 * 1. Detección robusta de WebGL2 con múltiples intentos
 * 2. Verificación de extensiones críticas
 * 3. Mejor manejo de errores en creación de contexto
 * 4. Fallback inmediato sin logs de error si no hay WebGL2
 */

class TriangleWebGL2Renderer {
    constructor(options) {
        this.canvas = options.canvas;
        this.container = options.container;
        this.cellSize = options.cellSize || 20;
        this.showGrid = options.showGrid !== false;

        // Colores
        this.colorAlive = options.colorAlive || '#ec4899';
        this.colorDead = options.colorDead || '#0f172a';
        this.colorGrid = options.colorGrid || 'rgba(255,255,255,0.1)';

        // Grid manager (referencia, no propiedad)
        this.gridManager = null;

        // Estado interno
        this._dirtyCells = new Set();
        this._isFirstRender = true;
        this._useFallback = false;
        this._fallbackRenderer = null;

        // WebGL2 context
        this.gl = null;
        this.program = null;
        this.vao = null;
        this.positionBuffer = null;
        this.instanceBuffer = null;

        // Uniform locations
        this.uResolution = null;
        this.uCellSize = null;
        this.uGridSize = null;
        this.uShowGrid = null;
        this.uColorAlive = null;
        this.uColorDead = null;
        this.uColorGrid = null;

        // Stats
        this._lastFrameTime = 0;
        this._frameCount = 0;

        // Inicializar WebGL2 con detección robusta
        const webgl2Available = this._initWebGL2Robust();

        if (!webgl2Available) {
            this._useFallback = true;
            console.debug('TriangleWebGL2Renderer: Usando fallback Canvas2D');
        }

        // === OPTIMIZACIÓN: Buffer persistente y dirty regions ===
        this._instanceBufferCPU = null;
        this._bufferCapacity = 0;
        this._needsFullUpload = true;
        this._aliveCellCount = 0;
        this._lastAliveCount = 0;
        this._aliveIndices = new Int32Array(400 * 400);
        this._aliveIndicesFill = 0;
    }

    /**
     * Detección robusta de WebGL2 con múltiples intentos y configuraciones
     */
    _initWebGL2Robust() {
        if (!this.canvas) {
            console.warn('TriangleWebGL2Renderer: Canvas no proporcionado');
            return false;
        }

        // Intentar múltiples configuraciones de contexto
        const contextConfigs = [
            {alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false},
            {alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true},
            {alpha: true, antialias: false, depth: false, stencil: false},
            {alpha: false, antialias: true, depth: false, stencil: false},
        ];

        let gl = null;

        for (const config of contextConfigs) {
            try {
                gl = this.canvas.getContext('webgl2', config);
                if (gl) break;
            } catch (e) {
                // Continuar con siguiente configuración
            }
        }

        // Si aún no hay contexto, intentar sin opciones
        if (!gl) {
            try {
                gl = this.canvas.getContext('webgl2');
            } catch (e) {
                // Fallo final
            }
        }

        if (!gl) {
            return false;
        }

        // Verificar que es realmente WebGL2 (no WebGL1 con extensiones)
        if (!(gl instanceof WebGL2RenderingContext)) {
            // Algunos navegadores pueden engañar, verificar por capacidades
            if (!gl.drawArraysInstanced) {
                return false;
            }
        }

        // Verificar extensiones críticas para instancing
        // En WebGL2, instancing el core, pero verificamos por si acaso
        const hasInstancing = gl.drawArraysInstanced !== undefined;
        const hasVAO = gl.createVertexArray !== undefined;

        if (!hasInstancing || !hasVAO) {
            console.warn('TriangleWebGL2Renderer: WebGL2 no soporta instancing/VAO');
            return false;
        }

        // Verificar capacidad de texturas (para futuras expansiones)
        const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (maxTextureSize < 2048) {
            console.warn(`TriangleWebGL2Renderer: MAX_TEXTURE_SIZE ${maxTextureSize} muy pequeño`);
            // No retornamos false, puede funcionar para grids pequeños
        }

        this.gl = gl;

        // Compilar shaders
        const shadersOk = this._initShaders();
        if (!shadersOk) {
            this.gl = null;
            return false;
        }

        // Crear geometría instanciada
        const geometryOk = this._initGeometry();
        if (!geometryOk) {
            this.gl = null;
            return false;
        }

        console.debug('✅ TriangleWebGL2Renderer: WebGL2 inicializado correctamente');
        return true;
    }

    /**
     * Shaders GLSL 3.0 ES
     */
    _initShaders() {
        const gl = this.gl;

        // Vertex Shader: Transforma instancias de triángulos
        const vsSource = `#version 300 es
        precision highp float;

        // Atributos por vértice (triángulo base)
        in vec2 a_position;  // Vértices del triángulo base (0,0), (1,0), (0.5, h)

        // Atributos por instancia (una por celda)
        in vec2 a_gridPos;   // Posición (q, r) en el grid
        in float a_state;    // 0.0 = muerta, 1.0 = viva
        in float a_orientation; // 0.0 = up, 1.0 = down

        // Uniforms
        uniform vec2 u_resolution;  // Tamaño del canvas
        uniform float u_cellSize;   // Tamaño de celda
        uniform vec2 u_gridSize;    // width, height del grid
        uniform float u_showGrid;   // 0.0 o 1.0

        // Output a fragment shader
        flat out float v_state;
        out vec2 v_uv;
        out float v_orientation;

        void main() {
            v_state = a_state;
            v_orientation = a_orientation;
            v_uv = a_position;

            // Calcular posición cartesiana
            float h = sqrt(3.0) / 2.0;
            float x = a_gridPos.x * 0.5 + a_position.x;
            float y = a_gridPos.y * h + a_position.y;

            // Flip para orientación down
            if (a_orientation > 0.5) {
                y = (a_gridPos.y + 1.0) * h - a_position.y;
            }

            // Escalar por cellSize
            vec2 pos = vec2(x, y) * u_cellSize;

            // Convertir a clip space (-1 a 1)
            vec2 clipPos = (pos / u_resolution) * 2.0 - 1.0;
            clipPos.y = -clipPos.y;  // Flip Y para canvas

            gl_Position = vec4(clipPos, 0.0, 1.0);
        }
        `;

        // Fragment Shader: Colorea según estado
        const fsSource = `#version 300 es
        precision highp float;

        flat in float v_state;
        in vec2 v_uv;
        in float v_orientation;

        uniform vec3 u_colorAlive;
        uniform vec3 u_colorDead;
        uniform vec3 u_colorGrid;
        uniform float u_showGrid;
        uniform float u_cellSize;

        out vec4 outColor;

        void main() {
            // Color base según estado
            vec3 color = mix(u_colorDead, u_colorAlive, v_state);

            // Grid lines (opcional)
            if (u_showGrid > 0.5 && v_state < 0.5) {
                // Bordes del triángulo
                float edge = 0.02;
                float d = min(min(v_uv.x, v_uv.y), 1.0 - v_uv.x - v_uv.y);
                if (d < edge) {
                    color = mix(color, u_colorGrid, 0.5);
                }
            }

            outColor = vec4(color, 1.0);
        }
        `;

        try {
            const vs = this._compileShader(gl.VERTEX_SHADER, vsSource);
            const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSource);

            if (!vs || !fs) {
                return false;
            }

            this.program = gl.createProgram();
            gl.attachShader(this.program, vs);
            gl.attachShader(this.program, fs);
            gl.linkProgram(this.program);

            if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
                console.error('WebGL2 Program link error:', gl.getProgramInfoLog(this.program));
                return false;
            }

            // Get attribute locations
            this.aPosition = gl.getAttribLocation(this.program, 'a_position');
            this.aGridPos = gl.getAttribLocation(this.program, 'a_gridPos');
            this.aState = gl.getAttribLocation(this.program, 'a_state');
            this.aOrientation = gl.getAttribLocation(this.program, 'a_orientation');

            // Get uniform locations
            this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
            this.uCellSize = gl.getUniformLocation(this.program, 'u_cellSize');
            this.uGridSize = gl.getUniformLocation(this.program, 'u_gridSize');
            this.uShowGrid = gl.getUniformLocation(this.program, 'u_showGrid');
            this.uColorAlive = gl.getUniformLocation(this.program, 'u_colorAlive');
            this.uColorDead = gl.getUniformLocation(this.program, 'u_colorDead');
            this.uColorGrid = gl.getUniformLocation(this.program, 'u_colorGrid');

            return true;
        } catch (e) {
            console.error('Error inicializando shaders WebGL2:', e);
            return false;
        }
    }

    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('WebGL2 Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    /**
     * Inicializa geometría: un triángulo equilátero base instanciado
     */
    _initGeometry() {
        try {
            const gl = this.gl;
            const h = Math.sqrt(3) / 2;

            // Triángulo base pointing up
            const vertices = new Float32Array([
                0.0, 0.0,   // bottom-left
                1.0, 0.0,   // bottom-right
                0.5, h      // top
            ]);

            // Buffer de vértices base
            this.positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

            // VAO
            this.vao = gl.createVertexArray();
            gl.bindVertexArray(this.vao);

            // Atributo de posición base (no instanciado)
            gl.enableVertexAttribArray(this.aPosition);
            gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(this.aPosition, 0);

            // Buffer de instancias (dinámico, se actualiza cada frame)
            this.instanceBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
            // Pre-allocar para grid máximo 400x400 = 160k celdas
            const maxInstances = 400 * 400;
            gl.bufferData(gl.ARRAY_BUFFER, maxInstances * 4 * 4, gl.DYNAMIC_DRAW);

            // a_gridPos (2 floats)
            gl.enableVertexAttribArray(this.aGridPos);
            gl.vertexAttribPointer(this.aGridPos, 2, gl.FLOAT, false, 16, 0);
            gl.vertexAttribDivisor(this.aGridPos, 1);

            // a_state (1 float)
            gl.enableVertexAttribArray(this.aState);
            gl.vertexAttribPointer(this.aState, 1, gl.FLOAT, false, 16, 8);
            gl.vertexAttribDivisor(this.aState, 1);

            // a_orientation (1 float)
            gl.enableVertexAttribArray(this.aOrientation);
            gl.vertexAttribPointer(this.aOrientation, 1, gl.FLOAT, false, 16, 12);
            gl.vertexAttribDivisor(this.aOrientation, 1);

            gl.bindVertexArray(null);
            return true;
        } catch (e) {
            console.error('Error inicializando geometría WebGL2:', e);
            return false;
        }
    }

    /**
     * Convierte color hex a RGB normalizado
     */
    _hexToRGB(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b];
    }

    /**
     * API pública: Asignar gridManager
     */
    setGridManager(gridManager) {
        this.gridManager = gridManager;

        // Sincronizar fallback si existe
        if (this._fallbackRenderer) {
            this._fallbackRenderer.setGridManager(gridManager);
        }

        this._resizeCanvas();
        this._isFirstRender = true;
        this.markAllDirty();
    }

    /**
     * Redimensiona canvas manteniendo aspect ratio triangular
     */
    resize(gridSize, cellSize) {
        this.cellSize = Math.max(3, Math.min(8, cellSize || this.cellSize));

        if (this.gridManager) {
            this._resizeCanvas();
            this._isFirstRender = true;
            this.markAllDirty();
        }
    }

    _resizeCanvas() {
        if (!this.gridManager || !this.canvas) return;

        const h = Math.sqrt(3) / 2;
        const width = (this.gridManager.width - 1) * 0.5 + 1;
        const height = this.gridManager.height * h;

        const canvasWidth = Math.ceil(width * this.cellSize);
        const canvasHeight = Math.ceil(height * this.cellSize);

        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        this.canvas.style.width = canvasWidth + 'px';
        this.canvas.style.height = canvasHeight + 'px';

        if (this.container) {
            this.container.style.width = (canvasWidth + 20) + 'px';
            this.container.style.height = (canvasHeight + 20) + 'px';
        }

        // Viewport WebGL
        if (this.gl) {
            this.gl.viewport(0, 0, canvasWidth, canvasHeight);
        }
    }

    /**
     * Actualiza buffer de instancias desde el gridManager
     */
    _updateInstanceBuffer() {
        const gl = this.gl;
        const gm = this.gridManager;
        const width = gm.width;
        const height = gm.height;

        // Contar y registrar celdas vivas
        let aliveCount = 0;
        for (let r = 0; r < height; r++) {
            for (let q = 0; q < width; q++) {
                if (gm.grid[q][r]) {
                    this._aliveIndices[aliveCount++] = (r * width + q);
                }
            }
        }
        this._aliveCellCount = aliveCount;

        if (aliveCount === 0) return;

        const requiredBytes = aliveCount * 4 * 4;
        if (!this._instanceBufferCPU || this._bufferCapacity < requiredBytes) {
            this._instanceBufferCPU = new ArrayBuffer(Math.max(requiredBytes * 2, 1024 * 1024));
            this._bufferCapacity = this._instanceBufferCPU.byteLength;
            this._needsFullUpload = true;
        }

        const instances = new Float32Array(this._instanceBufferCPU, 0, aliveCount * 4);
        let idx = 0;

        for (let i = 0; i < aliveCount; i++) {
            const flatIdx = this._aliveIndices[i];
            const r = (flatIdx / width) | 0;  // Math.floor optimizado
            const q = flatIdx % width;

            instances[idx++] = q;
            instances[idx++] = r;
            instances[idx++] = 1.0;
            instances[idx++] = ((q + r) & 1);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);

        if (this._needsFullUpload) {
            gl.bufferData(gl.ARRAY_BUFFER, this._bufferCapacity, gl.DYNAMIC_DRAW);
            this._needsFullUpload = false;
        }

        gl.bufferSubData(gl.ARRAY_BUFFER, 0,
            new Float32Array(this._instanceBufferCPU, 0, aliveCount * 4));
        this._lastAliveCount = aliveCount;
    }

    render(options = {}) {
        if (!this.gridManager) return;

        if (this._useFallback) {
            if (!this._fallbackRenderer) {
                this._fallbackRenderer = new TriangleRenderer({
                    canvas: this.canvas, container: this.container,
                    cellSize: this.cellSize, showGrid: this.showGrid,
                    colorAlive: this.colorAlive, colorDead: this.colorDead,
                    colorGrid: this.colorGrid
                });
                this._fallbackRenderer.setGridManager(this.gridManager);
            }
            this._fallbackRenderer.render(options);
            return;
        }

        const gl = this.gl;
        this._updateInstanceBuffer();

        if (this._aliveCellCount === 0) {
            gl.clearColor(0.059, 0.09, 0.165, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }

        gl.clearColor(0.059, 0.09, 0.165, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uCellSize, this.cellSize);
        gl.uniform2f(this.uGridSize, this.gridManager.width, this.gridManager.height);
        gl.uniform1f(this.uShowGrid, this.showGrid ? 1.0 : 0.0);

        const alive = this._hexToRGB(this.colorAlive);
        const dead = this._hexToRGB(this.colorDead);
        const grid = this._hexToRGB(this.colorGrid);
        gl.uniform3f(this.uColorAlive, alive[0], alive[1], alive[2]);
        gl.uniform3f(this.uColorDead, dead[0], dead[1], dead[2]);
        gl.uniform3f(this.uColorGrid, grid[0], grid[1], grid[2]);

        gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, this._aliveCellCount);
        gl.bindVertexArray(null);
    }

    // =========================================
    // API compatible con TriangleRenderer
    // =========================================

    markDirty(q, r) {
        if (!this.gridManager) return;
        if (q >= 0 && q < this.gridManager.width && r >= 0 && r < this.gridManager.height) {
            this._dirtyCells.add((q << 16) | r);
        }
    }

    markAllDirty() {
        if (!this.gridManager) return;
        this._isFirstRender = true;
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this._isFirstRender = true;
        this.markAllDirty();
        return this.showGrid;
    }

    getCellFromMouse(clientX, clientY) {
        if (!this.gridManager) return null;

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        return this.gridManager.fromCartesian(x, y, this.cellSize);
    }

    updateActivityAges(changedCells) {
        // No-op en WebGL2 - los shaders son instantáneos
    }

    resetActivity() {
        this._isFirstRender = true;
        this.markAllDirty();
    }

    getConfig(key) {
        if (key === 'showGrid') return this.showGrid;
        if (key === 'showActivityEffect') return false;
        return undefined;
    }

    setConfig(key, value) {
        if (key === 'showGrid') {
            this.showGrid = value;
            this._isFirstRender = true;
            this.markAllDirty();
        }
    }

    destroy() {
        if (this._fallbackRenderer) {
            this._fallbackRenderer.destroy();
            this._fallbackRenderer = null;
        }

        if (this.gl) {
            this.gl.deleteBuffer(this.positionBuffer);
            this.gl.deleteBuffer(this.instanceBuffer);
            this.gl.deleteVertexArray(this.vao);
            this.gl.deleteProgram(this.program);
        }
        this.gridManager = null;
        this._dirtyCells.clear();
    }
}

window.TriangleWebGL2Renderer = TriangleWebGL2Renderer;