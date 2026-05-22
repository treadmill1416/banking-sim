import { getState } from './state.js';
import { updateAll } from './main.js';

const X_MIN = 0, X_MAX = 50, X_STEP = 0.5;
const Y_MIN = 0, Y_MAX = 25, Y_STEP = 0.25;
const REJECT_THRESHOLD = 20;
const COMPRESS_POINT = 20;       // risk% where compression begins
const COMPRESS_PORTION = 0.7;    // fraction of innerW given to 0..COMPRESS_POINT
const MARGIN = { top: 16, right: 16, bottom: 28, left: 44 };

let svg = null;
let W = 0, H = 0, innerW = 0, innerH = 0;
let dimsCached = false;
let dragIdx = -1;
let draggedOut = false;
let resizeObserver = null;

/** Convert risk% to pixel X using a piecewise scale: 0..COMPRESS_POINT gets COMPRESS_PORTION of the width, the rest gets the remainder. */
function xToPx(risk) {
  const clamped = Math.max(X_MIN, Math.min(X_MAX, risk));
  const pivot = MARGIN.left + COMPRESS_PORTION * innerW;
  const tail = MARGIN.left + innerW;
  if (clamped <= COMPRESS_POINT) {
    const t = (clamped - X_MIN) / (COMPRESS_POINT - X_MIN);
    return MARGIN.left + t * (pivot - MARGIN.left);
  }
  const t = (clamped - COMPRESS_POINT) / (X_MAX - COMPRESS_POINT);
  return pivot + t * (tail - pivot);
}
/** Inverse of xToPx: pixel X → risk% */
function pxToX(px) {
  const pivot = MARGIN.left + COMPRESS_PORTION * innerW;
  const tail = MARGIN.left + innerW;
  if (px <= pivot) {
    const t = (px - MARGIN.left) / (pivot - MARGIN.left);
    return X_MIN + t * (COMPRESS_POINT - X_MIN);
  }
  const t = (px - pivot) / (tail - pivot);
  return COMPRESS_POINT + t * (X_MAX - COMPRESS_POINT);
}
function yToPx(rate) {
  if (rate === null || rate === undefined) rate = REJECT_THRESHOLD + 2.5;
  return MARGIN.top + (Y_MAX - rate) / (Y_MAX - Y_MIN) * innerH;
}
function pxToY(py) {
  return Y_MAX - ((py - MARGIN.top) / innerH) * (Y_MAX - Y_MIN);
}
function snap(v, step) {
  return Math.round(v / step) * step;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function inPlot(px, py) {
  return px >= MARGIN.left && px <= MARGIN.left + innerW &&
         py >= MARGIN.top && py <= MARGIN.top + innerH;
}

function cacheDims() {
  const container = svg.parentElement;
  W = container.clientWidth || 640;
  H = Math.max(200, Math.min(300, Math.round(W * 0.45)));
  innerW = W - MARGIN.left - MARGIN.right;
  innerH = H - MARGIN.top - MARGIN.bottom;
  dimsCached = true;
}

export function initRiskGraph() {
  svg = document.getElementById('riskGraph');
  if (!svg) return;
  cacheDims();
  render();
  svg.addEventListener('mousedown', onPointerDown);
  svg.addEventListener('touchstart', onTouchStart, { passive: true });
  svg.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchend', onTouchEnd);
  resizeObserver = new ResizeObserver(() => { cacheDims(); render(); });
  resizeObserver.observe(svg.parentElement);
}

export function updateRiskGraph() {
  if (!svg) svg = document.getElementById('riskGraph');
  if (!svg) return;
  render();
}

function getMap() {
  return getState().riskRateMap || [];
}

function setMap(map) {
  getState().riskRateMap = map;
}

function render() {
  if (!dimsCached) cacheDims();

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const map = getMap();
  let html = '';

  // Reject zone
  const rejectPx = yToPx(REJECT_THRESHOLD);
  html += `<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${innerW}" height="${rejectPx - MARGIN.top}" fill="rgba(200,0,0,0.08)" stroke="none"/>`;
  html += `<text x="${MARGIN.left + innerW / 2}" y="${(MARGIN.top + rejectPx) / 2 + 4}" text-anchor="middle" fill="#cc0000" font-size="13" font-weight="bold" opacity="0.35">REJECT</text>`;

  // Y-axis ticks
  const Y_TICKS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25];
  for (const y of Y_TICKS) {
    const py = yToPx(y);
    const major = y % 10 === 0;
    html += `<line x1="${MARGIN.left}" y1="${py}" x2="${MARGIN.left + innerW}" y2="${py}" class="${major ? 'ggrid-major' : 'ggrid'}"/>`;
    html += `<text x="${MARGIN.left - 4}" y="${py + 3.5}" text-anchor="end" class="glabel">${y}</text>`;
  }

  // X-axis ticks — granular every 1% in 0..20, every 5% after
  const X_TICKS = [];
  for (let x = 0; x <= 20; x += 2) X_TICKS.push(x);
  for (let x = 25; x <= 50; x += 5) X_TICKS.push(x);
  for (const x of X_TICKS) {
    const px = xToPx(x);
    const major = x % 10 === 0 || x === 5;
    html += `<line x1="${px}" y1="${MARGIN.top}" x2="${px}" y2="${MARGIN.top + innerH}" class="${major ? 'ggrid-major' : 'ggrid'}"/>`;
    html += `<text x="${px}" y="${MARGIN.top + innerH + 16}" text-anchor="middle" class="glabel">${x}</text>`;
  }
  // Extra faint gridlines every 1% in 0..20 for fine-grained reference
  for (let x = 1; x < 20; x++) {
    if (x % 2 === 0) continue;
    const px = xToPx(x);
    html += `<line x1="${px}" y1="${MARGIN.top}" x2="${px}" y2="${MARGIN.top + innerH}" class="ggrid-minor"/>`;
  }

  // Axis titles
  html += `<text x="${MARGIN.left + innerW / 2}" y="${H - 2}" text-anchor="middle" class="glabel" font-size="11">Default Risk (%)</text>`;
  html += `<text x="12" y="${MARGIN.top + innerH / 2}" text-anchor="middle" class="glabel" font-size="11" transform="rotate(-90, 12, ${MARGIN.top + innerH / 2})">Rate (%)</text>`;

  // Line segments connecting points
  if (map.length > 1) {
    let path = '';
    for (let i = 0; i < map.length; i++) {
      const px = xToPx(map[i].risk);
      const py = yToPx(map[i].rate);
      path += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
    }
    const inRej = map.some(p => p.rate === null || p.rate > REJECT_THRESHOLD);
    html += `<path d="${path}" fill="none" stroke="${inRej ? '#cc0000' : '#2563eb'}" stroke-width="2"/>`;
  }

  // Points
  for (let i = 0; i < map.length; i++) {
    const px = xToPx(map[i].risk);
    const inReject = map[i].rate === null || map[i].rate > REJECT_THRESHOLD;
    const py = inReject ? yToPx(null) : yToPx(map[i].rate);
    const fill = inReject ? '#cc0000' : '#2563eb';
    html += `<circle cx="${px}" cy="${py}" r="6" fill="${fill}" stroke="#fff" stroke-width="2" data-idx="${i}" style="cursor:grab"/>`;
    const label = map[i].rate !== null ? map[i].rate.toFixed(2) + '%' : 'REJ';
    html += `<text x="${px}" y="${py - 10}" text-anchor="middle" class="plabel" fill="${fill}">${label}</text>`;
  }

  svg.innerHTML = html;
}

function getPointerCoords(e) {
  const rect = svg.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getTouchCoords(e) {
  const t = e.touches[0];
  const rect = svg.getBoundingClientRect();
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

function processPointerDown(mx, my, e) {
  const el = e.target.closest('circle');
  if (el) {
    // Right-click on point = delete (non-endpoints only)
    if (e.button === 2) {
      const idx = parseInt(el.dataset.idx);
      const map = getMap();
      if (idx > 0 && idx < map.length - 1) {
        const newMap = map.filter((_, i) => i !== idx);
        setMap(newMap);
        render();
      }
      return true;
    }
    // Left-click = start drag
    if (e.button === 0) {
      dragIdx = parseInt(el.dataset.idx);
      draggedOut = false;
    }
    return true;
  }

  // Left-click on empty space = add point
  if (e.button !== 0) return true;
  const map = getMap();
  if (map.length >= 20) return true;
  const risk = clamp(snap(pxToX(mx), X_STEP), X_MIN, X_MAX);
  const rawRate = snap(pxToY(my), X_STEP);
  const rate = rawRate <= REJECT_THRESHOLD ? clamp(rawRate, Y_MIN, REJECT_THRESHOLD) : null;
  if (map.some(p => Math.abs(p.risk - risk) < 0.01)) return true;
  const newMap = [...map, { risk, rate }].sort((a, b) => a.risk - b.risk);
  setMap(newMap);
  render();
  return true;
}

function processPointerMove(mx, my) {
  if (dragIdx < 0) return;
  const map = getMap();
  if (!map[dragIdx]) return;

  if (!inPlot(mx, my)) {
    draggedOut = true;
    return;
  }
  draggedOut = false;

  const risk = clamp(snap(pxToX(mx), X_STEP), X_MIN, X_MAX);
  const rawRate = snap(pxToY(my), X_STEP);
  const inReject = rawRate > REJECT_THRESHOLD;
  const rate = inReject ? null : clamp(rawRate, Y_MIN, REJECT_THRESHOLD);

  const before = map[dragIdx - 1];
  const after = map[dragIdx + 1];
  const newRisk = before ? Math.max(risk, before.risk + 0.01) : risk;
  const finalRisk = after ? Math.min(newRisk, after.risk - 0.01) : newRisk;

  map[dragIdx] = { risk: finalRisk, rate };
  setMap(map);
  render();
}

function processPointerUp() {
  if (dragIdx < 0) return;
  const map = getMap();
  if (draggedOut && dragIdx > 0 && dragIdx < map.length - 1) {
    const newMap = map.filter((_, i) => i !== dragIdx);
    setMap(newMap);
  }
  dragIdx = -1;
  draggedOut = false;
  updateAll();
}

function onPointerDown(e) {
  const { x, y } = getPointerCoords(e);
  processPointerDown(x, y, e);
}

function onPointerMove(e) {
  if (dragIdx < 0) return;
  const { x, y } = getPointerCoords(e);
  processPointerMove(x, y);
}

function onPointerUp(e) {
  processPointerUp();
}

function onTouchStart(e) {
  if (e.touches.length === 0) return;
  const { x, y } = getTouchCoords(e);
  const target = e.target;
  // Check if touching a circle (the SVG circles are actual DOM nodes after innerHTML)
  if (target && target.tagName === 'circle' && target.dataset && target.dataset.idx !== undefined) {
    dragIdx = parseInt(target.dataset.idx);
    draggedOut = false;
    return;
  }
  // Check if touching a child of a circle (text label or other child)
  if (target && target.closest) {
    const circle = target.closest('circle');
    if (circle && circle.dataset && circle.dataset.idx !== undefined) {
      dragIdx = parseInt(circle.dataset.idx);
      draggedOut = false;
      return;
    }
  }
  // Add new point on empty space
  const map = getMap();
  if (map.length >= 20) return;
  const risk = clamp(snap(pxToX(x), X_STEP), X_MIN, X_MAX);
  const rawRate = snap(pxToY(y), X_STEP);
  const rate = rawRate <= REJECT_THRESHOLD ? clamp(rawRate, Y_MIN, REJECT_THRESHOLD) : null;
  if (map.some(p => Math.abs(p.risk - risk) < 0.01)) return;
  const newMap = [...map, { risk, rate }].sort((a, b) => a.risk - b.risk);
  setMap(newMap);
  render();
}

function onTouchMove(e) {
  if (e.touches.length === 0 || dragIdx < 0) return;
  const { x, y } = getTouchCoords(e);
  processPointerMove(x, y);
}

function onTouchEnd(e) {
  processPointerUp();
}
