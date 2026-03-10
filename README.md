# TradeView Pro

A professional, high-performance charting application built with lightweight-charts. Supports visualizing market datasets (JSON and CSV) directly in the browser with advanced replay capabilities, drawing tools, and real-time statistics.

## ✨ Features

- **High-Performance Rendering**: Uses Web Workers to parse and load large datasets seamlessly without freezing the UI.
- **Advanced Replay Mode**: Step-by-step playback with variable playback speeds, allowing for backtesting and analysis.
- **Interactive Drawing Tools**: Includes trendlines, Fibonacci retracements, horizontal & vertical lines, ranges, and text annotations.
- **Dynamic Timeframe Aggregation**: Automatically scales and aggregates data for optimal viewing base on the active timeframe.
- **Modular Architecture**: Clean, readable, and maintainable codebase separation (HTML, CSS, JS).

## 🚀 Getting Started

Since the project uses absolute imports, ES modules and Web Workers, it needs to be served via a local web server (opening the file directly via `file://` might block some features like Web Workers depending on your browser's security policies).

### Using Python (recommended)

```bash
python3 -m http.server 8080
```

Then visit: `http://localhost:8080`

### Using Node.js (npx)

```bash
npx serve .
```

## 📁 Project Structure

- `index.html`: The main entry point containing the interface structure.
- `style.css`: All the styling, variables, and animations.
- `script.js`: The application logic (chart initialization, data parsing with Web Workers, UI interactions, and drawing tools).
