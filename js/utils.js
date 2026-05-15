import { TICKS_PER_QUARTER, TICKS_PER_YEAR } from './constants.js';

export function fmtDollar(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  if (Math.abs(n) < 0.5) return '$0';
  const sign = n < 0 ? '-$' : '$';
  const abs = Math.abs(n);
  let s;
  if (abs >= 1e9) s = (abs / 1e9).toFixed(2) + 'B';
  else if (abs >= 1e6) s = (abs / 1e6).toFixed(2) + 'M';
  else if (abs >= 1e3) s = (abs / 1e3).toFixed(1) + 'K';
  else s = abs.toFixed(0);
  return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtPct(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  return n.toFixed(2) + '%';
}

export function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function gameDateStr(tick) {
  const start = new Date(2026, 0, 1);
  const d = new Date(start.getTime() + tick * 3600000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2,'0') + ':00';
}

export function quarterStr(tick) {
  const q = Math.floor(tick / TICKS_PER_QUARTER) % 4 + 1;
  const y = 2026 + Math.floor(tick / TICKS_PER_YEAR);
  return 'Q' + q + ' ' + y;
}
