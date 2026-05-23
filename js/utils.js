import { TICKS_PER_QUARTER, TICKS_PER_YEAR, TICKS_PER_MONTH } from './constants.js';

/** @module utils - Pure formatting utility functions. No side effects, no state access. */

/** Ultra-compact number formatter: max 4 chars including decimal point. No $ sign.
 *  1,000+ → K/M/B suffix. Decimals trimmed to fit 4 chars.
 *  @param {number|undefined|null} n
 *  @returns {string} */
export function fmtCompact(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  if (Math.abs(n) < 0.5) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) {
    let v = (abs / 1e9).toFixed(1);
    if (v.endsWith('.0')) v = v.slice(0, -2);
    if (v.length > 3) v = (abs / 1e9).toFixed(0);
    if (v === '1000') return sign + '1T';
    return sign + v + 'B';
  }
  if (abs >= 1e6) {
    let v = (abs / 1e6).toFixed(1);
    if (v.endsWith('.0')) v = v.slice(0, -2);
    if (v.length > 3) v = (abs / 1e6).toFixed(0);
    if (v === '1000') return sign + '1B';
    return sign + v + 'M';
  }
  if (abs >= 1e3) {
    let v = (abs / 1e3).toFixed(1);
    if (v.endsWith('.0')) v = v.slice(0, -2);
    if (v.length > 3) v = (abs / 1e3).toFixed(0);
    if (v === '1000') return sign + '1M';
    return sign + v + 'K';
  }
  let s = abs.toFixed(1);
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return sign + (s.length > 4 ? abs.toFixed(0) : s);
}

/** Format a number as a human-readable dollar string (e.g. "$1.5M", "$200K", "$0").
 *  @param {number|undefined|null} n - The value to format.
 *  @returns {string} */
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

/** Format a number as a percentage string (e.g. "5.50%").
 *  @param {number|undefined|null} n
 *  @returns {string} */
export function fmtPct(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  return n.toFixed(2) + '%';
}

/** Convert a tick count to a human-readable duration (e.g. "1y 3mo 5d").
 *  @param {number|null|undefined} ticks
 *  @returns {string} */
export function fmtTicks(ticks) {
  if (ticks == null || ticks < 0) return '—';
  const y = Math.floor(ticks / TICKS_PER_YEAR);
  const rem = ticks % TICKS_PER_YEAR;
  const mo = Math.floor(rem / TICKS_PER_MONTH);
  const d = Math.floor((rem % TICKS_PER_MONTH) / 2);
  const parts = [];
  if (y > 0) parts.push(y + 'y');
  if (mo > 0) parts.push(mo + 'mo');
  if (d > 0 || parts.length === 0) parts.push(d + 'd');
  return parts.join(' ');
}

/** Escape a string for safe insertion into HTML (uses DOM API, no manual regex).
 *  @param {string} s
 *  @returns {string} */
export function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Convert a tick count to a calendar date/time string. Tick 0 = Jan 1, 2026 00:00.
 *  @param {number} tick
 *  @returns {string} */
export function gameDateStr(tick) {
  const start = new Date(2026, 0, 1);
  const d = new Date(start.getTime() + tick * 43200000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2,'0') + ':00';
}

/** Convert a tick count to a quarter/year string (e.g. "Q1 2026").
 *  @param {number} tick
 *  @returns {string} */
export function quarterStr(tick) {
  const q = Math.floor(tick / TICKS_PER_QUARTER) % 4 + 1;
  const y = 2026 + Math.floor(tick / TICKS_PER_YEAR);
  return 'Q' + q + ' ' + y;
}
