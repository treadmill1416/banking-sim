import { getState } from './state.js';

/** @module charts - SVG line chart rendering for reserve ratio, NIM, and equity history. */

/** Draw an SVG line chart within a given SVG element. Shows the last 300 data points with gridlines, axis labels, and a current-value overlay.
 *  @param {string} svgId - DOM element ID of the target SVG
 *  @param {number[]} data - Data series
 *  @param {string} color - SVG stroke color
 *  @param {string} label - Chart title
 *  @param {function} formatter - Value formatting function for labels */
function drawChart(svgId, data, color, label, formatter) {
  const svg = document.getElementById(svgId);
  if (data.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const visible = data.slice(-300);
  const w = svg.clientWidth || 320;
  const h = 120;
  const pl = 48, pr = 8, pt = 4, pb = 18;
  const iw = w - pl - pr, ih = h - pt - pb;
  const rawMin = Math.min(...visible);
  const rawMax = Math.max(...visible);
  const range = rawMax - rawMin;
  if (range === 0) {
    svg.innerHTML = '';
    return;
  }
  const pad = range * 0.08;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;
  const yRng = yMax - yMin;
  let html = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
  const ySteps = 3;
  for (let i = 0; i <= ySteps; i++) {
    const y = pt + (i / ySteps) * ih;
    const val = yMax - (i / ySteps) * yRng;
    html += '<text x="' + (pl - 4) + '" y="' + (y + 3.5) + '" text-anchor="end" class="chart-label">' + (formatter ? formatter(val) : val.toFixed(2)) + '</text>';
    if (i > 0) {
      html += '<line x1="' + pl + '" y1="' + y + '" x2="' + (w - pr) + '" y2="' + y + '" class="chart-grid"/>';
    }
  }
  const step = iw / Math.max(visible.length - 1, 1);
  const pts = [];
  for (let i = 0; i < visible.length; i++) {
    const x = pl + i * step;
    const y = pt + ih - ((visible[i] - yMin) / yRng) * ih;
    pts.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  html += '<polyline points="' + pts.join(' ') + '" class="chart-line" stroke="' + color + '"/>';
  const lastVal = visible[visible.length - 1];
  html += '<text x="' + (w - pr) + '" y="' + (pt + 11) + '" text-anchor="end" class="chart-value" fill="' + color + '">' + (formatter ? formatter(lastVal) : lastVal.toFixed(2)) + '</text>';
  html += '<text x="' + (w / 2) + '" y="' + (h - 2) + '" text-anchor="middle" class="chart-title">' + label + '</text>';
  html += '</svg>';
  svg.innerHTML = html;
}

/** Read state history arrays and render all three charts (reserve ratio, NIM, equity). */
export function updateCharts() {
  const s = getState();
  drawChart('chartReserves', s.historyRR, '#0071d4', 'Reserve Ratio', v => v.toFixed(2) + '%');
  drawChart('chartNim', s.historyNIM, '#2d8a4e', 'Net Interest Margin', v => v.toFixed(2) + '%');
  drawChart('chartEquity', s.historyEQ, '#cc0000', 'Equity', v => '$' + (v >= 0 ? v.toFixed(0) : '-' + Math.abs(v).toFixed(0)));
  drawLoanScatter(s);
}

/** Render a scatter plot of accepted loans: projected default risk (X) vs interest rate (Y).
 *  Active loans = blue, repaid = grey, defaulted = red. */
function drawLoanScatter(s) {
  const svg = document.getElementById('loanScatterChart');
  if (!svg) return;
  const records = s.loanRecords;
  if (records.length === 0) { svg.innerHTML = ''; return; }

  const w = svg.clientWidth || 320;
  const h = 140;
  const pl = 44, pr = 8, pt = 4, pb = 20;
  const iw = w - pl - pr, ih = h - pt - pb;
  const xMin = 0, xMax = 50, yMin = 0, yMax = 20;

  let html = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;

  // Gridlines
  for (let x = 0; x <= xMax; x += 10) {
    const px = pl + (x / xMax) * iw;
    html += `<line x1="${px}" y1="${pt}" x2="${px}" y2="${pt + ih}" class="chart-grid"/>`;
    html += `<text x="${px}" y="${pt + ih + 14}" text-anchor="middle" class="chart-label" font-size="9">${x}</text>`;
  }
  for (let y = 0; y <= yMax; y += 5) {
    const py = pt + (1 - y / yMax) * ih;
    html += `<line x1="${pl}" y1="${py}" x2="${pl + iw}" y2="${py}" class="chart-grid"/>`;
    html += `<text x="${pl - 4}" y="${py + 3}" text-anchor="end" class="chart-label" font-size="9">${y}</text>`;
  }

  // Axis titles
  html += `<text x="${pl + iw / 2}" y="${h - 2}" text-anchor="middle" class="chart-label" font-size="9">Projected Default Risk (%)</text>`;
  html += `<text x="10" y="${pt + ih / 2}" text-anchor="middle" class="chart-label" font-size="9" transform="rotate(-90, 10, ${pt + ih / 2})">Rate (%)</text>`;

  // Scatter points
  for (const lr of records) {
    const x = lr.defaultProb || 0;
    const y = lr.rate;
    const cx = pl + (x / xMax) * iw;
    const cy = pt + (1 - y / yMax) * ih;
    const color = lr.status === 'active' ? '#2563eb'
                : lr.status === 'defaulted' ? '#cc0000'
                : '#9b9b9b';
    const opacity = lr.status === 'active' ? 0.8 : 0.5;
    html += `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}" opacity="${opacity}"/>`;
  }

  html += '</svg>';
  svg.innerHTML = html;
}
