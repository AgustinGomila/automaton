# Interactive Cellular Automaton

![🇪🇸](https://flagcdn.com/w20/es.png) [🇪🇸](README.md)

An interactive cellular automaton implementation with support for **multiple rules**, **1D Wolfram automata**,
**2D Recursive Distinction**, and **Elementary Triangular Automata (ETAs)**.

## 🎯 Experiment with the Automaton

**[Experiment →](https://agustingomila.github.io/automaton/)**

## 📖 Features

### Available Rules

- **Conway's Life B3/S23** - The most famous cellular automaton
- **HighLife B36/S23** - Variation with replicator
- **Day & Night B3678/S34678** - Symmetric with interesting behavior
- **Kauffman B37/S4567** - Rule presented by Louis Kauffman
- **30+ more predefined rules**
- **Custom rule** - Define your own B/S parameters

### Special Automata

- **Wolfram 1D** - One-dimensional elementary automata (rules 0-255) with vertical or horizontal evolution
- **RD-2D** - 2D Recursive Distinction with 16 states based on [N,S,E,W] boundaries and XOR rule
- **ETA** - Elementary Triangular Automata

### Functionalities

- **Neighborhood selector**: Moore (8 neighbors) or von Neumann (4 neighbors)
- **Configurable radius**: Controls the distance of influence (1-10)
- **Predefined patterns**: 20 initial patterns + random
- **Pattern rotation**: Rotate patterns 90° with right-click
- **Configurable limits**: Set limits by generations or population
- **Full interaction**: Draw, place patterns, select areas, copy/paste, export/import
- **Undo/Redo**: State history with Ctrl+Z / Ctrl+Shift+Z
- **Responsive design**: Works on mobile and desktop

## 🎮 Interactive Usage

### Main Controls

- **▶ Run/Pause**: Starts or stops automatic simulation
- **⏭️ Step**: Advances one generation manually
- **⏮️ Back**: Goes back one generation manually
- **🎲 Random**: Generates a random initial pattern
- **↻ Clear**: Clears the entire grid
- **⚙ Settings**: Adjust rules, neighborhood, limits, and more

### Interaction

- **Left click**: Draws individual cells or places selected pattern
- **Right click**: Rotates the selected pattern 90°
- **Drag**: Draws freely while dragging
- **Shift + Drag**: Selects rectangular area
- **Ctrl + Click on selection**: Moves selected area
- **Ctrl + Shift + Click on selection**: Copies selected area
- **Escape**: Cancels pattern or area selection
- **Delete**: Deletes content of selection
- **R**: Rotates selected pattern

### Keyboard Shortcuts

- **Space**: Run/Pause
- **S**: Next step
- **Z**: Undo
- **Shift + Z**: Redo
- **A**: Random
- **C**: Clear
- **G**: Show/Hide grid
- **H / ?**: Help

## 📚 References

- **Conway's Game of Life**: [Wikipedia](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life)
- **Automaton rules**: [LifeWiki](https://conwaylife.com/wiki/)
- **Wolfram Automata**: [Wikipedia](https://en.wikipedia.org/wiki/Elementary_cellular_automaton)
- **Triangular automata**: [Triangular automata](https://triangular-automata.net)
- **Louis Kauffman**: [Mathematics Genealogy](https://www.mathgenealogy.org/id.php?id=4492)
- **Ruliology**: [Ruliology](https://writings.stephenwolfram.com/2026/01/what-is-ruliology/)