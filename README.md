# Autómata Celular Interactivo

Una implementación interactiva de autómata celular con soporte para **múltiples reglas**, **autómatas de Wolfram 1D** y
**Distinción Recursiva 2D**.

## 🎯 Experimentar con el Autómata

**[Experimentar →](https://agustingomila.github.io/automaton/)**

## 📖 Características

### Reglas Disponibles

- **Kauffman B37/S4567** - Regla presentada por Louis Kauffman
- **Conway's Life B3/S23** - El autómata celular más famoso
- **HighLife B36/S23** - Variación con replicador
- **Day & Night B3678/S34678** - Simétrico con comportamiento interesante
- **30+ reglas predefinidas** más
- **Regla personalizada** - Define tus propios parámetros B/S

### Autómatas Especiales

- **Wolfram 1D** - Autómatas elementales unidimensionales (reglas 0-255) con evolución vertical u horizontal
- **RD-2D** - Distinción Recursiva 2D con 16 estados basados en fronteras [N,S,E,W] y regla XOR

### Funcionalidades

- **Selector de vecindad**: Moore (8 vecinos) o von Neumann (4 vecinos)
- **Radio configurable**: Controla la distancia de influencia (1-10)
- **Patrones predefinidos**: 20 patrones iniciales + aleatorio
- **Rotación de patrones**: Gira los patrones 90° con clic derecho
- **Límites configurables**: Establece límites por generaciones o población
- **Interacción completa**: Dibuja, coloca patrones, selecciona áreas, copia/pega, exporta/importa
- **Deshacer/Rehacer**: Historial de estados con Ctrl+Z / Ctrl+Shift+Z
- **Diseño responsivo**: Funciona en móviles y escritorio

## 🎮 Uso Interactivo

### Controles Principales

- **▶ Ejecutar/Pausar**: Inicia o detiene la simulación automática
- **⏭️ Paso**: Avanza una generación manualmente
- **⏮️ Atrás**: Retrocede una generación manualmente
- **🎲 Aleatorio**: Genera un patrón inicial aleatorio
- **↻ Limpiar**: Borra toda la cuadrícula
- **⚙ Configuración**: Ajusta reglas, vecindad, límites y más

### Interacción

- **Clic izquierdo**: Dibuja células individuales o coloca patrón seleccionado
- **Clic derecho**: Rota el patrón seleccionado 90°
- **Arrastrar**: Dibuja libremente mientras arrastras
- **Shift + Arrastrar**: Selecciona área rectangular
- **Ctrl + Clic en selección**: Mueve área seleccionada
- **Ctrl + Shift + Clic en selección**: Copia área seleccionada
- **Escape**: Cancela la selección de patrón o área
- **Delete**: Elimina contenido de selección
- **R**: Rota patrón seleccionado

### Atajos de Teclado

- **Espacio**: Ejecutar/Pausar
- **S**: Paso siguiente
- **Z**: Deshacer
- **Shift + Z**: Rehacer
- **A**: Aleatorio
- **C**: Limpiar
- **H / ?**: Ayuda

## 📚 Referencias

- **Conway's Game of Life**: [Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
- **Reglas de autómatas**: [LifeWiki](https://conwaylife.com/wiki/)
- **Autómatas de Wolfram**: [Wikipedia](https://en.wikipedia.org/wiki/Elementary_cellular_automaton)
- **Louis Kauffman**: [Mathematics Genealogy](https://www.mathgenealogy.org/id.php?id=4492)