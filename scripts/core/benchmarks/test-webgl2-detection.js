/**
 * Test de detección WebGL2 - Ejecutar en consola del navegador
 * para diagnosticar por qué falla la detección
 */

function testWebGL2() {
    console.log('=== Test de WebGL2 ===');

    // 1. Verificar si existe la API
    console.log('1. WebGL2RenderingContext existe:', typeof WebGL2RenderingContext !== 'undefined');

    // 2. Crear canvas de prueba
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;

    // 3. Intentar obtener contexto con diferentes configuraciones
    const configs = [
        {alpha: false, antialias: false, depth: false, stencil: false},
        {alpha: false, antialias: false},
        {alpha: false},
        {},
        null
    ];

    let gl = null;
    let workingConfig = null;

    for (const config of configs) {
        try {
            const testGl = canvas.getContext('webgl2', config);
            if (testGl) {
                gl = testGl;
                workingConfig = config;
                console.log('2. Contexto WebGL2 creado con config:', config);
                break;
            }
        } catch (e) {
            console.log('   Fallo con config:', config, '- Error:', e.message);
        }
    }

    if (!gl) {
        console.error('❌ No se pudo crear contexto WebGL2 con ninguna configuración');

        // Verificar si hay WebGL1
        const gl1 = canvas.getContext('webgl');
        console.log('3. WebGL1 disponible:', gl1 ? 'Sí' : 'No');

        return false;
    }

    // 4. Verificar capacidades
    console.log('4. Capacidades WebGL2:');
    console.log('   - drawArraysInstanced:', typeof gl.drawArraysInstanced === 'function');
    console.log('   - createVertexArray:', typeof gl.createVertexArray === 'function');
    console.log('   - MAX_TEXTURE_SIZE:', gl.getParameter(gl.MAX_TEXTURE_SIZE));
    console.log('   - MAX_VERTEX_ATTRIBS:', gl.getParameter(gl.MAX_VERTEX_ATTRIBS));
    console.log('   - MAX_UNIFORM_BUFFER_BINDINGS:', gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS));

    // 5. Verificar extensiones
    const ext = gl.getExtension('EXT_color_buffer_float');
    console.log('5. EXT_color_buffer_float:', ext ? 'Disponible' : 'No disponible');

    console.log('✅ WebGL2 está disponible y funcional');
    return true;
}

// Ejecutar test
testWebGL2();