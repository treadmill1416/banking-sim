import { getState } from './state.js';
import { updateAll } from './main.js';

const X_MIN = 0, X_MAX = 50, X_STEP = 0.5;
const Y_MIN = 0, Y_MAX = 25, Y_STEP = 0.25;
const REJECT_THRESHOLD = 20;
const COMPRESS_POINT = 20;
const COMPRESS_PORTION = 0.7;
const MARGIN = { top: 16, right: 16, bottom: 28, left: 44 };
const TOUCH_HIT_RADIUS = 32;
const CIRCLE_RADIUS = 8;

let svg = null;
let dynGroup = null;
let W = 0, H = 0, innerW = 0, innerH = 0;
let dimsCached = false;
let dragIdx = -1;
let resizeObserver = null;
let touchStartX = 0, touchStartY = 0;
let touchIdentifier = -1;
let staticRendered = false;

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
  fullRender();
  staticRendered = true;
  svg.addEventListener('mousedown', onPointerDown);
  svg.addEventListener('touchstart', onTouchStart, { passive: false });
  svg.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchend', onTouchEnd);
  resizeObserver = new ResizeObserver(() => { cacheDims(); fullRender(); });
  resizeObserver.observe(svg.parentElement);
  updateToggle();
}

export function updateRiskGraph() {
  if (!svg) svg = document.getElementById('riskGraph');
  if (!svg) return;
  if (!staticRendered) { fullRender(); staticRendered = true; return; }
  renderPoints();
  updateToggle();
}

function fullRender() {
  cacheDims();
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = buildStaticHTML() + '<g id="dyn-group"></g>';
  dynGroup = svg.querySelector('#dyn-group');
  renderPoints();
}

function buildStaticHTML() {
  let html = '';
  const rejectPx = yToPx(REJECT_THRESHOLD);
  html += `<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${innerW}" height="${rejectPx - MARGIN.top}" fill="rgba(200,0,0,0.08)" stroke="none"/>`;
  html += `<text x="${MARGIN.left + innerW / 2}" y="${(MARGIN.top + rejectPx) / 2 + 4}" text-anchor="middle" fill="#cc0000" font-size="13" font-weight="bold" opacity="0.35">REJECT</text>`;
  const Y_TICKS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 25];
  for (const y of Y_TICKS) {
    const py = yToPx(y);
    const major = y % 10 === 0;
    html += `<line x1="${MARGIN.left}" y1="${py}" x2="${MARGIN.left + innerW}" y2="${py}" class="${major ? 'ggrid-major' : 'ggrid'}"/>`;
    html += `<text x="${MARGIN.left - 4}" y="${py + 3.5}" text-anchor="end" class="glabel">${y}</text>`;
  }
  const X_TICKS = [];
  for (let x = 0; x <= 20; x += 2) X_TICKS.push(x);
  for (let x = 25; x <= 50; x += 5) X_TICKS.push(x);
  for (const x of X_TICKS) {
    const px = xToPx(x);
    const major = x % 10 === 0 || x === 5;
    html += `<line x1="${px}" y1="${MARGIN.top}" x2="${px}" y2="${MARGIN.top + innerH}" class="${major ? 'ggrid-major' : 'ggrid'}"/>`;
    html += `<text x="${px}" y="${MARGIN.top + innerH + 16}" text-anchor="middle" class="glabel">${x}</text>`;
  }
  for (let x = 1; x < 20; x++) {
    if (x % 2 === 0) continue;
    const px = xToPx(x);
    html += `<line x1="${px}" y1="${MARGIN.top}" x2="${px}" y2="${MARGIN.top + innerH}" class="ggrid-minor"/>`;
  }
  html += `<text x="${MARGIN.left + innerW / 2}" y="${H - 2}" text-anchor="middle" class="glabel" font-size="11">Default Risk (%)</text>`;
  html += `<text x="12" y="${MARGIN.top + innerH / 2}" text-anchor="middle" class="glabel" font-size="11" transform="rotate(-90, 12, ${MARGIN.top + innerH / 2})">Rate (%)</text>`;
  return html;
}

function renderPoints() {
  if (!dynGroup) dynGroup = svg && svg.querySelector('#dyn-group');
  if (!dynGroup) return;
  dynGroup.innerHTML = buildPointsHTML();
}

function buildPointsHTML() {
  const map = getMap();
  let html = '';
  if (map.length > 1) {
    let path = '';
    for (let i = 0; i < map.length; i++) {
      const px = xToPx(map[i].risk).toFixed(1);
      const py = yToPx(map[i].rate).toFixed(1);
      path += (i === 0 ? 'M' : 'L') + px + ',' + py;
    }
    const inRej = map.some(p => p.rate === null || p.rate > REJECT_THRESHOLD);
    html += `<path id="conn-path" d="${path}" fill="none" stroke="${inRej ? '#cc0000' : '#2563eb'}" stroke-width="2"/>`;
  }
  for (let i = 0; i < map.length; i++) {
    const px = xToPx(map[i].risk).toFixed(1);
    const inReject = map[i].rate === null || map[i].rate > REJECT_THRESHOLD;
    const py = inReject ? yToPx(null).toFixed(1) : yToPx(map[i].rate).toFixed(1);
    const fill = inReject ? '#cc0000' : '#2563eb';
    html += `<circle class="rg-drag-halo" data-halo-idx="${i}" cx="${px}" cy="${py}" r="14" fill="${fill}" fill-opacity="0" stroke="none"/>`;
    html += `<circle cx="${px}" cy="${py}" r="${CIRCLE_RADIUS}" fill="${fill}" stroke="#fff" stroke-width="2" data-idx="${i}" style="cursor:grab"/>`;
    const label = map[i].rate !== null ? map[i].rate.toFixed(2) + '%' : 'REJ';
    html += `<text x="${px}" y="${parseFloat(py) - 10}" text-anchor="middle" class="plabel" fill="${fill}" data-idx="${i}">${label}</text>`;
  }
  return html;
}

function updatePointDuringDrag(idx) {
  const map = getMap();
  if (!map[idx]) return;

  const px = xToPx(map[idx].risk).toFixed(1);
  const inReject = map[idx].rate === null || map[idx].rate > REJECT_THRESHOLD;
  const py = inReject ? yToPx(null).toFixed(1) : yToPx(map[idx].rate).toFixed(1);
  const fill = inReject ? '#cc0000' : '#2563eb';

  const halo = svg.querySelector(`circle[data-halo-idx="${idx}"]`);
  if (halo) {
    halo.setAttribute('cx', px);
    halo.setAttribute('cy', py);
    halo.setAttribute('fill', fill);
  }

  const circle = svg.querySelector(`circle[data-idx="${idx}"]`);
  if (circle) {
    circle.setAttribute('cx', px);
    circle.setAttribute('cy', py);
    circle.setAttribute('fill', fill);
  }

  const label = svg.querySelector(`text[data-idx="${idx}"]`);
  if (label) {
    label.setAttribute('x', px);
    label.setAttribute('y', parseFloat(py) - 10);
    label.setAttribute('fill', fill);
    label.textContent = map[idx].rate !== null ? map[idx].rate.toFixed(2) + '%' : 'REJ';
  }

  const path = svg.querySelector('#conn-path');
  if (path) {
    let d = '';
    for (let i = 0; i < map.length; i++) {
      const pxi = xToPx(map[i].risk).toFixed(1);
      const pyi = yToPx(map[i].rate).toFixed(1);
      d += (i === 0 ? 'M' : 'L') + pxi + ',' + pyi;
    }
    path.setAttribute('d', d);
  }
}

function getMap() {
  return getState().riskRateMap || [];
}

function setMap(map) {
  getState().riskRateMap = map;
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

function showDragHalo(idx) {
  const halo = svg.querySelector(`circle[data-halo-idx="${idx}"]`);
  if (halo) halo.setAttribute('fill-opacity', '0.15');
}

function hideDragHalo(idx) {
  const halo = svg.querySelector(`circle[data-halo-idx="${idx}"]`);
  if (halo) halo.setAttribute('fill-opacity', '0');
}

function addPointAt(px, py) {
  const map = getMap();
  if (map.length >= 20) return;
  const risk = clamp(snap(pxToX(px), X_STEP), X_MIN, X_MAX);
  const rawRate = snap(pxToY(py), X_STEP);
  const rate = rawRate <= REJECT_THRESHOLD ? clamp(rawRate, Y_MIN, REJECT_THRESHOLD) : null;
  if (map.some(p => Math.abs(p.risk - risk) < 0.01)) return;
  const newMap = [...map, { risk, rate }].sort((a, b) => a.risk - b.risk);
  setMap(newMap);
  renderPoints();
}

function processPointerDown(mx, my, e) {
  const el = e.target.closest('circle');
  if (el) {
    if (e.button === 2) {
      const idx = parseInt(el.dataset.idx);
      const map = getMap();
      if (idx > 0 && idx < map.length - 1) {
        const newMap = map.filter((_, i) => i !== idx);
        setMap(newMap);
        renderPoints();
      }
      return true;
    }
    if (e.button === 0) {
      dragIdx = parseInt(el.dataset.idx);
      showDragHalo(dragIdx);
    }
    return true;
  }
  if (e.button !== 0) return true;
  addPointAt(mx, my);
  return true;
}

function processPointerMove(mx, my) {
  if (dragIdx < 0) return;
  const map = getMap();
  if (!map[dragIdx]) return;

  const clampedMx = clamp(mx, MARGIN.left, MARGIN.left + innerW);
  const clampedMy = clamp(my, MARGIN.top, MARGIN.top + innerH);

  const risk = clamp(pxToX(clampedMx), X_MIN, X_MAX);
  const rawRate = pxToY(clampedMy);
  const inReject = rawRate > REJECT_THRESHOLD;
  const rate = inReject ? null : clamp(rawRate, Y_MIN, REJECT_THRESHOLD);

  const before = map[dragIdx - 1];
  const after = map[dragIdx + 1];
  const newRisk = before ? Math.max(risk, before.risk + 0.01) : risk;
  const finalRisk = after ? Math.min(newRisk, after.risk - 0.01) : newRisk;

  map[dragIdx] = { risk: finalRisk, rate };
  setMap(map);
  updatePointDuringDrag(dragIdx);
}

function processPointerUp() {
  if (dragIdx < 0) return;

  const map = getMap();
  if (map[dragIdx]) {
    let snappedRate = map[dragIdx].rate;
    if (snappedRate !== null) {
      snappedRate = snap(snappedRate, Y_STEP);
      snappedRate = clamp(snappedRate, Y_MIN, REJECT_THRESHOLD);
      if (snappedRate > REJECT_THRESHOLD) snappedRate = null;
    }
    map[dragIdx] = {
      risk: snap(map[dragIdx].risk, X_STEP),
      rate: snappedRate,
    };
    setMap(map);
  }

  hideDragHalo(dragIdx);
  renderPoints();
  dragIdx = -1;
  touchIdentifier = -1;
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
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchIdentifier = t.identifier;
  const rect = svg.getBoundingClientRect();
  const mx = t.clientX - rect.left;
  const my = t.clientY - rect.top;

  const circles = svg.querySelectorAll('circle[data-idx]');
  let nearestDist = TOUCH_HIT_RADIUS * TOUCH_HIT_RADIUS;
  let nearestIdx = -1;
  for (const circle of circles) {
    const cx = parseFloat(circle.getAttribute('cx'));
    const cy = parseFloat(circle.getAttribute('cy'));
    const dx = mx - cx;
    const dy = my - cy;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = parseInt(circle.dataset.idx);
    }
  }
  if (nearestIdx >= 0) {
    dragIdx = nearestIdx;
    showDragHalo(nearestIdx);
    e.preventDefault();
  }
}

function onTouchMove(e) {
  if (dragIdx < 0 || e.touches.length === 0) return;
  const t = e.touches[0];
  if (t.identifier !== touchIdentifier) return;
  const { x, y } = getTouchCoords(e);
  processPointerMove(x, y);
  e.preventDefault();
}

function onTouchEnd(e) {
  const wasDragging = dragIdx >= 0;
  processPointerUp();
  if (wasDragging) return;

  const changed = e.changedTouches[0];
  if (!changed) return;
  const dx = changed.clientX - touchStartX;
  const dy = changed.clientY - touchStartY;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;

  const rect = svg.getBoundingClientRect();
  const x = changed.clientX - rect.left;
  const y = changed.clientY - rect.top;
  addPointAt(x, y);
  touchIdentifier = -1;
}

export function updateToggle() {
  const s = getState();
  const container = document.getElementById('autoToggleContainer');
  if (!container) return;
  if (!s.autoLoanGraphUnlocked) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  const enabled = s.autoLoanGraphEnabled !== false;
  container.innerHTML =
    '<div class="auto-toggle-row">' +
      '<span class="auto-toggle-label">Auto-processing:</span>' +
      '<label class="auto-toggle-switch">' +
        '<input type="checkbox" id="autoGraphToggle" ' + (enabled ? 'checked' : '') + '>' +
        '<span class="auto-toggle-slider"></span>' +
      '</label>' +
      '<span class="auto-toggle-status ' + (enabled ? 'auto-toggle-on' : 'auto-toggle-off') + '">' + (enabled ? 'ON' : 'OFF') + '</span>' +
    '</div>';
}
