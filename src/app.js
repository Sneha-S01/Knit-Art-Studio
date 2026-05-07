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
  let paletteItems = [{ hex: '#ffffff', enabled: true }];
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
  let resetPreviewScrollNext = false;

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
  const previewSwatchBtn = document.getElementById('previewSwatchBtn');
  const previewChartBtn = document.getElementById('previewChartBtn');
  const statusBar = document.getElementById('statusBar');
  const processingOverlay = document.getElementById('processingOverlay');
  const processingMsg = document.getElementById('processingMsg');
  const canvasArea = document.getElementById('canvasArea');
  const hiddenInput = document.getElementById('hiddenInput');
  const stitchSizeInput = document.getElementById('stitchSize');
  const stitchSizeNumberInput = document.getElementById('stitchSizeInput');
  const stitchSizeVal = document.getElementById('stitchSizeVal');
  const colorCountInput = document.getElementById('colorCount');
  const colorCountNumberInput = document.getElementById('colorCountInput');
  const colorCountVal = document.getElementById('colorCountVal');
  const gridToggle = document.getElementById('gridToggle');
  const textureToggle = document.getElementById('textureToggle');
  const paletteEditor = document.getElementById('paletteEditor');
  const addColorBtn = document.getElementById('addColorBtn');
  const pickerTrigger = document.getElementById('pickerTrigger');
  const pickerPopover = document.getElementById('pickerPopover');
  const svPlane = document.getElementById('svPlane');
  const svHandle = document.getElementById('svHandle');
  const hueSlider = document.getElementById('hueSlider');
  const hueVal = document.getElementById('hueVal');
  const previewViewport = document.getElementById('previewViewport');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomInput = document.getElementById('zoomInput');
  const clearImageBtn = document.getElementById('clearImageBtn');
  const selectToolBtn = document.getElementById('selectToolBtn');
  const copySelectionBtn = document.getElementById('copySelectionBtn');
  const pasteSelectionBtn = document.getElementById('pasteSelectionBtn');
  const downloadFormatSelect = document.getElementById('downloadFormat');
  const textureRow = document.getElementById('textureRow');
  const gridRow = document.getElementById('gridRow');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const selectionOverlay = document.createElement('div');
  selectionOverlay.className = 'selection-overlay';
  previewViewport.appendChild(selectionOverlay);

  let selectToolEnabled = false;
  let selecting = false;
  let selectionRect = null;
  let copiedPatch = null;
  let selectionStartCell = null;

  function pulseStatus(message) {
    statusBar.textContent = message;
    statusBar.classList.remove('status-bar--live');
    void statusBar.offsetWidth;
    statusBar.classList.add('status-bar--live');
  }

  function setupInteractiveFeedback() {
    document.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('pointerdown', () => btn.classList.add('is-pressed'));
      const clear = () => btn.classList.remove('is-pressed');
      btn.addEventListener('pointerup', clear);
      btn.addEventListener('pointerleave', clear);
      btn.addEventListener('pointercancel', clear);
    });
  }

  function setCollageControlsState(hasImage) {
    selectToolBtn.disabled = !hasImage;
    copySelectionBtn.disabled = !hasImage || !selectionRect;
    pasteSelectionBtn.disabled = !hasImage || !copiedPatch;
  }

  function clearSelection() {
    selectionRect = null;
    selecting = false;
    selectionStartCell = null;
    selectionOverlay.style.display = 'none';
    copySelectionBtn.disabled = true;
  }

  function getSvgCellFromPointer(event) {
    if (!lastPixelData) return null;
    const svg = outputContainer.querySelector('svg');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    const x = Math.max(0, Math.min(lastPixelData.cols - 1, Math.floor(nx * lastPixelData.cols)));
    const y = Math.max(0, Math.min(lastPixelData.rows - 1, Math.floor(ny * lastPixelData.rows)));
    return { x, y, rect };
  }

  function updateSelectionOverlay() {
    if (!selectionRect || !lastPixelData) {
      selectionOverlay.style.display = 'none';
      return;
    }
    const svg = outputContainer.querySelector('svg');
    if (!svg) {
      selectionOverlay.style.display = 'none';
      return;
    }
    const svgRect = svg.getBoundingClientRect();
    const vpRect = previewViewport.getBoundingClientRect();
    const cellW = svgRect.width / lastPixelData.cols;
    const cellH = svgRect.height / lastPixelData.rows;
    selectionOverlay.style.left = `${(svgRect.left - vpRect.left) + selectionRect.x * cellW + previewViewport.scrollLeft}px`;
    selectionOverlay.style.top = `${(svgRect.top - vpRect.top) + selectionRect.y * cellH + previewViewport.scrollTop}px`;
    selectionOverlay.style.width = `${Math.max(1, selectionRect.w * cellW)}px`;
    selectionOverlay.style.height = `${Math.max(1, selectionRect.h * cellH)}px`;
    selectionOverlay.style.display = 'block';
  }

  function toggleSelectTool() {
    selectToolEnabled = !selectToolEnabled;
    selectToolBtn.classList.toggle('active', selectToolEnabled);
    if (!selectToolEnabled) clearSelection();
  }

  function copySelectionPatch() {
    if (!lastPixelData || !selectionRect) return;
    const patch = [];
    for (let y = 0; y < selectionRect.h; y++) {
      const row = [];
      for (let x = 0; x < selectionRect.w; x++) {
        row.push(lastPixelData.grid[selectionRect.y + y][selectionRect.x + x]);
      }
      patch.push(row);
    }
    copiedPatch = patch;
    pasteSelectionBtn.disabled = false;
    pulseStatus(`Copied ${selectionRect.w}×${selectionRect.h} stitches`);
  }

  function pasteSelectionPatch() {
    if (!lastPixelData || !copiedPatch) return;
    pushUndoHistory();
    const startX = selectionRect ? selectionRect.x : Math.max(0, Math.floor((lastPixelData.cols - copiedPatch[0].length) / 2));
    const startY = selectionRect ? selectionRect.y : Math.max(0, Math.floor((lastPixelData.rows - copiedPatch.length) / 2));
    for (let y = 0; y < copiedPatch.length; y++) {
      for (let x = 0; x < copiedPatch[y].length; x++) {
        const tx = startX + x;
        const ty = startY + y;
        if (tx >= 0 && tx < lastPixelData.cols && ty >= 0 && ty < lastPixelData.rows) {
          lastPixelData.grid[ty][tx] = copiedPatch[y][x];
        }
      }
    }
    rerenderPreviewFromLastData();
    pulseStatus(`Pasted ${copiedPatch[0].length}×${copiedPatch.length} stitches`);
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
    colorCountVal.textContent = s.colorCount;
    stitchSizeInput.value = s.stitchSize;
    stitchSizeNumberInput.value = s.stitchSize;
    stitchSizeVal.textContent = `${s.stitchSize}px`;
    currentStitch = s.currentStitch;
    document.querySelectorAll('.stitch-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.stitch === currentStitch);
    });
    previewMode = s.previewMode;
    previewSwatchBtn.classList.toggle('active', previewMode === 'swatch');
    previewChartBtn.classList.toggle('active', previewMode === 'chart');
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
    stitchSizeVal.textContent = `${next}px`;
    scheduleLiveRender();
  });

  stitchSizeNumberInput.addEventListener('pointerdown', () => {
    if (sourceImage && lastPixelData) pushUndoHistory();
  });
  stitchSizeNumberInput.addEventListener('input', () => {
    const next = clampInt(stitchSizeNumberInput.value, 1, 8, 4);
    stitchSizeInput.value = String(next);
    stitchSizeNumberInput.value = String(next);
    stitchSizeVal.textContent = `${next}px`;
    scheduleLiveRender();
  });

  colorCountInput.addEventListener('pointerdown', () => {
    if (sourceImage && lastPixelData) pushUndoHistory();
  });
  colorCountInput.addEventListener('input', () => {
    colorCountNumberInput.value = colorCountInput.value;
    colorCountVal.textContent = colorCountInput.value;
  });

  colorCountNumberInput.addEventListener('pointerdown', () => {
    if (sourceImage && lastPixelData) pushUndoHistory();
  });
  colorCountNumberInput.addEventListener('input', () => {
    const next = clampInt(colorCountNumberInput.value, 1, 16, 1);
    colorCountInput.value = String(next);
    colorCountNumberInput.value = String(next);
    colorCountVal.textContent = String(next);
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

  /* ─── Stitch style buttons ───────────────────────────────── */
  document.querySelectorAll('.stitch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.stitch === currentStitch) return;
      pushUndoHistory();
      document.querySelectorAll('.stitch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStitch = btn.dataset.stitch;
      scheduleLiveRender();
    });
  });

  addColorBtn.addEventListener('click', () => {
    pushUndoHistory();
    const base =
      paletteItems[selectedColorIndex]?.hex ||
      paletteItems[paletteItems.length - 1]?.hex ||
      '#888888';
    const [r, g, b] = hexToRgb(base);
    const [h, s, l] = rgbToHsl(r, g, b);
    const next = normalizeHex(hslToHex((h + 24) % 360, s, l));
    paletteItems.push({ hex: next, enabled: true });
    selectedColorIndex = paletteItems.length - 1;
    renderPaletteEditor();
    scheduleLiveRender();
  });

  pickerTrigger.addEventListener('click', e => {
    e.stopPropagation();
    togglePicker();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePicker();
  });

  document.addEventListener('pointerdown', e => {
    if (!pickerOpen) return;
    if (pickerPopover.contains(e.target) || pickerTrigger.contains(e.target)) return;
    closePicker();
  });

  hueSlider.addEventListener('input', () => {
    hueVal.textContent = `${hueSlider.value}°`;
    syncPlaneColor();
    updateColorFromPicker();
  });

  let svDragging = false;
  svPlane.addEventListener('pointerdown', e => {
    svDragging = true;
    svPlane.setPointerCapture(e.pointerId);
    updateSVFromPointer(e);
  });
  svPlane.addEventListener('pointermove', e => {
    if (!svDragging) return;
    updateSVFromPointer(e);
  });
  svPlane.addEventListener('pointerup', e => {
    svDragging = false;
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
  selectToolBtn.addEventListener('click', toggleSelectTool);
  copySelectionBtn.addEventListener('click', copySelectionPatch);
  pasteSelectionBtn.addEventListener('click', pasteSelectionPatch);

  let previewPanning = false;
  let previewPanStartX = 0;
  let previewPanStartY = 0;
  let previewPanScrollLeft = 0;
  let previewPanScrollTop = 0;

  function updatePreviewPanState() {
    if (!previewViewport || !outputContainer.querySelector('svg')) {
      previewViewport.classList.remove('preview-viewport--pannable');
      return;
    }
    const el = previewViewport;
    const can =
      el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
    el.classList.toggle('preview-viewport--pannable', can);
  }

  previewViewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (placeholder.style.display !== 'none') return;
    if (!outputContainer.querySelector('svg')) return;
    if (selectToolEnabled) {
      const cell = getSvgCellFromPointer(e);
      if (!cell) return;
      selecting = true;
      selectionStartCell = { x: cell.x, y: cell.y };
      selectionRect = { x: cell.x, y: cell.y, w: 1, h: 1 };
      copySelectionBtn.disabled = true;
      previewViewport.setPointerCapture(e.pointerId);
      updateSelectionOverlay();
      return;
    }
    const can =
      previewViewport.scrollWidth > previewViewport.clientWidth + 2 ||
      previewViewport.scrollHeight > previewViewport.clientHeight + 2;
    if (!can) return;
    previewPanning = true;
    previewPanStartX = e.clientX;
    previewPanStartY = e.clientY;
    previewPanScrollLeft = previewViewport.scrollLeft;
    previewPanScrollTop = previewViewport.scrollTop;
    previewViewport.classList.add('is-panning');
    previewViewport.setPointerCapture(e.pointerId);
  });

  previewViewport.addEventListener('pointermove', e => {
    if (selecting && selectionStartCell) {
      const cell = getSvgCellFromPointer(e);
      if (!cell) return;
      const minX = Math.min(selectionStartCell.x, cell.x);
      const minY = Math.min(selectionStartCell.y, cell.y);
      const maxX = Math.max(selectionStartCell.x, cell.x);
      const maxY = Math.max(selectionStartCell.y, cell.y);
      selectionRect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      updateSelectionOverlay();
      return;
    }
    if (!previewPanning) return;
    const dx = e.clientX - previewPanStartX;
    const dy = e.clientY - previewPanStartY;
    previewViewport.scrollLeft = previewPanScrollLeft - dx;
    previewViewport.scrollTop = previewPanScrollTop - dy;
  });

  function endPreviewPan(e) {
    if (selecting) {
      selecting = false;
      selectionStartCell = null;
      copySelectionBtn.disabled = !selectionRect;
      updateSelectionOverlay();
      try {
        previewViewport.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      return;
    }
    if (!previewPanning) return;
    previewPanning = false;
    previewViewport.classList.remove('is-panning');
    try {
      previewViewport.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
  }

  previewViewport.addEventListener('pointerup', endPreviewPan);
  previewViewport.addEventListener('pointercancel', endPreviewPan);
  previewViewport.addEventListener('scroll', () => {
    if (selectionRect) updateSelectionOverlay();
  });

  window.addEventListener('resize', () => {
    if (outputContainer.querySelector('svg')) {
      applyPreviewSizing();
      updatePreviewPanState();
      updateSelectionOverlay();
    }
  });

  previewSwatchBtn.addEventListener('click', () => {
    if (previewMode === 'swatch') return;
    pushUndoHistory();
    setPreviewMode('swatch');
  });
  previewChartBtn.addEventListener('click', () => {
    if (previewMode === 'chart') return;
    pushUndoHistory();
    setPreviewMode('chart');
  });

  undoBtn.addEventListener('click', () => undo());
  redoBtn.addEventListener('click', () => redo());

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select')) return;
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  });

  downloadBtn.addEventListener('click', downloadActive);

  /* ─── File drop & browse ─────────────────────────────────── */
  placeholder.addEventListener('click', e => {
    e.stopPropagation();
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
      const file = getFirstImageFile(e.dataTransfer);
      if (e.dataTransfer) e.dataTransfer.dropEffect = file ? 'copy' : 'none';
      if (file) canvasArea.classList.add('dragover');
    },
    true
  );

  canvasArea.addEventListener(
    'dragover',
    e => {
      e.preventDefault();
      e.stopPropagation();
      const file = getFirstImageFile(e.dataTransfer);
      if (e.dataTransfer) e.dataTransfer.dropEffect = file ? 'copy' : 'none';
      canvasArea.classList.toggle('dragover', !!file);
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
      else pulseStatus('Drop an image file to add it');
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
    downloadFormatSelect.disabled = true;
    clearImageBtn.disabled = true;
    selectToolBtn.disabled = true;
    copySelectionBtn.disabled = true;
    pasteSelectionBtn.disabled = true;
    hiddenInput.value = '';
    previewZoom = 1;
    previewViewport.scrollLeft = 0;
    previewViewport.scrollTop = 0;
    setZoomControlsDisabled(true);
    paletteItems = [{ hex: '#ffffff', enabled: true }];
    selectedColorIndex = 0;
    colorCountInput.value = '1';
    colorCountNumberInput.value = '1';
    colorCountVal.textContent = '1';
    renderPaletteEditor();
    pulseStatus('awaiting image');
    copiedPatch = null;
    selectToolEnabled = false;
    selectToolBtn.classList.remove('active');
    clearSelection();
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
        setCollageControlsState(true);
        stitchSizeInput.value = '4';
        stitchSizeNumberInput.value = '4';
        stitchSizeVal.textContent = '4px';
        colorCountInput.value = '16';
        colorCountNumberInput.value = '16';
        colorCountVal.textContent = '16';
        gridToggle.classList.add('on');
        pulseStatus(`${img.width} × ${img.height}px — ready`);
        paletteItems = extractPaletteFromImage(parseInt(colorCountInput.value, 10));
        selectedColorIndex = 0;
        renderPaletteEditor();
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
      lastPixelData.colorList[i] = paletteItems[i].enabled ? [r, g, b] : [255, 255, 255];
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
    downloadFormatSelect.disabled = false;
    setCollageControlsState(true);

    if (resetPreviewScrollNext) {
      previewViewport.scrollLeft = 0;
      previewViewport.scrollTop = 0;
      resetPreviewScrollNext = false;
    }
    applyPreviewSizing();
    updatePreviewPanState();
    updateSelectionOverlay();

    const { cols, rows } = lastPixelData;
    const enabledCount = paletteItems.filter(p => p.enabled).length;
    const prevLabel = previewMode === 'chart' ? 'chart' : 'swatch';
    pulseStatus(`${cols} × ${rows} stitches — ${prevLabel} — ${enabledCount}/${paletteItems.length} colors`);
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

  function downloadSvgAsJpeg(svgEl) {
    return new Promise((resolve, reject) => {
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
      w = Math.min(8192, Math.max(1, Math.round(w)));
      h = Math.min(8192, Math.max(1, Math.round(h)));

      const xml = serializeSvgString(svgEl);
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

  function downloadActive() {
    if (!lastPixelData) return;

    const svgEl = outputContainer.querySelector('svg');
    if (!svgEl) return;

    const tag = previewMode === 'chart' ? 'chart' : 'swatch';
    const wantJpeg = downloadFormatSelect && downloadFormatSelect.value === 'jpeg';

    if (!wantJpeg) {
      const xml = serializeSvgString(svgEl);
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      triggerDownloadBlob(blob, `knit-artwork-${tag}.svg`);
      return;
    }

    downloadSvgAsJpeg(svgEl).then(
      blob => triggerDownloadBlob(blob, `knit-artwork-${tag}.jpg`),
      () => {
        const xml = serializeSvgString(svgEl);
        const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        triggerDownloadBlob(blob, `knit-artwork-${tag}.svg`);
      }
    );
  }

  function setPreviewMode(mode) {
    previewMode = mode;
    previewSwatchBtn.classList.toggle('active', mode === 'swatch');
    previewChartBtn.classList.toggle('active', mode === 'chart');
    updateOptionVisibility();
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
      selectionOverlay.style.display = 'none';
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
      updateSelectionOverlay();
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
        openPicker();
        renderPaletteEditor();
      });

      const chip = document.createElement('div');
      chip.className = 'palette-chip';
      chip.style.background = item.hex;

      const hexLabel = document.createElement('div');
      hexLabel.className = 'palette-hex';
      hexLabel.textContent = item.hex.slice(1).toUpperCase();

      const strength = document.createElement('div');
      strength.className = 'palette-strength';
      strength.textContent = '100 %';

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

      const actionGroup = document.createElement('div');
      actionGroup.className = 'row-actions';
      actionGroup.appendChild(eyeBtn);
      actionGroup.appendChild(removeBtn);

      row.appendChild(chip);
      row.appendChild(hexLabel);
      row.appendChild(strength);
      row.appendChild(actionGroup);
      paletteEditor.appendChild(row);
    });
  }

  function extractPaletteFromImage(count) {
    const safeCount = Math.max(1, Math.min(16, count | 0));
    const sample = document.createElement('canvas');
    sample.width = 120;
    sample.height = Math.max(1, Math.round(120 * sourceImage.height / sourceImage.width));
    const sctx = sample.getContext('2d');
    sctx.drawImage(sourceImage, 0, 0, sample.width, sample.height);
    const imgData = sctx.getImageData(0, 0, sample.width, sample.height);
    const centers = kMeansColors(imgData, safeCount);
    return centers.map(([r, g, b]) => ({ hex: rgbToHex(r, g, b), enabled: true }));
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
    syncPlaneColor();
    updateSVHandle();

    pickerTrigger.style.background = selected.hex;
    pickerTrigger.style.borderColor = 'rgba(0,0,0,0.12)';
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

  function updateColorFromPicker() {
    if (!paletteItems.length) return;
    const hue = parseInt(hueSlider.value, 10);
    paletteItems[selectedColorIndex].hex = normalizeHex(hsvToHex(hue, pickerSat, pickerVal));
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
  }

  function togglePicker() {
    if (pickerOpen) closePicker();
    else openPicker();
  }

  syncPlaneColor();
  updateOptionVisibility();
  renderPaletteEditor();
  setZoomControlsDisabled(true);

  {
    const ss = clampInt(stitchSizeInput.value, 1, 8, 4);
    stitchSizeInput.value = String(ss);
    stitchSizeNumberInput.value = String(ss);
    stitchSizeVal.textContent = `${ss}px`;
  }
  {
    const cc = clampInt(colorCountInput.value, 1, 16, 1);
    colorCountInput.value = String(cc);
    colorCountNumberInput.value = String(cc);
    colorCountVal.textContent = String(cc);
  }

  const huePresets = document.getElementById('huePresets');
  if (huePresets) {
    for (let i = 0; i < 12; i++) {
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'hue-preset-seg';
      const hue = i * 30;
      seg.style.background = `hsl(${hue}, 100%, 50%)`;
      seg.title = `${hue}°`;
      seg.addEventListener('click', e => {
        e.stopPropagation();
        hueSlider.value = String(hue);
        hueVal.textContent = `${hue}°`;
        syncPlaneColor();
        updateColorFromPicker();
      });
      huePresets.appendChild(seg);
    }
  }

  updateUndoRedoButtons();
  setCollageControlsState(false);
  clearSelection();
  setupInteractiveFeedback();
})();
