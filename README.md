# Shape Forge

A browser-based vector graphics editor built with Paper.js, React, and TypeScript. Create, edit, and export vector shapes — including an advanced PNG-to-vector auto-tracer powered by the marching squares algorithm.

<!-- TODO: Add a screenshot or GIF demo here -->
<!-- ![Shape Forge Screenshot](docs/screenshot.png) -->

## Features

### Drawing Tools
- **Rectangle, Circle, Rounded Rectangle, Polygon, Star** — click-and-drag shape creation
- **Pen Tool** — node-level editing with bezier curve manipulation
- **Selection Tool** — click to select, drag to move, multi-select support

### Boolean Operations
- **Union, Subtract, Intersect, Exclude** — combine shapes with boolean ops
- **Merge Nearby** — auto-merge overlapping shapes within a configurable radius

### PNG Auto-Tracer
- **Marching squares contour extraction** with saddle point disambiguation
- **Multi-channel support** — trace from Alpha, Luminance, Red, Green, or Blue
- **Gaussian blur preprocessing** for noise reduction
- **Live preview modal** with checkerboard background and colored contour overlay
- **Per-contour controls** — enable/disable, delete individual contours
- **6 parameter sliders** — Threshold, Blur, Smoothing, Min Area, Offset, Corner Angle
- **Negative space tracing** via invert toggle
- **Winding order detection** — automatic outer contour vs hole classification

### Canvas & Navigation
- **Infinite canvas** with pan (middle-click or Space+drag) and zoom (scroll wheel)
- **Snap-to-grid** with configurable grid size
- **F key** — zoom-to-fit on selection (or all shapes)
- **Undo/Redo** with full history stack

### Export
- **SVG export** — clean vector output
- **PNG export** — rasterized output at configurable resolution

### Properties Panel
- **Transform controls** — position, size, rotation
- **Fill & Stroke** — color pickers, stroke width, opacity
- **Layer management** — visibility, lock, reorder, rename

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) 18+ 
- npm (comes with Node.js)

### Install & Run

```bash
git clone https://github.com/newjordan/shape-forge.git
cd shape-forge
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | [React](https://react.dev/) 19 |
| Language | [TypeScript](https://www.typescriptlang.org/) 5.9 |
| Build Tool | [Vite](https://vite.dev/) 7 |
| Vector Engine | [Paper.js](http://paperjs.org/) 0.12 |
| State Management | [Zustand](https://zustand.docs.pmnd.rs/) 5 |

## Project Structure

```
src/
├── App.tsx                    # Root component, layout, modal wiring
├── engine.ts                  # Paper.js engine, shape ops, trace pipeline
├── store.ts                   # Zustand state management
├── types.ts                   # TypeScript type definitions
├── main.tsx                   # Entry point
├── index.css                  # Global styles
└── components/
    ├── Canvas.tsx             # Main canvas with Paper.js rendering
    ├── Toolbar.tsx            # Left sidebar tools & controls
    ├── PropertiesPanel.tsx    # Right panel transform & style controls
    ├── ImageTraceModal.tsx    # PNG trace popup with live preview
    └── ExportPanel.tsx        # SVG/PNG export controls
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

Please use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

## License

[MIT](LICENSE)
