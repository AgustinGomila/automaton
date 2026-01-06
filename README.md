# Autómata Celular de Kauffman B37/S4567

Una implementación interactiva del autómata celular con reglas **B37/S4567** presentado por Louis Kauffman en sus
conferencias sobre teoría de distinciones y sistemas autoorganizados.

## 🎯 Experimentar con el Autómata

**[Experimentar →](https://agustingomila.github.io/automaton/)**

## 📖 ¿Qué es este autómata?

Este autómata celular sigue reglas específicas que difieren del famoso "Juego de la Vida" de Conway:

### Reglas (Notación B37/S4567)

- **B37 (Birth)**: Una célula muerta **nace** si tiene exactamente **3 o 7** vecinos vivos
- **S4567 (Survival)**: Una célula viva **sobrevive** si tiene **4, 5, 6 o 7** vecinos vivos

### Comparación con el Juego de la Vida

| Autómata               | Reglas    |
|------------------------|-----------|
| **Conway's Life**      | B3/S23    |
| **Kauffman B37/S4567** | B37/S4567 |

## 🚀 Uso

<img src="images/automaton_low.gif" alt="automaton" style="width:500px; height:auto; display:block; margin:0 auto;" />

### Controles

- **▶ Ejecutar/Pausar**: Inicia o detiene la simulación automática
- **⏭ Paso**: Avanza una generación manualmente
- **🎲 Aleatorio**: Genera un patrón inicial aleatorio
- **↻ Limpiar**: Borra toda la cuadrícula

### Interacción

- **Clic**: Alterna el estado de una célula individual
- **Arrastrar**: Dibuja patrones arrastrando el mouse

## 🧬 Contexto Teórico

### Louis Kauffman

Louis Kauffman es un matemático conocido por su trabajo en:

- **Teoría de nudos**
- **Cálculo de formas** (Laws of Form)
- **Sistemas autoorganizados**
- **Cibernética de segundo orden**

## 🔬 Experimentación

### Modificar las Reglas

Puedes experimentar con diferentes reglas editando la función `nextGeneration()`:

```javascript
// Ejemplo: Conway's Life (B3/S23)
if (isAlive) {
    newGrid[x][y] = [2, 3].includes(neighbors);
} else {
    newGrid[x][y] = neighbors === 3;
}
```

### Ajustar Parámetros

```javascript
const GRID_SIZE = 80;         // Cuadrícula más grande
const CELL_SIZE = 6;          // Células más pequeñas
const UPDATE_INTERVAL = 50;   // Más rápido
```

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
- **Laws of Form**: George Spencer-Brown
- **Teoría de Autómatas Celulares**: Stephen Wolfram - *A New Kind of Science*
- **Vecindario de Moore**: [Wikipedia](https://en.wikipedia.org/wiki/Moore_neighborhood)

---

**Desarrollado con curiosidad sobre sistemas autoorganizados y teoría de distinciones.**

*"Toda distinción crea una frontera, y toda frontera procesa información."*