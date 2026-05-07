/**
 * colors.js
 * Color processing utilities:
 *  - k-means clustering to extract dominant colors from an image
 *  - nearest-color quantization against a fixed palette
 */

/**
 * Run k-means clustering on image pixel data to find `k` dominant colors.
 * Samples every 16th pixel for performance.
 *
 * @param {ImageData} imageData - Raw pixel data from a canvas context
 * @param {number} k            - Number of color clusters (palette size)
 * @returns {Array<[number,number,number]>} Array of [r, g, b] cluster centers
 */
function kMeansColors(imageData, k) {
  const pixels = [];
  for (let i = 0; i < imageData.data.length; i += 16) {
    pixels.push([imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]]);
  }

  // Seed initial centers by striding through the sample
  const stride = Math.max(1, Math.floor(pixels.length / k));
  let centers = pixels.filter((_, i) => i % stride === 0).slice(0, k);
  while (centers.length < k) {
    centers.push([
      Math.random() * 255 | 0,
      Math.random() * 255 | 0,
      Math.random() * 255 | 0
    ]);
  }

  // Iterate
  for (let iter = 0; iter < 12; iter++) {
    const clusters = Array.from({ length: k }, () => []);

    for (const p of pixels) {
      let best = 0, bestDist = Infinity;
      centers.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestDist) { bestDist = d; best = i; }
      });
      clusters[best].push(p);
    }

    centers = clusters.map(cl => {
      if (!cl.length) return [128, 128, 128];
      return [
        cl.reduce((a, p) => a + p[0], 0) / cl.length | 0,
        cl.reduce((a, p) => a + p[1], 0) / cl.length | 0,
        cl.reduce((a, p) => a + p[2], 0) / cl.length | 0
      ];
    });
  }

  return centers;
}

/**
 * Normalize user / UI hex to #rrggbb for stable quantization.
 * @param {string} hex
 * @returns {string}
 */
function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') return '#000000';
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]+$/.test(h)) return '#000000';
  return `#${h.toLowerCase()}`;
}

/**
 * Snap an RGB color to the nearest entry in a hex palette array.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {string[]} palette - Array of hex strings e.g. ['#ff0000', ...]
 * @returns {[number, number, number]} Closest [r, g, b] from the palette
 */
function quantizeColor(r, g, b, palette) {
  let bestHex = normalizeHex(palette[0]);
  let bestDist = Infinity;
  for (const hex of palette) {
    const nh = normalizeHex(hex);
    const pr = parseInt(nh.slice(1, 3), 16);
    const pg = parseInt(nh.slice(3, 5), 16);
    const pb = parseInt(nh.slice(5, 7), 16);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestHex = nh;
    }
  }
  return [
    parseInt(bestHex.slice(1, 3), 16),
    parseInt(bestHex.slice(3, 5), 16),
    parseInt(bestHex.slice(5, 7), 16)
  ];
}

/**
 * Resolve an [r,g,b] pixel to its quantized color given either a fixed
 * palette or k-means color centers.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {string[]|null} palette       - Fixed palette or null for k-means
 * @param {Array|null}    colorCenters  - k-means centers (used when palette is null)
 * @returns {[number, number, number]}
 */
function resolveColor(r, g, b, palette, colorCenters) {
  if (palette) return quantizeColor(r, g, b, palette);
  if (!colorCenters) return [r, g, b];

  let best = colorCenters[0], bestDist = Infinity;
  for (const c of colorCenters) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

/**
 * Build a pixel grid and color map from a source image.
 * Downsamples the image to stitch resolution, quantizes colors,
 * and returns a compact index grid plus the resolved color list.
 *
 * @param {HTMLImageElement} sourceImage
 * @param {number} stitchSize  - Pixels per stitch
 * @param {number} colorCount  - Number of colors (used when palette is null)
 * @param {string} paletteName - Key into PALETTES
 * @param {string[]|null} customPalette - User-defined hex palette
 * @param {boolean[]|null} paletteEnabled - Per-slot visibility; hidden slots render as white
 * @returns {{ grid, cols, rows, stitchSize, colorList }}
 */
function buildPixelGrid(
  sourceImage,
  stitchSize,
  colorCount,
  paletteName,
  customPalette = null,
  paletteEnabled = null
) {
  const maxW = 600, maxH = 600;
  let sw = sourceImage.width, sh = sourceImage.height;
  if (sw > maxW) { sh = (sh * maxW / sw) | 0; sw = maxW; }
  if (sh > maxH) { sw = (sw * maxH / sh) | 0; sh = maxH; }

  const cols = Math.floor(sw / stitchSize);
  const rows = Math.floor(sh / stitchSize);

  const off = document.createElement('canvas');
  off.width = cols; off.height = rows;
  const octx = off.getContext('2d');
  octx.drawImage(sourceImage, 0, 0, cols, rows);
  const imgData = octx.getImageData(0, 0, cols, rows);

  const rawPalette =
    customPalette && customPalette.length ? customPalette : (PALETTES[paletteName] || null);
  const palette = rawPalette ? rawPalette.map(h => normalizeHex(h)) : null;

  /**
   * Custom palette: each pixel maps to the nearest palette *index* (all slots compete).
   * Disabled slots still win distance; display color is white for those indices.
   */
  if (palette && palette.length) {
    const rgbPalette = palette.map(hex => hexToRgb(hex));
    const enabledMask =
      paletteEnabled && paletteEnabled.length === palette.length
        ? paletteEnabled
        : palette.map(() => true);
    const colorList = palette.map((_, i) =>
      enabledMask[i] ? [...rgbPalette[i]] : [255, 255, 255]
    );

    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const pi = (r * cols + c) * 4;
        const r0 = imgData.data[pi];
        const g0 = imgData.data[pi + 1];
        const b0 = imgData.data[pi + 2];
        let bestJ = 0;
        let bestD = Infinity;
        for (let j = 0; j < rgbPalette.length; j++) {
          const [pr, pg, pb] = rgbPalette[j];
          const d = (r0 - pr) ** 2 + (g0 - pg) ** 2 + (b0 - pb) ** 2;
          if (d < bestD) {
            bestD = d;
            bestJ = j;
          }
        }
        row.push(bestJ);
      }
      grid.push(row);
    }

    return { grid, cols, rows, stitchSize, colorList };
  }

  const colorCenters = kMeansColors(imgData, colorCount);

  const colorIndex = new Map();
  const colorList = [];
  const grid = [];

  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const pi = (r * cols + c) * 4;
      const [cr, cg, cb] = resolveColor(
        imgData.data[pi], imgData.data[pi + 1], imgData.data[pi + 2],
        null,
        colorCenters
      );
      const key = `${cr},${cg},${cb}`;
      if (!colorIndex.has(key)) {
        colorIndex.set(key, colorList.length);
        colorList.push([cr, cg, cb]);
      }
      row.push(colorIndex.get(key));
    }
    grid.push(row);
  }

  return { grid, cols, rows, stitchSize, colorList };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('');
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rn: h = 60 * (((gn - bn) / d) % 6); break;
      case gn: h = 60 * (((bn - rn) / d) + 2); break;
      default: h = 60 * (((rn - gn) / d) + 4); break;
    }
  }

  if (h < 0) h += 360;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0, g = 0, b = 0;

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  );
}
