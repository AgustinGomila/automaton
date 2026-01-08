# Autómata Celular Interactivo

Una implementación interactiva de autómata celular con soporte para **múltiples reglas**, incluyendo **B37/S4567** de
Louis Kauffman y otras configuraciones clásicas.

## 🎯 Experimentar con el Autómata

**[Experimentar →](https://agustingomila.github.io/automaton/)**

## 📖 Características

### Reglas Disponibles

- **Kauffman B37/S4567** - Regla original presentada por Louis Kauffman
- **Conway's Life B3/S23** - El autómata celular más famoso
- **HighLife B36/S23** - Variación con replicador
- **Day & Night B3678/S34678** - Simétrico con comportamiento interesante
- **30+ reglas predefinidas** más
- **Regla personalizada** - Define tus propios parámetros B/S

### Funcionalidades

- **Selector de vecindad**: Moore (8 vecinos) o von Neumann (4 vecinos)
- **Radio configurable**: Controla la distancia de influencia (1-10)
- **Patrones predefinidos**: 20 patrones iniciales + aleatorio
- **Rotación de patrones**: Gira los patrones 90° con clic derecho
- **Límites configurables**: Establece límites por generaciones o población
- **Interacción completa**: Dibuja, coloca patrones, exporta/importa
- **Diseño responsivo**: Funciona en móviles y escritorio

## 🎮 Uso Interactivo

### Controles Principales

- **▶ Ejecutar/Pausar**: Inicia o detiene la simulación automática
- **⏭ Paso**: Avanza una generación manualmente
- **🎲 Aleatorio**: Genera un patrón inicial aleatorio
- **↻ Limpiar**: Borra toda la cuadrícula
- **⚙ Configuración**: Ajusta reglas, vecindad, límites y más

### Interacción

- **Clic izquierdo**: Dibuja células individuales o coloca patrón seleccionado
- **Clic derecho**: Rota el patrón seleccionado 90°
- **Arrastrar**: Dibuja libremente mientras arrastras
- **Escape**: Cancela la selección de patrón

## 🧠 Contexto Teórico

### Louis Kauffman

El autómata incluye la regla **B37/S4567** presentada por Louis Kauffman, matemático conocido por su trabajo en:

- **Teoría de nudos**
- **Cálculo de formas** (Laws of Form)
- **Sistemas autoorganizados**
- **Cibernética de segundo orden**

### Reglas Clásicas

Además de Kauffman, el simulador incluye autómatas celulares clásicos:

- **Conway's Game of Life** - El más famoso
- **Seeds, Mazes, Amoeba** - Variaciones con comportamientos únicos
- **HighLife, Day & Night** - Autómatas bien estudiados

## 💻 Instalación Local

### Opción 1: Ejecutar directamente

Simplemente abre `index.html` en tu navegador. No requiere servidor web.

### Opción 2: Servidor local

```bash
# Con Python 3
python -m http.server 8000

# Con Node.js (npx)
npx serve

# Luego abre http://localhost:8000
```

## 📚 Referencias

- **Louis Kauffman**: [Página personal](http://www.math.uic.edu/~kauffman/)
- **Conway's Game of Life**: [Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
- **Reglas de autómatas**: [LifeWiki](https://conwaylife.com/wiki/)
- **Teoría de Autómatas Celulares**: Stephen Wolfram - *A New Kind of Science*

---

**Explora la emergencia de patrones complejos a partir de reglas simples.**

*"Toda distinción crea una frontera, y toda frontera procesa información." - Louis Kauffman*