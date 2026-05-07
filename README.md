# Knit Art Studio

A browser-based tool that converts any image into a knit, crochet, tapestry, or cross-stitch pattern — including a simulated knitting machine punchcard view.

## Features

- **4 stitch styles** — knit (V-loop), crochet (slip stitch), tapestry (woven rows), cross-stitch
- **Color quantization** — k-means clustering reduces your image to a chosen palette size (2–16 colors)
- **5 preset palettes** — Original, Nordic Wool, Autumn Harvest, Sage Garden, Twilight Yarn
- **Stitch preview** — canvas-rendered stitch texture with optional grid overlay and depth shading
- **Machine punchcard view** — simulates a flatbed knitting machine with animated carriage, needle bed, scrolling color chart, and yarn color legend
- **PNG download** — export the stitch pattern as a high-res PNG

## Project Structure

```
knit-art-studio/
├── index.html          # Entry point and markup
├── README.md
└── src/
    ├── style.css       # All styles (light + dark mode)
    ├── palettes.js     # Preset yarn color palettes
    ├── colors.js       # k-means clustering + color quantization
    ├── renderer.js     # Canvas stitch drawing functions
    ├── machine.js      # Knitting machine punchcard view + carriage animation
    └── app.js          # Main controller — event wiring, state management
```

## Getting Started

No build step required. Open directly in a browser:

```bash
# Option 1 — just open the file
open index.html

# Option 2 — serve locally (avoids any file:// quirks)
npx serve .
# or
python3 -m http.server 3000
```

Then visit `http://localhost:3000` (or `http://localhost:5000` for `npx serve`).

## Usage

1. **Drop an image** onto the upload zone (or click to browse)
2. Choose a **stitch style** — knit, crochet, tapestry, or cross-stitch
3. Adjust **stitch size** (6–20px per stitch) and **color count** (2–16 colors)
4. Select a **color palette** preset or keep the original image colors
5. Toggle **grid lines** and **texture depth** as needed
6. Click **"Machine punchcard"** tab to see the knitting machine simulation
7. Click **↓** to download your pattern as a PNG

## Extending

### Adding a new palette

In `src/palettes.js`, add an entry to the `PALETTES` object:

```js
myPalette: [
  '#hexcolor1',
  '#hexcolor2',
  // ...up to 16 colors recommended
]
```

Then add a corresponding `.palette-opt` element in `index.html` with `data-palette="myPalette"`.

### Adding a new stitch style

In `src/renderer.js`, add a new `drawXxxStitch(ctx, s, base, dark, light, texture)` function, then add a `case 'xxx':` branch in `renderStitchPattern()`.

Add the button in `index.html`:

```html
<button class="stitch-btn" data-stitch="xxx">My Stitch</button>
```

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). No external dependencies — just the Google Fonts stylesheet for typography.

## License

MIT
