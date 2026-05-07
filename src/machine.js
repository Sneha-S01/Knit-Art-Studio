/**
 * machine.js
 * Knitting machine punchcard view.
 * Builds the needle bed, animated carriage, and scrolling punchcard
 * grid that simulates a real flatbed knitting machine display.
 */

const Machine = (() => {
  let animFrame = null;
  let animRunning = false;
  let carriageDir = 1;
  let carriagePos = 0;
  let currentRow = 0;

  /**
   * Build and display the machine punchcard view.
   *
   * @param {{ grid, cols, rows, colorList }} pixelData
   */
  function build(pixelData) {
    stop();
    const { grid, cols, rows, colorList } = pixelData;

    _buildNeedleBed(cols);
    _buildPunchcard(grid, cols, rows, colorList);
    _buildLegend(colorList);
    _startCarriage(rows, cols);
  }

  /** Stop the carriage animation. */
  function stop() {
    animRunning = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
  }

  /* ─── Private builders ──────────────────────────────────── */

  function _buildNeedleBed(cols) {
    const bed = document.getElementById('needleBed');
    bed.innerHTML = '';
    const visibleNeedles = Math.min(cols, 60);
    for (let i = 0; i < visibleNeedles; i++) {
      const n = document.createElement('div');
      const h = 14 + (Math.sin(i * 0.5) * 3 | 0);
      n.style.cssText = `
        width: 10px;
        height: ${h}px;
        background: ${i % 2 === 0 ? '#3a3a3a' : '#444'};
        border-radius: 1px 1px 0 0;
        margin: 0 0.5px;
        flex-shrink: 0;
      `;
      bed.appendChild(n);
    }
  }

  function _buildPunchcard(grid, cols, rows, colorList) {
    const inner = document.getElementById('punchcardInner');
    inner.innerHTML = '';

    const cellW = 14;
    const visibleNeedles = Math.min(cols, 60);
    inner.style.width = (visibleNeedles * cellW + 36) + 'px';

    // Rows are displayed bottom-up (last row of image = top of punchcard)
    for (let r = rows - 1; r >= 0; r--) {
      const rowEl = document.createElement('div');
      rowEl.className = 'punch-row';
      rowEl.id = `prow-${r}`;

      // Active row highlight marker
      const marker = document.createElement('div');
      marker.className = 'active-row-marker';
      rowEl.appendChild(marker);

      // Row number
      const numEl = document.createElement('div');
      numEl.className = 'row-num';
      numEl.textContent = r + 1;
      rowEl.appendChild(numEl);

      // Stitch cells
      const cells = document.createElement('div');
      cells.className = 'punch-cells';

      for (let c = 0; c < visibleNeedles; c++) {
        const colorIdx = c < grid[r].length ? grid[r][c] : 0;
        const [cr, cg, cb] = colorList[colorIdx];

        const cell = document.createElement('div');
        cell.className = 'punch-cell';
        cell.style.background = `rgb(${cr}, ${cg}, ${cb})`;

        const hole = document.createElement('div');
        hole.className = 'punch-hole';
        cell.appendChild(hole);
        cells.appendChild(cell);
      }

      rowEl.appendChild(cells);
      inner.appendChild(rowEl);
    }
  }

  function _buildLegend(colorList) {
    const legend = document.getElementById('machineLegend');
    legend.innerHTML = '';
    const maxShow = Math.min(colorList.length, 12);
    for (let i = 0; i < maxShow; i++) {
      const [r, g, b] = colorList[i];
      const item = document.createElement('div');
      item.className = 'legend-item';

      const sw = document.createElement('div');
      sw.className = 'legend-swatch';
      sw.style.background = `rgb(${r}, ${g}, ${b})`;

      const lbl = document.createElement('span');
      lbl.textContent = `C${i + 1}`;

      item.appendChild(sw);
      item.appendChild(lbl);
      legend.appendChild(item);
    }
  }

  function _startCarriage(totalRows, cols) {
    const indicator = document.getElementById('carriageIndicator');
    const label = document.getElementById('carriageLabel');
    const bar = document.getElementById('carriageBar');
    const cellW = 14;
    const maxX = Math.min(cols * cellW + 36, bar.offsetWidth || 400) - 50;

    carriageDir = 1;
    carriagePos = 0;
    currentRow = 0;
    animRunning = true;

    function step() {
      if (!animRunning) return;

      carriagePos += carriageDir * 2;
      if (carriagePos >= maxX) { carriagePos = maxX; carriageDir = -1; _advanceRow(totalRows); }
      if (carriagePos <= 0)    { carriagePos = 0;    carriageDir =  1; _advanceRow(totalRows); }

      indicator.style.left = carriagePos + 'px';
      label.textContent = `carriage — row ${currentRow + 1} / ${totalRows}`;
      animFrame = requestAnimationFrame(step);
    }

    animFrame = requestAnimationFrame(step);
  }

  function _advanceRow(totalRows) {
    // Deactivate previous row
    const prevEl = document.getElementById(`prow-${totalRows - 1 - currentRow}`);
    if (prevEl) {
      prevEl.querySelector('.active-row-marker').style.opacity = '0';
      prevEl.classList.remove('row-highlight');
    }

    currentRow = (currentRow + 1) % totalRows;

    // Activate current row
    const curEl = document.getElementById(`prow-${totalRows - 1 - currentRow}`);
    if (curEl) {
      curEl.querySelector('.active-row-marker').style.opacity = '1';
      curEl.classList.add('row-highlight');
      curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  return { build, stop };
})();
