import "./style.css";
import { renderPreview } from "./renderer.js";
import {
  buildPixelGrid,
  kMeansColors,
  normalizeHex,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToHex
} from "./colors.js";

/**
 * app.js
 * Main application controller.
 * Wires up all UI events, manages state, and orchestrates rendering.
 */

(() => {
  /* ─── State ──────────────────────────────────────────────── */
  let sourceImage = null;
  let currentStitch = 'knit';
  let paletteItems = [{ hex: '#ffffff', enabled: true, opacity: 100 }];
  let lastPixelData = null;
  let liveRenderTimer = null;
  let selectedColorIndex = 0;
  let pickerSat = 50;
  let pickerVal = 75;
  let pickerOpen = false;
  /** @type {'swatch'|'chart'} */
  let previewMode = 'swatch';
  /** User zoom multiplier on top of fit-to-viewport (1 = fitted). */
  let previewZoom = 1;
  const MAX_PALETTE_COLORS = 25;
  let resetPreviewScrollNext = false;

  /** Chart-only stitch cell selection (keys: "col,row"). */
  const chartCellSelection = new Set();
  let chartSelecting = false;
  let chartSelectPointerId = null;
  let chartSelectAnchor = null;
  /** @type {Set<string>|null} */
  let chartSelectBaseSelection = null;
  let chartSpaceHeld = false;
  let chartPickerPaintUndoPushed = false;
  let chartSelectToolEnabled = false;
  let chartFill = { hex: '#ffffff', enabled: true, opacity: 100 };
  let chartFillPickerActive = false;
  let chartSelectionOverlayRaf = 0;
  let eyedropperActive = false;

  /** @type {Array<ReturnType<typeof captureEditorState>>} */
  let undoStack = [];
  /** @type {Array<ReturnType<typeof captureEditorState>>} */
  let redoStack = [];
  let historySuspended = false;
  const MAX_UNDO = 40;

  /* ─── Element refs ───────────────────────────────────────── */
  const outputContainer = document.getElementById('outputContainer');
  const placeholder = document.getElementById('placeholder');
  const downloadBtn = document.getElementById('downloadBtn');
  const previewKnitBtn = document.getElementById('previewKnitBtn');
  const previewChartBtn = document.getElementById('previewChartBtn');
  const chartSelectToolBtn = document.getElementById('chartSelectToolBtn');
  const chartFillBlock = document.getElementById('chartFillBlock');
  const chartFillRow = document.getElementById('chartFillRow');
  const chartFillChip = document.getElementById('chartFillChip');
  const chartFillHexInput = document.getElementById('chartFillHexInput');
  const chartFillEyeBtn = document.getElementById('chartFillEyeBtn');
  const chartFillAddBtn = document.getElementById('chartFillAddBtn');
  const processingOverlay = document.getElementById('processingOverlay');
  const processingMsg = document.getElementById('processingMsg');
  const canvasArea = document.getElementById('canvasArea');
  const hiddenInput = document.getElementById('hiddenInput');
  const stitchSizeInput = document.getElementById('stitchSize');
  const stitchSizeNumberInput = document.getElementById('stitchSizeInput');
  const colorCountInput = document.getElementById('colorCount');
  const colorCountNumberInput = document.getElementById('colorCountInput');
  const gridToggle = document.getElementById('gridToggle');
  const textureToggle = document.getElementById('textureToggle');
  const paletteEditor = document.getElementById('paletteEditor');
  const addColorBtn = document.getElementById('addColorBtn');
  const pickerPopover = document.getElementById('pickerPopover');
  const pickerCloseBtn = document.getElementById('pickerCloseBtn');
  const pickerEyedropperBtn = document.getElementById('pickerEyedropperBtn');
  const svPlane = document.getElementById('svPlane');
  const svHandle = document.getElementById('svHandle');
  const hueSlider = document.getElementById('hueSlider');
  const hueVal = document.getElementById('hueVal');
  const opacitySlider = document.getElementById('opacitySlider');
  const opacityVal = document.getElementById('opacityVal');
  const previewViewport = document.getElementById('previewViewport');
  const chartSelectionLayer = document.getElementById('chartSelectionLayer');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomInput = document.getElementById('zoomInput');
  const clearImageBtn = document.getElementById('clearImageBtn');
  const exportModal = document.getElementById('exportModal');
  const exportModalClose = document.getElementById('exportModalClose');
  const exportWidthInput = document.getElementById('exportWidth');
  const exportHeightInput = document.getElementById('exportHeight');
  const exportScaleSelect = document.getElementById('exportScale');
  const exportFormatSelect = document.getElementById('exportFormat');
  const exportConfirmBtn = document.getElementById('exportConfirmBtn');
  let exportAspect = 1;
  let syncingExportSize = false;
  const textureRow = document.getElementById('textureRow');
  const gridRow = document.getElementById('gridRow');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  function pulseStatus() {}

  function setupInteractiveFeedback() {
    document.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('pointerdown', () => btn.classList.add('is-pressed'));
      const clear = () => btn.classList.remove('is-pressed');
      btn.addEventListener('pointerup', clear);
      btn.addEventListener('pointerleave', clear);
      btn.addEventListener('pointercancel', clear);
    });
  }

  function setPaletteToolbarState() {
    if (addColorBtn) {
      addColorBtn.disabled =
        paletteItems.length === 0 || paletteItems.length >= MAX_PALETTE_COLORS;
    }
  }

  function clonePixelData(pd) {
    return {
      grid: pd.grid.map(row => row.slice()),
      cols: pd.cols,
      rows: pd.rows,
      stitchSize: pd.stitchSize,
      colorList: pd.colorList.map(c => c.slice())
    };
  }

  function captureEditorState() {
    return {
      paletteItems: JSON.parse(JSON.stringify(paletteItems)),
      lastPixelData: lastPixelData ? clonePixelData(lastPixelData) : null,
      selectedColorIndex,
      colorCount: colorCountInput.value,
      stitchSize: stitchSizeInput.value,
      currentStitch,
      previewMode,
      previewZoom,
      gridOn: gridToggle.classList.contains('on'),
      textureOn: textureToggle.classList.contains('on')
    };
  }

  function applyEditorState(s) {
    paletteItems = JSON.parse(JSON.stringify(s.paletteItems));
    lastPixelData = s.lastPixelData ? clonePixelData(s.lastPixelData) : null;
    selectedColorIndex = s.selectedColorIndex;
    colorCountInput.value = s.colorCount;
    colorCountNumberInput.value = s.colorCount;
    stitchSizeInput.value = s.stitchSize;
    stitchSizeNumberInput.value = s.stitchSize;
    previewMode = s.previewMode;
    if (previewKnitBtn) previewKnitBtn.classList.toggle('active', previewMode === 'swatch');
    if (previewChartBtn) previewChartBtn.classList.toggle('active', previewMode === 'chart');
    previewZoom = s.previewZoom;
    gridToggle.classList.toggle('on', s.gridOn);
    textureToggle.classList.toggle('on', s.textureOn);
    updateOptionVisibility();
    renderPaletteEditor();
    if (sourceImage && lastPixelData) rerenderPreviewFromLastData();
    formatZoomField();
    applyPreviewSizing();
  }

  function pushUndoHistory() {
    if (historySuspended || !sourceImage || !lastPixelData) return;
    undoStack.push(captureEditorState());
    redoStack = [];
    while (undoStack.length > MAX_UNDO) undoStack.shift();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(captureEditorState());
    const prev = undoStack.pop();
    historySuspended = true;
    applyEditorState(prev);
    historySuspended = false;
    updateUndoRedoButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(captureEditorState());
    const next = redoStack.pop();
    historySuspended = true;
    applyEditorState(next);
    historySuspended = false;
    updateUndoRedoButtons();
  }

  function resetHistoryStacks() {
    undoStack = [];
    redoStack = [];
    updateUndoRedoButtons();
  }

  /* ─── Slider labels ──────────────────────────────────────── */
  stitchSizeInput.addEventListener('pointerdown', () => {
    if (sourceImage && lastPixelData) pushUndoHistory();
  });
  stitchSizeInput.addEventListener('input', () => {
    const next = clampInt(stitchSizeInput.value, 1, 8, 4);
    stitchSizeInput.value = String(next);
    stitchSizeNumberInput.value = String(next);
    scheduleLiveRender();
  });

  stitchSizeNumberInput.addEventListener('pointerdown', () => {
    if (sourceImage && lastPixelData) pushUndoHistory();
  });
  stitchSizeNumberInput.addEventListener('input', () => {
    const next = clampInt(stitchSizeNumberInput.value, 1, 8, 4);
    stitchSizeInput.value = String(next);
    stitchSizeNumberInput.value = String(next);
    scheduleLiveRender();
  });

  colorCountInput.addEventListener('pointerdown', () => {
    if (sourceImage && lastPixelData) pushUndoHistory();
  });
  colorCountInput.addEventListener('input', () => {
    colorCountNumberInput.value = colorCountInput.value;
  });

  colorCountNumberInput.addEventListener('pointerdown', () => {
    if (sourceImage && lastPixelData) pushUndoHistory();
  });
  colorCountNumberInput.addEventListener('input', () => {
    const next = clampInt(colorCountNumberInput.value, 1, MAX_PALETTE_COLORS, 1);
    colorCountInput.value = String(next);
    colorCountNumberInput.value = String(next);
  });

  colorCountInput.addEventListener('change', () => {
    if (!sourceImage) return;
    paletteItems = extractPaletteFromImage(parseInt(colorCountInput.value, 10));
    renderPaletteEditor();
    scheduleLiveRender();
  });

  colorCountNumberInput.addEventListener('change', () => {
    if (!sourceImage) return;
    paletteItems = extractPaletteFromImage(parseInt(colorCountInput.value, 10));
    renderPaletteEditor();
    scheduleLiveRender();
  });

  addColorBtn.addEventListener('click', () => {
    if (paletteItems.length >= MAX_PALETTE_COLORS) return;
    pushUndoHistory();
    const base =
      paletteItems[selectedColorIndex]?.hex ||
      paletteItems[paletteItems.length - 1]?.hex ||
      '#888888';
    const [r, g, b] = hexToRgb(base);
    const [h, s, l] = rgbToHsl(r, g, b);
    const next = normalizeHex(hslToHex((h + 24) % 360, s, l));
    paletteItems.push({ hex: next, enabled: true, opacity: 100 });
    selectedColorIndex = paletteItems.length - 1;
    renderPaletteEditor();
    scheduleLiveRender();
  });

  if (pickerCloseBtn) {
    pickerCloseBtn.addEventListener('click', e => {
      e.stopPropagation();
      setEyedropperActive(false);
      closePicker();
    });
  }

  if (pickerEyedropperBtn) {
    pickerEyedropperBtn.addEventListener('click', e => {
      e.stopPropagation();
      setEyedropperActive(!eyedropperActive);
    });
  }

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.code === 'Space') {
      chartSpaceHeld = true;
      if (previewMode === 'chart') e.preventDefault();
      updatePreviewPanState();
    }
    if (e.key === 'Escape') {
      if (eyedropperActive) {
        setEyedropperActive(false);
        e.preventDefault();
        return;
      }
      if (isChartSelectToolActive() && chartCellSelection.size > 0) {
        clearChartCellSelection();
        e.preventDefault();
        return;
      }
      if (isChartSelectToolActive()) {
        setChartSelectToolEnabled(false);
        e.preventDefault();
        return;
      }
      closePicker();
    }
  });

  document.addEventListener('keyup', e => {
    if (e.code === 'Space') {
      chartSpaceHeld = false;
      updatePreviewPanState();
    }
  });

  document.addEventListener('pointerdown', e => {
    if (!pickerOpen) return;
    if (pickerPopover.contains(e.target)) return;
    closePicker();
  });

  hueSlider.addEventListener('input', () => {
    if (chartFillPickerActive && hasChartCellSelection() && !chartPickerPaintUndoPushed) {
      pushUndoHistory();
      chartPickerPaintUndoPushed = true;
    }
    hueVal.textContent = `${hueSlider.value}°`;
    syncPlaneColor();
    updateColorFromPicker();
  });

  opacitySlider.addEventListener('input', () => {
    if (chartFillPickerActive && hasChartCellSelection() && !chartPickerPaintUndoPushed) {
      pushUndoHistory();
      chartPickerPaintUndoPushed = true;
    }
    const v = clampInt(opacitySlider.value, 0, 100, 100);
    opacitySlider.value = String(v);
    opacityVal.textContent = `${v}%`;
    updateOpacitySliderTrack();
    updateColorFromPicker();
  });

  let svDragging = false;
  svPlane.addEventListener('pointerdown', e => {
    svDragging = true;
    chartPickerPaintUndoPushed = false;
    if (chartFillPickerActive && hasChartCellSelection()) {
      pushUndoHistory();
      chartPickerPaintUndoPushed = true;
    }
    svPlane.setPointerCapture(e.pointerId);
    updateSVFromPointer(e);
  });
  svPlane.addEventListener('pointermove', e => {
    if (!svDragging) return;
    updateSVFromPointer(e);
  });
  svPlane.addEventListener('pointerup', e => {
    svDragging = false;
    chartPickerPaintUndoPushed = false;
    svPlane.releasePointerCapture(e.pointerId);
  });

  /* ─── Toggle buttons ─────────────────────────────────────── */
  gridToggle.addEventListener('click', () => {
    gridToggle.classList.toggle('on');
    scheduleLiveRender();
  });

  textureToggle.addEventListener('click', () => {
    textureToggle.classList.toggle('on');
    scheduleLiveRender();
  });

  zoomInBtn.addEventListener('click', e => {
    e.stopPropagation();
    previewZoom = Math.min(4, Math.round((previewZoom * 1.25) * 100) / 100);
    applyPreviewSizing();
  });
  zoomOutBtn.addEventListener('click', e => {
    e.stopPropagation();
    previewZoom = Math.max(0.25, Math.round((previewZoom / 1.25) * 100) / 100);
    applyPreviewSizing();
  });

  function formatZoomField() {
    zoomInput.value = `${Math.round(previewZoom * 100)}%`;
  }

  function parseZoomPercentString(str) {
    const cleaned = String(str).replace(/%/g, '').replace(/,/g, '.').trim();
    const n = parseFloat(cleaned);
    if (Number.isNaN(n)) return null;
    return Math.min(400, Math.max(25, n)) / 100;
  }

  zoomInput.addEventListener('focus', () => {
    zoomInput.select();
  });
  zoomInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      zoomInput.blur();
    }
  });
  zoomInput.addEventListener('blur', () => {
    const z = parseZoomPercentString(zoomInput.value);
    if (z === null) formatZoomField();
    else {
      previewZoom = z;
      applyPreviewSizing();
    }
  });

  clearImageBtn.addEventListener('click', e => {
    e.stopPropagation();
    clearImage();
  });
  let previewPanning = false;
  let previewPanStartX = 0;
  let previewPanStartY = 0;
  let previewPanScrollLeft = 0;
  let previewPanScrollTop = 0;

  function updatePreviewPanState() {
    if (!previewViewport) return;
    const svg = outputContainer.querySelector('svg');
    const el = previewViewport;
    if (!svg) {
      el.classList.remove('preview-viewport--pannable', 'preview-viewport--chart-select');
      return;
    }
    const can =
      el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
    const chartSelectActive = isChartSelectToolActive();
    el.classList.toggle('preview-viewport--chart-select', chartSelectActive);
    const chartBlocksPan = previewMode === 'chart' && chartSelectToolEnabled;
    const allowPanCursor = can && (!chartBlocksPan || chartSpaceHeld);
    el.classList.toggle('preview-viewport--pannable', allowPanCursor);
  }

  function isChartSelectToolActive() {
    return previewMode === 'chart' && chartSelectToolEnabled;
  }

  function setChartSelectToolEnabled(on) {
    chartSelectToolEnabled = !!on;
    if (!chartSelectToolEnabled) clearChartCellSelection();
    updateChartSelectToolUI();
    updatePreviewPanState();
  }

  function updateChartSelectToolUI() {
    if (!chartSelectToolBtn) return;
    const show = previewMode === 'chart' && !!sourceImage;
    chartSelectToolBtn.hidden = !show;
    chartSelectToolBtn.classList.toggle('active', chartSelectToolEnabled);
    chartSelectToolBtn.setAttribute('aria-pressed', chartSelectToolEnabled ? 'true' : 'false');
    chartSelectToolBtn.disabled = !show;
  }

  function clearChartCellSelection() {
    chartCellSelection.clear();
    chartSelecting = false;
    chartSelectAnchor = null;
    chartSelectBaseSelection = null;
    chartFillPickerActive = false;
    syncChartSelectionOverlay();
  }

  function resetChartFill() {
    chartFill = { hex: '#ffffff', enabled: true, opacity: 100 };
    chartFillPickerActive = false;
    syncChartFillRowUI();
  }

  function updateChartFillSection() {
    const show = isChartSelectToolActive() && chartCellSelection.size > 0;
    if (chartFillBlock) chartFillBlock.hidden = !show;
    if (show) syncChartFillRowUI();
  }

  function syncChartFillRowUI() {
    if (!chartFillChip || !chartFillHexInput || !chartFillEyeBtn || !chartFillRow) return;
    const hex = normalizeHex(chartFill.hex);
    const displayHex = chartFill.enabled ? hex : '#ffffff';
    chartFillChip.style.background = displayHex;
    chartFillHexInput.value = displayHex.toUpperCase();
    chartFillRow.classList.toggle('disabled', !chartFill.enabled);
    chartFillEyeBtn.classList.toggle('off', !chartFill.enabled);
    chartFillEyeBtn.title = chartFill.enabled ? 'Hide fill on selection' : 'Show fill on selection';
    chartFillEyeBtn.innerHTML = chartFill.enabled
      ? `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z"/><circle cx="10" cy="10" r="2.6"/></svg>`
      : `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l14 14"/><path d="M2 10s3-6 8-6c1.7 0 3.2.6 4.5 1.5"/><path d="M18 10s-3 6-8 6c-1.7 0-3.2-.6-4.5-1.5"/></svg>`;
    if (chartFillAddBtn) {
      chartFillAddBtn.disabled = paletteItems.length >= MAX_PALETTE_COLORS;
    }
  }

  function findNearestPaletteIndex(hex) {
    const [tr, tg, tb] = hexToRgb(normalizeHex(hex));
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < paletteItems.length; i++) {
      const [r, g, b] = hexToRgb(normalizeHex(paletteItems[i].hex));
      const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function resolvePaletteIndexForFill() {
    const hex = chartFill.enabled ? normalizeHex(chartFill.hex) : '#ffffff';
    let idx = paletteItems.findIndex(p => normalizeHex(p.hex) === hex);
    if (idx >= 0) return idx;
    if (paletteItems.length >= MAX_PALETTE_COLORS) return findNearestPaletteIndex(hex);
    paletteItems.push({
      hex,
      enabled: true,
      opacity: chartFill.opacity ?? 100,
    });
    const count = paletteItems.length;
    colorCountInput.value = String(count);
    colorCountNumberInput.value = String(count);
    return paletteItems.length - 1;
  }

  function applyChartFillToSelection({ recordUndo = true } = {}) {
    if (!lastPixelData || chartCellSelection.size === 0) return;
    const paletteIndex = resolvePaletteIndexForFill();
    if (recordUndo) pushUndoHistory();
    for (const key of chartCellSelection) {
      const [col, row] = key.split(',').map(Number);
      lastPixelData.grid[row][col] = paletteIndex;
    }
    if (applyPaletteColorsToLastPixelData()) rerenderPreviewFromLastData();
    renderPaletteEditor();
    syncChartFillRowUI();
  }

  function openChartFillPicker() {
    chartFillPickerActive = true;
    syncPickerFromChartFill();
    openPicker();
  }

  function syncPickerFromChartFill() {
    const hex = chartFill.enabled ? chartFill.hex : '#ffffff';
    const [r, g, b] = hexToRgb(normalizeHex(hex));
    const [h, s, v] = rgbToHsv(r, g, b);
    if (s >= 0.5) {
      hueSlider.value = String(Math.round(h));
      hueVal.textContent = `${Math.round(h)}°`;
    }
    pickerSat = s;
    pickerVal = v;
    const op = clampInt(chartFill.opacity ?? 100, 0, 100, 100);
    opacitySlider.value = String(op);
    opacityVal.textContent = `${op}%`;
    syncPlaneColor();
    updateOpacitySliderTrack();
    updateSVHandle();
  }

  function getGridCellFromPointer(e) {
    if (!lastPixelData) return null;
    const svg = outputContainer.querySelector('svg');
    if (!svg) return null;
    const { cols, rows } = lastPixelData;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x / rect.width) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((y / rect.height) * rows)));
    return { col, row };
  }

  function getChartCellFromPointer(e) {
    if (previewMode !== 'chart') return null;
    return getGridCellFromPointer(e);
  }

  function buildSelectionPaths(selected, stitchSize) {
    if (!selected.size) return { fillD: '', outlineD: '' };

    let fillD = '';
    const has = (c, r) => selected.has(`${c},${r}`);
    const segments = [];

    for (const key of selected) {
      const [col, row] = key.split(',').map(Number);
      const x = col * stitchSize;
      const y = row * stitchSize;
      const s = stitchSize;
      fillD += `M ${x} ${y} h ${s} v ${s} h ${-s} Z `;
      if (!has(col, row - 1)) segments.push([x, y, x + s, y]);
      if (!has(col + 1, row)) segments.push([x + s, y, x + s, y + s]);
      if (!has(col, row + 1)) segments.push([x + s, y + s, x, y + s]);
      if (!has(col - 1, row)) segments.push([x, y + s, x, y]);
    }

    return { fillD: fillD.trim(), outlineD: segmentsToClosedPath(segments) };
  }

  function segmentsToClosedPath(segments) {
    if (!segments.length) return '';

    const edgeKey = (x1, y1, x2, y2) => {
      if (x1 < x2 || (x1 === x2 && y1 <= y2)) return `${x1},${y1}|${x2},${y2}`;
      return `${x2},${y2}|${x1},${y1}`;
    };

    const edges = segments.map(([x1, y1, x2, y2]) => ({
      x1,
      y1,
      x2,
      y2,
      key: edgeKey(x1, y1, x2, y2),
    }));
    const unused = new Set(edges.map(e => e.key));
    const paths = [];

    while (unused.size > 0) {
      const startKey = unused.values().next().value;
      const startEdge = edges.find(e => e.key === startKey);
      unused.delete(startKey);

      let d = `M ${startEdge.x1} ${startEdge.y1} L ${startEdge.x2} ${startEdge.y2}`;
      let cx = startEdge.x2;
      let cy = startEdge.y2;
      const { x1: startX, y1: startY } = startEdge;
      let guard = edges.length + 4;

      while (guard-- > 0 && (cx !== startX || cy !== startY)) {
        let next = null;
        for (const e of edges) {
          if (!unused.has(e.key)) continue;
          if (e.x1 === cx && e.y1 === cy) {
            next = e;
            break;
          }
          if (e.x2 === cx && e.y2 === cy) {
            next = { x1: e.x2, y1: e.y2, x2: e.x1, y2: e.y1, key: e.key };
            break;
          }
        }
        if (!next) break;
        unused.delete(next.key);
        cx = next.x2;
        cy = next.y2;
        d += ` L ${cx} ${cy}`;
      }

      if (cx === startX && cy === startY) d += ' Z';
      paths.push(d);
    }

    return paths.join(' ');
  }

  function scheduleChartSelectionOverlaySync() {
    if (chartSelectionOverlayRaf) return;
    chartSelectionOverlayRaf = requestAnimationFrame(() => {
      chartSelectionOverlayRaf = 0;
      syncChartSelectionOverlay({ lightweight: true });
    });
  }

  function setEyedropperActive(on) {
    eyedropperActive = !!on;
    document.body.classList.toggle('eyedropper-active', eyedropperActive);
    if (previewViewport) previewViewport.classList.toggle('eyedropper-cursor', eyedropperActive);
    if (pickerEyedropperBtn) pickerEyedropperBtn.classList.toggle('active', eyedropperActive);
    if (eyedropperActive && pickerPopover) {
      pickerOpen = false;
      pickerPopover.classList.remove('open');
      pickerPopover.setAttribute('aria-hidden', 'true');
    }
  }

  function sampleGridColorAtCell(col, row) {
    const idx = lastPixelData.grid[row][col];
    const rgb = lastPixelData.colorList[idx];
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }

  function applyPickedColor(hex) {
    const normalized = normalizeHex(hex);
    if (chartFillPickerActive && hasChartCellSelection()) {
      chartFill.hex = normalized;
      chartFill.enabled = true;
      syncChartFillRowUI();
      applyChartFillToSelection({ recordUndo: true });
    } else {
      pushUndoHistory();
      paletteItems[selectedColorIndex].hex = normalized;
      if (sourceImage && lastPixelData) {
        if (applyPaletteColorsToLastPixelData()) rerenderPreviewFromLastData();
        else scheduleLiveRender();
      }
      renderPaletteEditor();
      syncPickerFromSelectedColor();
    }
    openPicker();
  }

  function handleEyedropperPick(e) {
    if (!lastPixelData) return;
    const cell = getGridCellFromPointer(e);
    if (!cell) return;
    applyPickedColor(sampleGridColorAtCell(cell.col, cell.row));
    setEyedropperActive(false);
  }

  function chartCellsInRect(c0, r0, c1, r1) {
    const minC = Math.min(c0, c1);
    const maxC = Math.max(c0, c1);
    const minR = Math.min(r0, r1);
    const maxR = Math.max(r0, r1);
    const cells = [];
    for (let row = minR; row <= maxR; row++) {
      for (let col = minC; col <= maxC; col++) {
        cells.push({ col, row });
      }
    }
    return cells;
  }

  function setChartSelectionRect(c0, r0, c1, r1) {
    chartCellSelection.clear();
    for (const { col, row } of chartCellsInRect(c0, r0, c1, r1)) {
      chartCellSelection.add(`${col},${row}`);
    }
    if (chartSelecting) scheduleChartSelectionOverlaySync();
    else syncChartSelectionOverlay();
  }

  function addChartSelectionRect(c0, r0, c1, r1) {
    for (const { col, row } of chartCellsInRect(c0, r0, c1, r1)) {
      chartCellSelection.add(`${col},${row}`);
    }
    if (chartSelecting) scheduleChartSelectionOverlaySync();
    else syncChartSelectionOverlay();
  }

  function applyChartSelectionFromDrag(cell) {
    if (!chartSelectAnchor) return;
    if (chartSelectBaseSelection) {
      chartCellSelection.clear();
      for (const key of chartSelectBaseSelection) chartCellSelection.add(key);
    } else {
      chartCellSelection.clear();
    }
    for (const { col, row } of chartCellsInRect(
      chartSelectAnchor.col,
      chartSelectAnchor.row,
      cell.col,
      cell.row
    )) {
      chartCellSelection.add(`${col},${row}`);
    }
    scheduleChartSelectionOverlaySync();
  }

  function syncChartSelectionOverlay({ lightweight = false } = {}) {
    if (!chartSelectionLayer) return;
    if (!isChartSelectToolActive() || chartCellSelection.size === 0 || !lastPixelData) {
      chartSelectionLayer.innerHTML = '';
      chartSelectionLayer.style.display = 'none';
      chartSelectionLayer.setAttribute('aria-hidden', 'true');
      updateChartFillSection();
      return;
    }
    const svg = outputContainer.querySelector('svg');
    if (!svg) {
      chartSelectionLayer.innerHTML = '';
      chartSelectionLayer.style.display = 'none';
      updateChartFillSection();
      return;
    }
    const { stitchSize } = lastPixelData;
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const canvasW = vb && vb.width > 0 ? vb.width : lastPixelData.cols * stitchSize;
    const canvasH = vb && vb.height > 0 ? vb.height : lastPixelData.rows * stitchSize;
    const svgRect = svg.getBoundingClientRect();
    const vpRect = previewViewport.getBoundingClientRect();
    chartSelectionLayer.style.display = 'block';
    chartSelectionLayer.style.left = `${svgRect.left - vpRect.left + previewViewport.scrollLeft}px`;
    chartSelectionLayer.style.top = `${svgRect.top - vpRect.top + previewViewport.scrollTop}px`;
    chartSelectionLayer.style.width = `${svgRect.width}px`;
    chartSelectionLayer.style.height = `${svgRect.height}px`;
    chartSelectionLayer.setAttribute('aria-hidden', 'false');

    const { fillD, outlineD } = buildSelectionPaths(chartCellSelection, stitchSize);
    let markup = `<svg width="100%" height="100%" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`;
    if (fillD) markup += `<path class="chart-sel-fill" d="${fillD}"/>`;
    if (outlineD) {
      markup += `<path class="chart-sel-ants-w" d="${outlineD}"/>`;
      markup += `<path class="chart-sel-ants-b" d="${outlineD}"/>`;
    }
    markup += '</svg>';
    chartSelectionLayer.innerHTML = markup;
    if (!lightweight) updateChartFillSection();
  }

  function paintChartSelection(paletteIndex, { recordUndo = true } = {}) {
    if (!lastPixelData || chartCellSelection.size === 0) return;
    if (recordUndo) pushUndoHistory();
    for (const key of chartCellSelection) {
      const [col, row] = key.split(',').map(Number);
      lastPixelData.grid[row][col] = paletteIndex;
    }
    if (applyPaletteColorsToLastPixelData()) rerenderPreviewFromLastData();
    else scheduleLiveRender();
  }

  function hasChartCellSelection() {
    return isChartSelectToolActive() && chartCellSelection.size > 0;
  }

  previewViewport.addEventListener('scroll', () => {
    if (chartCellSelection.size > 0) scheduleChartSelectionOverlaySync();
  });

  previewViewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (placeholder.style.display !== 'none') return;
    if (!outputContainer.querySelector('svg')) return;

    if (eyedropperActive) {
      handleEyedropperPick(e);
      e.preventDefault();
      return;
    }

    const chartMode = previewMode === 'chart';
    const panWithSpace = chartMode && chartSpaceHeld;
    const panWithMiddle = e.button === 1;

    if (chartMode && chartSelectToolEnabled && e.button === 0 && !chartSpaceHeld) {
      const cell = getChartCellFromPointer(e);
      if (cell) {
        chartSelecting = true;
        chartSelectPointerId = e.pointerId;
        chartSelectAnchor = cell;
        chartSelectBaseSelection = e.shiftKey ? new Set(chartCellSelection) : null;
        if (!e.shiftKey) resetChartFill();
        if (e.shiftKey) {
          addChartSelectionRect(cell.col, cell.row, cell.col, cell.row);
        } else {
          setChartSelectionRect(cell.col, cell.row, cell.col, cell.row);
        }
        previewViewport.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (!e.shiftKey) clearChartCellSelection();
    }

    const can =
      previewViewport.scrollWidth > previewViewport.clientWidth + 2 ||
      previewViewport.scrollHeight > previewViewport.clientHeight + 2;
    if (!can) return;
    if (chartMode && chartSelectToolEnabled && !panWithSpace && !panWithMiddle) return;

    previewPanning = true;
    previewPanStartX = e.clientX;
    previewPanStartY = e.clientY;
    previewPanScrollLeft = previewViewport.scrollLeft;
    previewPanScrollTop = previewViewport.scrollTop;
    previewViewport.classList.add('is-panning');
    if (chartMode) previewViewport.classList.add('is-chart-panning');
    previewViewport.setPointerCapture(e.pointerId);
  });

  previewViewport.addEventListener('pointermove', e => {
    if (chartSelecting && e.pointerId === chartSelectPointerId && chartSelectAnchor) {
      const cell = getChartCellFromPointer(e) || chartSelectAnchor;
      applyChartSelectionFromDrag(cell);
      return;
    }
    if (!previewPanning) return;
    const dx = e.clientX - previewPanStartX;
    const dy = e.clientY - previewPanStartY;
    previewViewport.scrollLeft = previewPanScrollLeft - dx;
    previewViewport.scrollTop = previewPanScrollTop - dy;
  });

  function endPreviewPan(e) {
    if (chartSelecting && e.pointerId === chartSelectPointerId) {
      chartSelecting = false;
      chartSelectPointerId = null;
      chartSelectAnchor = null;
      chartSelectBaseSelection = null;
      try {
        previewViewport.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      syncChartSelectionOverlay();
      return;
    }
    if (!previewPanning) return;
    previewPanning = false;
    previewViewport.classList.remove('is-panning', 'is-chart-panning');
    try {
      previewViewport.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
  }

  previewViewport.addEventListener('pointerup', endPreviewPan);
  previewViewport.addEventListener('pointercancel', endPreviewPan);
  window.addEventListener('resize', () => {
    if (outputContainer.querySelector('svg')) {
      applyPreviewSizing();
      updatePreviewPanState();
    }
  });

  if (previewKnitBtn) {
    previewKnitBtn.addEventListener('click', () => {
      if (previewMode === 'swatch') return;
      pushUndoHistory();
      setPreviewMode('swatch');
    });
  }
  if (previewChartBtn) {
    previewChartBtn.addEventListener('click', () => {
      if (previewMode === 'chart') return;
      pushUndoHistory();
      setPreviewMode('chart');
    });
  }

  if (chartSelectToolBtn) {
    chartSelectToolBtn.addEventListener('click', () => {
      if (previewMode !== 'chart' || !sourceImage) return;
      setChartSelectToolEnabled(!chartSelectToolEnabled);
    });
  }

  if (chartFillRow) {
    chartFillRow.addEventListener('click', e => {
      if (e.target.closest('button, input')) return;
      if (!hasChartCellSelection()) return;
      openChartFillPicker();
    });
  }
  if (chartFillHexInput) {
    chartFillHexInput.addEventListener('click', e => e.stopPropagation());
    chartFillHexInput.addEventListener('input', e => {
      e.stopPropagation();
      const val = chartFillHexInput.value.trim();
      if (!/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(val)) return;
      pushUndoHistory();
      chartFill.hex = normalizeHex(val);
      chartFill.enabled = true;
      syncChartFillRowUI();
      applyChartFillToSelection({ recordUndo: false });
    });
    chartFillHexInput.addEventListener('blur', () => {
      const hex = chartFill.enabled ? chartFill.hex : '#ffffff';
      chartFillHexInput.value = normalizeHex(hex).toUpperCase();
    });
  }
  if (chartFillEyeBtn) {
    chartFillEyeBtn.addEventListener('click', e => {
      e.stopPropagation();
      pushUndoHistory();
      chartFill.enabled = !chartFill.enabled;
      syncChartFillRowUI();
      applyChartFillToSelection({ recordUndo: false });
    });
  }
  if (chartFillAddBtn) {
    chartFillAddBtn.addEventListener('click', e => {
      e.stopPropagation();
      const hex = normalizeHex(chartFill.enabled ? chartFill.hex : '#ffffff');
      pushUndoHistory();
      let idx = paletteItems.findIndex(p => normalizeHex(p.hex) === hex);
      if (idx < 0) {
        if (paletteItems.length >= MAX_PALETTE_COLORS) return;
        paletteItems.push({
          hex,
          enabled: true,
          opacity: chartFill.opacity ?? 100,
        });
        idx = paletteItems.length - 1;
        colorCountInput.value = String(paletteItems.length);
        colorCountNumberInput.value = String(paletteItems.length);
      }
      selectedColorIndex = idx;
      chartFillPickerActive = false;
      applyChartFillToSelection({ recordUndo: false });
      renderPaletteEditor();
      setPaletteToolbarState();
    });
  }

  undoBtn.addEventListener('click', () => undo());
  redoBtn.addEventListener('click', () => redo());

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  });

  downloadBtn.addEventListener('click', openExportModal);

  if (exportModalClose) exportModalClose.addEventListener('click', closeExportModal);
  if (exportConfirmBtn) exportConfirmBtn.addEventListener('click', () => {
    closeExportModal();
    downloadActive();
  });
  if (exportModal) {
    exportModal.addEventListener('click', e => {
      if (e.target === exportModal) closeExportModal();
    });
  }
  if (exportWidthInput && exportHeightInput) {
    exportWidthInput.addEventListener('input', () => {
      if (syncingExportSize) return;
      syncingExportSize = true;
      const w = clampInt(exportWidthInput.value, 1, 8192, 300);
      exportWidthInput.value = String(w);
      exportHeightInput.value = String(Math.max(1, Math.round(w / exportAspect)));
      syncingExportSize = false;
    });
    exportHeightInput.addEventListener('input', () => {
      if (syncingExportSize) return;
      syncingExportSize = true;
      const h = clampInt(exportHeightInput.value, 1, 8192, 300);
      exportHeightInput.value = String(h);
      exportWidthInput.value = String(Math.max(1, Math.round(h * exportAspect)));
      syncingExportSize = false;
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && exportModal?.classList.contains('open')) closeExportModal();
  });

  /* ─── File drop & browse ─────────────────────────────────── */
  placeholder.addEventListener('click', e => {
    e.stopPropagation();
    hiddenInput.value = '';
    hiddenInput.click();
  });

  // Fallback: click anywhere on empty canvas to upload.
  canvasArea.addEventListener('click', e => {
    if (placeholder.style.display === 'none') return;
    if (e.target.closest('button, input, select, label')) return;
    hiddenInput.value = '';
    hiddenInput.click();
  });

  canvasArea.addEventListener('dblclick', () => {
    hiddenInput.value = '';
    hiddenInput.click();
  });

  /** Finder / OS X sometimes omits MIME; still allow common image extensions. */
  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(file.name);
  }

  function getFirstImageFile(dataTransfer) {
    if (!dataTransfer) return null;
    if (dataTransfer.items && dataTransfer.items.length) {
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i];
        if (item.kind !== 'file') continue;
        const f = item.getAsFile && item.getAsFile();
        if (f && isImageFile(f)) return f;
      }
    }
    if (dataTransfer.files && dataTransfer.files.length) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const f = dataTransfer.files[i];
        if (isImageFile(f)) return f;
      }
    }
    return null;
  }

  function hasDroppablePayload(dataTransfer) {
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types || []);
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
  }

  function getDroppedImageUrl(dataTransfer) {
    if (!dataTransfer) return '';
    const uriList = dataTransfer.getData('text/uri-list') || '';
    const plain = dataTransfer.getData('text/plain') || '';
    const candidate = (uriList.split('\n').find(Boolean) || plain || '').trim();
    if (!candidate) return '';
    if (!/^https?:\/\//i.test(candidate)) return '';
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(candidate)) return candidate;
    return candidate;
  }

  function loadImageFromUrl(url) {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      c.toBlob(blob => {
        if (!blob) {
          pulseStatus('Could not import dropped image URL');
          return;
        }
        const ext = (url.match(/\.(png|jpe?g|gif|webp|bmp|svg|avif)/i) || [,'png'])[1];
        const f = new File([blob], `dropped-image.${ext.toLowerCase()}`, { type: blob.type || 'image/png' });
        loadImage(f);
      });
    };
    img.onerror = () => pulseStatus('Could not load dropped image URL');
    img.src = url;
  }

  /**
   * Bind drag/drop directly on #canvasArea in the capture phase.
   * Document-level + clientX/Y hit-testing breaks on some browsers (drop coords wrong / no drop).
   * preventDefault on dragover must run for the actual drop target subtree.
   */
  canvasArea.addEventListener(
    'dragenter',
    e => {
      e.preventDefault();
      e.stopPropagation();
      const ok = hasDroppablePayload(e.dataTransfer);
      if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
      canvasArea.classList.toggle('dragover', ok);
    },
    true
  );

  canvasArea.addEventListener(
    'dragover',
    e => {
      e.preventDefault();
      e.stopPropagation();
      const ok = hasDroppablePayload(e.dataTransfer);
      if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
      canvasArea.classList.toggle('dragover', ok);
    },
    true
  );

  canvasArea.addEventListener(
    'dragleave',
    e => {
      const to = e.relatedTarget;
      if (to && canvasArea.contains(to)) return;
      canvasArea.classList.remove('dragover');
    },
    true
  );

  canvasArea.addEventListener(
    'drop',
    e => {
      e.preventDefault();
      e.stopPropagation();
      canvasArea.classList.remove('dragover');
      const file = getFirstImageFile(e.dataTransfer);
      if (file) loadImage(file);
      else {
        const url = getDroppedImageUrl(e.dataTransfer);
        if (url) loadImageFromUrl(url);
        else pulseStatus('Drop an image file to add it');
      }
    },
    true
  );

  // Prevent the browser from navigating away when file is dropped outside target.
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());

  document.addEventListener('dragend', () => {
    canvasArea.classList.remove('dragover');
  });

  hiddenInput.addEventListener('change', () => {
    if (hiddenInput.files && hiddenInput.files[0]) loadImage(hiddenInput.files[0]);
    else pulseStatus('No image selected');
  });

  /* ─── Core functions ─────────────────────────────────────── */

  function clearImage() {
    sourceImage = null;
    lastPixelData = null;
    outputContainer.innerHTML = '';
    outputContainer.style.display = 'none';
    placeholder.style.display = 'flex';
    downloadBtn.disabled = true;
    clearImageBtn.disabled = true;
    hiddenInput.value = '';
    setChartSelectToolEnabled(false);
    previewZoom = 1;
    previewViewport.scrollLeft = 0;
    previewViewport.scrollTop = 0;
    setZoomControlsDisabled(true);
    paletteItems = [{ hex: '#ffffff', enabled: true, opacity: 100 }];
    selectedColorIndex = 0;
    colorCountInput.value = '1';
    colorCountNumberInput.value = '1';
    renderPaletteEditor();
    setPaletteToolbarState();
    resetHistoryStacks();
  }

  function loadImage(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        sourceImage = img;
        previewZoom = 1;
        resetPreviewScrollNext = true;
        clearImageBtn.disabled = false;
        stitchSizeInput.value = '4';
        stitchSizeNumberInput.value = '4';
        colorCountInput.value = String(MAX_PALETTE_COLORS);
        colorCountNumberInput.value = String(MAX_PALETTE_COLORS);
        gridToggle.classList.add('on');
        pulseStatus(`${img.width} × ${img.height}px — ready`);
        paletteItems = extractPaletteFromImage(parseInt(colorCountInput.value, 10));
        selectedColorIndex = 0;
        renderPaletteEditor();
        setPaletteToolbarState();
        resetHistoryStacks();
        renderActive();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /** After palette hex/visibility edits only: update RGB list without re-quantizing pixels. */
  function applyPaletteColorsToLastPixelData() {
    if (!lastPixelData || !paletteItems.length) return false;
    if (lastPixelData.colorList.length !== paletteItems.length) return false;
    for (let i = 0; i < paletteItems.length; i++) {
      const hex = normalizeHex(paletteItems[i].hex);
      const [r, g, b] = hexToRgb(hex);
      const a = Math.max(0, Math.min(100, paletteItems[i].opacity ?? 100)) / 100;
      const rr = Math.round(r * a + 255 * (1 - a));
      const gg = Math.round(g * a + 255 * (1 - a));
      const bb = Math.round(b * a + 255 * (1 - a));
      lastPixelData.colorList[i] = paletteItems[i].enabled ? [rr, gg, bb] : [255, 255, 255];
    }
    return true;
  }

  function commitPreviewOutput() {
    const showGrid = previewMode === 'chart' && gridToggle.classList.contains('on');
    const showTexture = textureToggle.classList.contains('on');
    outputContainer.innerHTML = renderPreview(lastPixelData, previewMode, currentStitch, showGrid, showTexture);
    outputContainer.classList.toggle('preview-chart', previewMode === 'chart');
    outputContainer.style.display = 'flex';

    placeholder.style.display = 'none';
    downloadBtn.disabled = false;
    if (resetPreviewScrollNext) {
      previewViewport.scrollLeft = 0;
      previewViewport.scrollTop = 0;
      resetPreviewScrollNext = false;
    }
    applyPreviewSizing();
    updatePreviewPanState();
    requestAnimationFrame(() => syncChartSelectionOverlay());
    updateChartSelectToolUI();
  }

  function rerenderPreviewFromLastData() {
    if (!sourceImage || !lastPixelData) return;
    commitPreviewOutput();
  }

  function renderActive(showOverlay = true) {
    if (!sourceImage) return;

    if (showOverlay) {
      processingMsg.textContent = 'Weaving stitches...';
      processingOverlay.style.display = 'flex';
    } else {
      processingOverlay.style.display = 'none';
    }

    setTimeout(() => {
      const stitchSize = clampInt(stitchSizeInput.value, 1, 8, 4);
      const colorCount = parseInt(colorCountInput.value, 10);

      const paletteForQuant = paletteItems.map(p => normalizeHex(p.hex));
      const paletteEnabled = paletteItems.map(p => p.enabled);
      lastPixelData = buildPixelGrid(
        sourceImage,
        stitchSize,
        colorCount,
        'original',
        paletteForQuant,
        paletteEnabled
      );
      commitPreviewOutput();

      processingOverlay.style.display = 'none';
    }, showOverlay ? 40 : 0);
  }

  function scheduleLiveRender() {
    if (!sourceImage) return;
    if (liveRenderTimer) clearTimeout(liveRenderTimer);
    liveRenderTimer = setTimeout(() => renderActive(false), 70);
  }

  function getSvgNaturalSize(svgEl) {
    const wAttr = svgEl.getAttribute('width');
    const hAttr = svgEl.getAttribute('height');
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    let w = wAttr ? parseFloat(wAttr) : NaN;
    let h = hAttr ? parseFloat(hAttr) : NaN;
    if (!Number.isFinite(w) || w <= 0) {
      if (vb && vb.width > 0) w = vb.width;
      else if (lastPixelData) w = lastPixelData.cols * lastPixelData.stitchSize;
      else w = 300;
    }
    if (!Number.isFinite(h) || h <= 0) {
      if (vb && vb.height > 0) h = vb.height;
      else if (lastPixelData) h = lastPixelData.rows * lastPixelData.stitchSize;
      else h = 300;
    }
    return {
      w: Math.min(8192, Math.max(1, Math.round(w))),
      h: Math.min(8192, Math.max(1, Math.round(h))),
    };
  }

  function cloneSvgForExport(svgEl, w, h) {
    const clone = svgEl.cloneNode(true);
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    }
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    return clone;
  }

  function getExportPixelSize() {
    const scale = parseFloat(exportScaleSelect?.value) || 1;
    const baseW = clampInt(exportWidthInput?.value, 1, 8192, 300);
    const baseH = clampInt(exportHeightInput?.value, 1, 8192, 300);
    return {
      w: Math.min(8192, Math.max(1, Math.round(baseW * scale))),
      h: Math.min(8192, Math.max(1, Math.round(baseH * scale))),
    };
  }

  function openExportModal() {
    if (!lastPixelData) return;
    const svgEl = outputContainer.querySelector('svg');
    if (!svgEl) return;
    const { w, h } = getSvgNaturalSize(svgEl);
    exportAspect = w / h;
    if (exportWidthInput) exportWidthInput.value = String(w);
    if (exportHeightInput) exportHeightInput.value = String(h);
    if (exportScaleSelect) exportScaleSelect.value = '1';
    if (exportFormatSelect) exportFormatSelect.value = 'jpeg';
    if (exportModal) {
      exportModal.hidden = false;
      exportModal.setAttribute('aria-hidden', 'false');
      exportModal.classList.add('open');
    }
  }

  function closeExportModal() {
    if (!exportModal) return;
    exportModal.classList.remove('open');
    exportModal.hidden = true;
    exportModal.setAttribute('aria-hidden', 'true');
  }

  function serializeSvgString(svgEl) {
    const serialize = new XMLSerializer();
    let xml = serialize.serializeToString(svgEl);
    if (!xml.includes('xmlns="http://www.w3.org/2000/svg"')) {
      xml = xml.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return xml;
  }

  function triggerDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  function downloadSvgAsJpeg(svgEl, exportW, exportH) {
    return new Promise((resolve, reject) => {
      const natural = getSvgNaturalSize(svgEl);
      const w = exportW ?? natural.w;
      const h = exportH ?? natural.h;
      const exportSvg = cloneSvgForExport(svgEl, w, h);
      const xml = serializeSvgString(exportSvg);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = previewMode === 'chart' ? '#ffffff' : '#2a2a2a';
        ctx.fillRect(0, 0, w, h);
        try {
          ctx.drawImage(img, 0, 0, w, h);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
          return;
        }
        canvas.toBlob(
          out => {
            URL.revokeObjectURL(url);
            if (out) resolve(out);
            else reject(new Error('toBlob failed'));
          },
          'image/jpeg',
          0.92
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('svg raster failed'));
      };
      img.src = url;
    });
  }

  function downloadSvgAsPng(svgEl, exportW, exportH) {
    return new Promise((resolve, reject) => {
      const natural = getSvgNaturalSize(svgEl);
      const w = exportW ?? natural.w;
      const h = exportH ?? natural.h;
      const exportSvg = cloneSvgForExport(svgEl, w, h);
      const xml = serializeSvgString(exportSvg);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // PNG keeps transparent background for easier reuse.
        try {
          ctx.drawImage(img, 0, 0, w, h);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
          return;
        }
        canvas.toBlob(
          out => {
            URL.revokeObjectURL(url);
            if (out) resolve(out);
            else reject(new Error('toBlob failed'));
          },
          'image/png'
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('svg raster failed'));
      };
      img.src = url;
    });
  }

  function downloadActive() {
    if (!lastPixelData) return;

    const svgEl = outputContainer.querySelector('svg');
    if (!svgEl) return;

    const tag = previewMode === 'chart' ? 'chart' : 'swatch';
    const format = exportFormatSelect ? exportFormatSelect.value : 'jpeg';
    const { w, h } = getExportPixelSize();
    const exportSvg = cloneSvgForExport(svgEl, w, h);

    if (format === 'svg') {
      const xml = serializeSvgString(exportSvg);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      triggerDownloadBlob(blob, `knit-artwork-${tag}.svg`);
      return;
    }

    if (format === 'png') {
      downloadSvgAsPng(svgEl, w, h).then(
        blob => triggerDownloadBlob(blob, `knit-artwork-${tag}.png`),
        () => {
          const xml = serializeSvgString(exportSvg);
          const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
          triggerDownloadBlob(blob, `knit-artwork-${tag}.svg`);
        }
      );
      return;
    }

    downloadSvgAsJpeg(svgEl, w, h).then(
      blob => triggerDownloadBlob(blob, `knit-artwork-${tag}.jpg`),
      () => {
        const xml = serializeSvgString(exportSvg);
        const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        triggerDownloadBlob(blob, `knit-artwork-${tag}.svg`);
      }
    );
  }

  function setPreviewMode(mode) {
    previewMode = mode;
    if (previewKnitBtn) previewKnitBtn.classList.toggle('active', mode === 'swatch');
    if (previewChartBtn) previewChartBtn.classList.toggle('active', mode === 'chart');
    if (mode !== 'chart') setChartSelectToolEnabled(false);
    else updateChartSelectToolUI();
    updateOptionVisibility();
    updatePreviewPanState();
    scheduleLiveRender();
  }

  function updateOptionVisibility() {
    const swatch = previewMode === 'swatch';
    textureRow.classList.toggle('is-hidden', !swatch);
    gridRow.classList.toggle('is-hidden', swatch);
  }

  function setZoomControlsDisabled(disabled) {
    zoomInBtn.disabled = disabled;
    zoomOutBtn.disabled = disabled;
    zoomInput.disabled = disabled;
    if (disabled) zoomInput.value = '100%';
  }

  function applyPreviewSizing() {
    const svg = outputContainer.querySelector('svg');
    if (!svg || !previewViewport) {
      setZoomControlsDisabled(true);
      return;
    }

    const vb = svg.viewBox && svg.viewBox.baseVal;
    const w = vb && vb.width > 0 ? vb.width : parseFloat(svg.getAttribute('width')) || 300;
    const h = vb && vb.height > 0 ? vb.height : parseFloat(svg.getAttribute('height')) || 300;

    const vpW = Math.max(1, previewViewport.clientWidth - 16);
    const vpH = Math.max(1, previewViewport.clientHeight - 16);

    const fit = Math.min(vpW / w, vpH / h, 1);
    const scale = fit * previewZoom;
    const dispW = w * scale;
    const dispH = h * scale;

    svg.setAttribute('width', String(dispW));
    svg.setAttribute('height', String(dispH));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    if (document.activeElement !== zoomInput) formatZoomField();
    setZoomControlsDisabled(false);
    requestAnimationFrame(() => {
      updatePreviewPanState();
      syncChartSelectionOverlay();
    });
  }

  function renderPaletteEditor() {
    paletteEditor.innerHTML = '';

    if (!paletteItems.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = 'No colors in palette.';
      paletteEditor.appendChild(empty);
      return;
    }

    selectedColorIndex = Math.max(0, Math.min(selectedColorIndex, paletteItems.length - 1));
    syncPickerFromSelectedColor();

    paletteItems.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'palette-row';
      if (idx === selectedColorIndex) row.classList.add('active');
      if (!item.enabled) row.classList.add('disabled');
      row.addEventListener('click', () => {
        selectedColorIndex = idx;
        chartFillPickerActive = false;
        openPicker();
        renderPaletteEditor();
      });

      const chip = document.createElement('div');
      chip.className = 'palette-chip';
      chip.style.background = item.hex;

      const hexWrap = document.createElement('div');
      hexWrap.className = 'palette-hex-wrap';

      const hexInput = document.createElement('input');
      hexInput.type = 'text';
      hexInput.className = 'palette-hex-input';
      hexInput.value = normalizeHex(item.hex).toUpperCase();
      hexInput.spellcheck = false;
      hexInput.autocomplete = 'off';
      hexInput.title = 'Type any hex color (e.g. #FF6A7A)';
      hexInput.addEventListener('click', e => e.stopPropagation());
      hexInput.addEventListener('input', e => {
        e.stopPropagation();
        const val = hexInput.value.trim();
        if (!/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(val)) return;
        pushUndoHistory();
        paletteItems[idx].hex = normalizeHex(val);
        if (sourceImage && lastPixelData) {
          if (applyPaletteColorsToLastPixelData()) rerenderPreviewFromLastData();
          else scheduleLiveRender();
        }
        renderPaletteEditor();
      });
      hexInput.addEventListener('blur', () => {
        hexInput.value = normalizeHex(paletteItems[idx].hex).toUpperCase();
      });

      hexWrap.appendChild(hexInput);

      const eyeBtn = document.createElement('button');
      eyeBtn.className = `eye-btn ${item.enabled ? '' : 'off'}`.trim();
      eyeBtn.title = item.enabled ? 'Hide color' : 'Show color';
      eyeBtn.innerHTML = item.enabled
        ? `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z"/><circle cx="10" cy="10" r="2.6"/></svg>`
        : `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l14 14"/><path d="M2 10s3-6 8-6c1.7 0 3.2.6 4.5 1.5"/><path d="M18 10s-3 6-8 6c-1.7 0-3.2-.6-4.5-1.5"/></svg>`;
      eyeBtn.addEventListener('click', e => {
        e.stopPropagation();
        paletteItems[idx].enabled = !paletteItems[idx].enabled;
        renderPaletteEditor();
        if (sourceImage && lastPixelData) {
          if (applyPaletteColorsToLastPixelData()) rerenderPreviewFromLastData();
          else scheduleLiveRender();
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'inline-remove-btn';
      removeBtn.textContent = '−';
      removeBtn.disabled = paletteItems.length <= 1;
      removeBtn.title = 'Remove color — stitches remap to nearest remaining palette color';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (paletteItems.length <= 1) return;
        pushUndoHistory();
        const removed = idx;
        paletteItems.splice(removed, 1);
        if (selectedColorIndex > removed) selectedColorIndex--;
        else if (selectedColorIndex === removed)
          selectedColorIndex = Math.min(selectedColorIndex, paletteItems.length - 1);
        renderPaletteEditor();
        scheduleLiveRender();
      });

      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'palette-row-add';
      insertBtn.setAttribute('aria-label', 'Add color after');
      insertBtn.title = 'Add color after';
      insertBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
      insertBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (paletteItems.length >= MAX_PALETTE_COLORS) return;
        pushUndoHistory();
        const base = paletteItems[idx].hex;
        paletteItems.splice(idx + 1, 0, {
          hex: base,
          enabled: true,
          opacity: paletteItems[idx].opacity ?? 100,
        });
        selectedColorIndex = idx + 1;
        renderPaletteEditor();
        scheduleLiveRender();
      });

      const actionGroup = document.createElement('div');
      actionGroup.className = 'row-actions';
      actionGroup.appendChild(eyeBtn);
      actionGroup.appendChild(removeBtn);

      const trailing = document.createElement('div');
      trailing.className = 'palette-row-trailing';
      trailing.appendChild(insertBtn);
      trailing.appendChild(actionGroup);

      row.appendChild(chip);
      row.appendChild(hexWrap);
      row.appendChild(trailing);
      paletteEditor.appendChild(row);
    });

    setPaletteToolbarState();
  }

  function extractPaletteFromImage(count) {
    const safeCount = Math.max(1, Math.min(MAX_PALETTE_COLORS, count | 0));
    const sample = document.createElement('canvas');
    sample.width = 120;
    sample.height = Math.max(1, Math.round(120 * sourceImage.height / sourceImage.width));
    const sctx = sample.getContext('2d');
    sctx.drawImage(sourceImage, 0, 0, sample.width, sample.height);
    const imgData = sctx.getImageData(0, 0, sample.width, sample.height);
    const centers = kMeansColors(imgData, safeCount);
    return centers.map(([r, g, b]) => ({ hex: rgbToHex(r, g, b), enabled: true, opacity: 100 }));
  }

  function clampInt(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function syncPickerFromSelectedColor() {
    const selected = paletteItems[selectedColorIndex];
    if (!selected) return;
    const [r, g, b] = hexToRgb(selected.hex);
    const [h, s, v] = rgbToHsv(r, g, b);
    /** Achromatic RGB has undefined hue; keep slider so raising saturation keeps the chosen hue. */
    if (s >= 0.5) {
      hueSlider.value = String(Math.round(h));
      hueVal.textContent = `${Math.round(h)}°`;
    }
    pickerSat = s;
    pickerVal = v;
    const op = clampInt(selected.opacity ?? 100, 0, 100, 100);
    opacitySlider.value = String(op);
    opacityVal.textContent = `${op}%`;
    syncPlaneColor();
    updateOpacitySliderTrack();
    updateSVHandle();

  }

  function syncPlaneColor() {
    const hue = parseInt(hueSlider.value, 10);
    svPlane.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
  }

  function updateSVFromPointer(event) {
    const rect = svPlane.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    pickerSat = (x / rect.width) * 100;
    pickerVal = 100 - (y / rect.height) * 100;
    updateSVHandle();
    updateColorFromPicker();
  }

  function updateSVHandle() {
    svHandle.style.left = `${pickerSat}%`;
    svHandle.style.top = `${100 - pickerVal}%`;
  }

  function updateOpacitySliderTrack() {
    const hue = parseInt(hueSlider.value, 10);
    const opaque = `hsl(${hue}, ${Math.max(20, pickerSat)}%, ${Math.max(25, pickerVal * 0.5)}%)`;
    opacitySlider.style.background =
      `linear-gradient(45deg, rgba(0,0,0,.06) 25%, transparent 25%) 0 0 / 8px 8px,` +
      `linear-gradient(-45deg, rgba(0,0,0,.06) 25%, transparent 25%) 0 0 / 8px 8px,` +
      `linear-gradient(to right, rgba(120,120,120,0), ${opaque})`;
  }

  function updateColorFromPicker() {
    if (!paletteItems.length) return;
    const hue = parseInt(hueSlider.value, 10);
    const hex = normalizeHex(hsvToHex(hue, pickerSat, pickerVal));
    const opacity = clampInt(opacitySlider.value, 0, 100, 100);

    if (chartFillPickerActive && hasChartCellSelection()) {
      chartFill.hex = hex;
      chartFill.opacity = opacity;
      chartFill.enabled = true;
      syncChartFillRowUI();
      if (sourceImage && lastPixelData) {
        applyChartFillToSelection({ recordUndo: !chartPickerPaintUndoPushed });
        if (!chartPickerPaintUndoPushed) chartPickerPaintUndoPushed = true;
      }
      return;
    }

    chartFillPickerActive = false;
    paletteItems[selectedColorIndex].hex = hex;
    paletteItems[selectedColorIndex].opacity = opacity;
    if (sourceImage && lastPixelData) {
      if (applyPaletteColorsToLastPixelData()) rerenderPreviewFromLastData();
      else scheduleLiveRender();
    }
    renderPaletteEditor();
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;

    if (d !== 0) {
      if (max === rn) h = 60 * (((gn - bn) / d) % 6);
      else if (max === gn) h = 60 * (((bn - rn) / d) + 2);
      else h = 60 * (((rn - gn) / d) + 4);
    }
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : (d / max) * 100;
    const v = max * 100;
    return [h, s, v];
  }

  function hsvToHex(h, s, v) {
    let hn = h % 360;
    if (hn < 0) hn += 360;

    const sn = s / 100;
    const vn = v / 100;
    const c = vn * sn;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = vn - c;
    let r = 0, g = 0, b = 0;

    if (hn < 60) [r, g, b] = [c, x, 0];
    else if (hn < 120) [r, g, b] = [x, c, 0];
    else if (hn < 180) [r, g, b] = [0, c, x];
    else if (hn < 240) [r, g, b] = [0, x, c];
    else if (hn < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return rgbToHex(
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    );
  }

  function openPicker() {
    pickerOpen = true;
    pickerPopover.classList.add('open');
    pickerPopover.setAttribute('aria-hidden', 'false');
  }

  function closePicker() {
    pickerOpen = false;
    pickerPopover.classList.remove('open');
    pickerPopover.setAttribute('aria-hidden', 'true');
    setEyedropperActive(false);
  }

  function togglePicker() {
    if (pickerOpen) closePicker();
    else openPicker();
  }

  syncPlaneColor();
  updateOptionVisibility();
  updateChartSelectToolUI();
  renderPaletteEditor();
  setZoomControlsDisabled(true);

  {
    const ss = clampInt(stitchSizeInput.value, 1, 8, 4);
    stitchSizeInput.value = String(ss);
    stitchSizeNumberInput.value = String(ss);
  }
  {
    const cc = clampInt(colorCountInput.value, 1, MAX_PALETTE_COLORS, 1);
    colorCountInput.value = String(cc);
    colorCountNumberInput.value = String(cc);
  }

  updateUndoRedoButtons();
  setPaletteToolbarState();
  setupInteractiveFeedback();
})();
