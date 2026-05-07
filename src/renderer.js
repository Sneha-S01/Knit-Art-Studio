/**
 * renderer.js
 * SVG-based stitch rendering: realistic swatch vs knit chart.
 */

export function renderPreview(pixelData, previewMode, stitchType, showGrid, showTexture) {
  if (previewMode === 'chart') {
    return renderKnitChartPatternSVG(pixelData, showGrid);
  } else {
    return renderSwatchPatternSVG(pixelData, stitchType, false, showTexture);
  }
}

function renderSwatchPatternSVG(pixelData, stitchType, showGrid, showTexture) {
  const { grid, cols, rows, stitchSize, colorList } = pixelData;
  const canvasW = cols * stitchSize;
  const canvasH = rows * stitchSize;

  let svg = `<svg viewBox="0 0 ${canvasW} ${canvasH}" width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">\n`;

  // Gaps between stitches — soft charcoal so the swatch doesn’t read as heavy black
  svg += `  <rect width="${canvasW}" height="${canvasH}" fill="#2a2a2a"/>\n`;

  // Define unique stitch templates corresponding to the palette colors
  svg += `  <defs>\n`;
  colorList.forEach((rgb, idx) => {
    const [cr, cg, cb] = rgb;
    const baseColor = `rgb(${cr}, ${cg}, ${cb})`;
    // Shadows stay in-gamut (tinted) instead of crushing toward gray/black
    const darkColor = `rgb(${blendTowardNeutral(cr, 0.78, 10)}, ${blendTowardNeutral(cg, 0.78, 10)}, ${blendTowardNeutral(cb, 0.78, 10)})`;
    const lightColor = `rgb(${Math.min(255, Math.round(cr * 1.18 + 28))}, ${Math.min(255, Math.round(cg * 1.18 + 28))}, ${Math.min(255, Math.round(cb * 1.18 + 28))})`;

    let pathContent = '';
    const s = stitchSize;

    if (stitchType === 'knit') pathContent = getKnitPaths(s, baseColor, darkColor, lightColor, showTexture, rgb);
    else if (stitchType === 'crochet') pathContent = getCrochetPaths(s, baseColor, darkColor, lightColor, showTexture);
    else if (stitchType === 'tapestry') pathContent = getTapestryPaths(s, baseColor, darkColor, lightColor, showTexture);
    else if (stitchType === 'cross') pathContent = getCrossStitchPaths(s, baseColor, darkColor, lightColor, showTexture);
    else pathContent = getKnitPaths(s, baseColor, darkColor, lightColor, showTexture, rgb);

    svg += `    <g id="stitch-${idx}">\n      ${pathContent}\n    </g>\n`;
  });

  if (showGrid) {
    svg += `    <g id="grid-cell">\n      <rect width="${stitchSize}" height="${stitchSize}" fill="none" stroke="rgba(0,0,0,0.07)" stroke-width="0.5"/>\n    </g>\n`;
  }
  svg += `  </defs>\n\n  <g>\n`;

  // Draw grid from bottom-up for perfect z-overlap
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = 0; col < cols; col++) {
      const colorIdx = grid[row][col];
      const x = col * stitchSize;
      const y = row * stitchSize;
      
      svg += `    <use href="#stitch-${colorIdx}" x="${x}" y="${y}" />\n`;
      if (showGrid) {
        svg += `    <use href="#grid-cell" x="${x}" y="${y}" />\n`;
      }
    }
  }

  svg += `  </g>\n</svg>`;
  return svg;
}

/** Darken yarn RGB for shadows while staying on-hue (avoids muddy gray/black overlays). */
function blendTowardNeutral(channel, factor, lift) {
  return Math.min(255, Math.round(channel * factor + lift));
}

function knitDropShadowRgb(rgb) {
  const [r, g, b] = rgb;
  return `rgb(${blendTowardNeutral(r, 0.58, 6)}, ${blendTowardNeutral(g, 0.58, 6)}, ${blendTowardNeutral(b, 0.58, 6)})`;
}

function getKnitPaths(s, baseC, darkC, lightC, texture, rgb) {
  const yarnW = s * 0.45;
  const cx = s * 0.5;
  const leftX = s * 0.25;
  const rightX = s * 0.75;
  const topY = -s * 0.35; 
  const botY = s * 0.95; 

  const d1 = `M ${leftX} ${topY + s * 0.15} C ${leftX} ${s * 0.5} ${leftX} ${botY + s * 0.1} ${cx} ${botY + s * 0.1} C ${rightX} ${botY + s * 0.1} ${rightX} ${s * 0.5} ${rightX} ${topY + s * 0.15}`;
  const dBase = `M ${leftX} ${topY} C ${leftX} ${s * 0.5} ${leftX} ${botY} ${cx} ${botY} C ${rightX} ${botY} ${rightX} ${s * 0.5} ${rightX} ${topY}`;
  const dInner = `M ${leftX} ${topY} C ${leftX} ${s * 0.48} ${leftX} ${botY - s * 0.05} ${cx} ${botY - s * 0.05} C ${rightX} ${botY - s * 0.05} ${rightX} ${s * 0.48} ${rightX} ${topY}`;
  const dHigh = `M ${leftX} ${topY} C ${leftX} ${s * 0.45} ${leftX + s * 0.02} ${botY - s * 0.1} ${cx} ${botY - s * 0.1} C ${rightX - s * 0.02} ${botY - s * 0.1} ${rightX} ${s * 0.45} ${rightX} ${topY}`;
  const dSpec = `M ${leftX} ${topY} C ${leftX} ${s * 0.4} ${leftX + s * 0.05} ${botY - s * 0.15} ${cx} ${botY - s * 0.15} C ${rightX - s * 0.05} ${botY - s * 0.15} ${rightX} ${s * 0.4} ${rightX} ${topY}`;

  if (!texture) {
    return `<path d="${dBase}" fill="none" stroke="${baseC}" stroke-width="${yarnW}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  const dropC = rgb ? knitDropShadowRgb(rgb) : darkC;
  const spec = rgb
    ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`
    : 'rgba(255,255,255,0.22)';

  return `<path d="${d1}" fill="none" stroke="${dropC}" stroke-width="${yarnW * 0.92}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${dBase}" fill="none" stroke="${baseC}" stroke-width="${yarnW}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${dBase}" fill="none" stroke="${darkC}" stroke-width="${yarnW * 0.62}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${dInner}" fill="none" stroke="${baseC}" stroke-width="${yarnW * 0.55}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${dHigh}" fill="none" stroke="${lightC}" stroke-width="${yarnW * 0.28}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${dSpec}" fill="none" stroke="${spec}" stroke-width="${yarnW * 0.12}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function getCrochetPaths(s, baseC, darkC, lightC, texture) {
  const yarnW = s * 0.45;
  const pPost = `M ${s*0.5} ${s*0.2} L ${s*0.5} ${s*0.95}`;
  const pPostShadow = `M ${s*0.5} ${s*0.2 + s*0.1} L ${s*0.5} ${s*0.95 + s*0.1}`;
  const pPostHigh = `M ${s*0.45} ${s*0.2} L ${s*0.45} ${s*0.95}`;
  
  const pTop = `M ${s*0.05} ${s*0.25} C ${s*0.5} ${-s*0.05} ${s*0.95} ${s*0.25} ${s*0.95} ${s*0.25}`;
  const pTopShadow = `M ${s*0.05} ${s*0.25 + s*0.1} C ${s*0.5} ${-s*0.05 + s*0.1} ${s*0.95} ${s*0.25 + s*0.1} ${s*0.95} ${s*0.25 + s*0.1}`;
  const pTopHigh = `M ${s*0.05} ${s*0.2} C ${s*0.5} ${-s*0.1} ${s*0.95} ${s*0.2} ${s*0.95} ${s*0.2}`;
  
  return `<path d="${pPostShadow}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="${yarnW}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pPost}" fill="none" stroke="${baseC}" stroke-width="${yarnW}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pPostHigh}" fill="none" stroke="${lightC}" stroke-width="${yarnW * 0.3}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pTopShadow}" fill="none" stroke="rgba(0,0,0,0.7)" stroke-width="${yarnW * 1.1}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pTop}" fill="none" stroke="${baseC}" stroke-width="${yarnW}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${pTopHigh}" fill="none" stroke="${lightC}" stroke-width="${yarnW * 0.25}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function getTapestryPaths(s, baseC, darkC, lightC, texture) {
  const yarnW = s * 1.2;
  const pBase = `M ${-s*0.15} ${s*1.15} L ${s*1.15} ${-s*0.15}`;
  const pShadow = `M ${-s*0.15} ${s*1.15 + s*0.1} L ${s*1.15} ${-s*0.15 + s*0.1}`;
  const pDark = `M 0 ${s} L ${s} 0`;
  const pLight = `M ${-s*0.2} ${s*0.8} L ${s*0.8} ${-s*0.2}`;

  return `<path d="${pShadow}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="${yarnW}" stroke-linecap="butt"/>
      <path d="${pBase}" fill="none" stroke="${baseC}" stroke-width="${yarnW}" stroke-linecap="butt"/>
      <path d="${pDark}" fill="none" stroke="${darkC}" stroke-width="${yarnW * 0.25}" stroke-linecap="butt"/>
      <path d="${pLight}" fill="none" stroke="${lightC}" stroke-width="${yarnW * 0.15}" stroke-linecap="butt"/>`;
}

function getCrossStitchPaths(s, baseC, darkC, lightC, texture) {
  const yarnW = s * 0.4;
  const pad = s * 0.15;
  const pBack = `M ${pad} ${s - pad} L ${s - pad} ${pad}`;
  const pBackShadow = `M ${pad} ${s - pad + s*0.1} L ${s - pad} ${pad + s*0.1}`;
  const pFront = `M ${pad} ${pad} L ${s - pad} ${s - pad}`;
  const pFrontShadow = `M ${pad} ${pad + s*0.1} L ${s - pad} ${s - pad + s*0.1}`;

  return `<!-- Back thread -->
      <path d="${pBackShadow}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="${yarnW}" stroke-linecap="round"/>
      <path d="${pBack}" fill="none" stroke="${baseC}" stroke-width="${yarnW}" stroke-linecap="round"/>
      <path d="${pBack}" fill="none" stroke="${lightC}" stroke-width="${yarnW * 0.25}" stroke-linecap="round"/>
      <!-- Front thread -->
      <path d="${pFrontShadow}" fill="none" stroke="rgba(0,0,0,0.7)" stroke-width="${yarnW}" stroke-linecap="round"/>
      <path d="${pFront}" fill="none" stroke="${baseC}" stroke-width="${yarnW}" stroke-linecap="round"/>
      <path d="${pFront}" fill="none" stroke="${lightC}" stroke-width="${yarnW * 0.25}" stroke-linecap="round"/>`;
}

function renderKnitChartPatternSVG(pixelData, showGrid) {
  const { grid, cols, rows, stitchSize, colorList } = pixelData;
  const canvasW = cols * stitchSize;
  const canvasH = rows * stitchSize;

  let svg = `<svg viewBox="0 0 ${canvasW} ${canvasH}" width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">\n`;
  svg += `  <rect width="${canvasW}" height="${canvasH}" fill="#ffffff"/>\n`;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = grid[row][col];
      const [r, g, b] = colorList[idx];
      svg += `  <rect x="${col * stitchSize}" y="${row * stitchSize}" width="${stitchSize}" height="${stitchSize}" fill="rgb(${r},${g},${b})"/>\n`;
    }
  }

  if (showGrid) {
    let minor = '';
    for (let c = 0; c <= cols; c++) {
      const x = c * stitchSize;
      minor += `M ${x} 0 L ${x} ${canvasH} `;
    }
    for (let r = 0; r <= rows; r++) {
      const y = r * stitchSize;
      minor += `M 0 ${y} L ${canvasW} ${y} `;
    }
    svg += `  <path d="${minor}" fill="none" stroke="rgba(0,0,0,0.14)" stroke-width="0.5"/>\n`;
  }

  svg += `</svg>`;
  return svg;
}

