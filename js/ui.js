import { getState } from './state.js';
import { reserveRatio, equity, totalAssets, computeNim, trailingNpl, computeDefaultRate } from './mechanics.js';
import { fmtDollar, fmtPct, escapeHtml, gameDateStr, quarterStr } from './utils.js';
import { TICKS_PER_MONTH, TICKS_PER_YEAR, HISTORY_MAX, LOAN_DEFAULT_DURATION } from './constants.js';

export function updateUI() {
  const s = getState();
  document.getElementById('gameDate').textContent = gameDateStr(s.tick);
  document.getElementById('quarter').textContent = quarterStr(s.tick);
  document.getElementById('autoAcceptDisplay').textContent = s.autoAcceptThreshold.toFixed(1) + '%';
  const badge = document.getElementById('regimeBadge');
  badge.textContent = s.regime.toUpperCase();
  badge.className = 'regime-badge regime-' + s.regime;

  const rr = reserveRatio(s);
  const eq = equity(s);
  const nim = computeNim(s);
  const npl = trailingNpl(s);

  document.getElementById('bsReserves').textContent = fmtDollar(s.reserves);
  document.getElementById('bsLoans').textContent = fmtDollar(s.loans);
  document.getElementById('bsBonds').textContent = fmtDollar(s.bonds);
  document.getElementById('bsAssetsTotal').textContent = fmtDollar(totalAssets(s));
  document.getElementById('bsDeposits').textContent = fmtDollar(s.deposits);
  document.getElementById('bsCbBorrowing').textContent = fmtDollar(s.cbBorrowing);
  const eqEl = document.getElementById('bsEquity');
  eqEl.textContent = fmtDollar(eq);
  eqEl.style.color = eq >= 0 ? '#3fb950' : '#f85149';
  document.getElementById('bsLiabilitiesTotal').textContent = fmtDollar(s.deposits + s.cbBorrowing + eq);

  const rrEl = document.getElementById('metricReserveRatio');
  rrEl.textContent = fmtPct(rr);
  rrEl.style.color = rr >= 1 ? '#3fb950' : '#f85149';
  document.getElementById('metricEquity').textContent = fmtDollar(eq);
  document.getElementById('metricEquity').style.color = eq >= 0 ? '#c9d1d9' : '#f85149';
  document.getElementById('metricNim').textContent = fmtPct(nim);
  document.getElementById('metricNim').style.color = nim >= 0 ? '#3fb950' : '#f85149';
  document.getElementById('metricNpl').textContent = fmtPct(npl);
  document.getElementById('metricNpl').style.color = npl < 2 ? '#3fb950' : npl < 5 ? '#d29922' : '#f85149';

  document.getElementById('loanRateDisplay').textContent = s.loanRate.toFixed(2) + '%';
  document.getElementById('depositRateDisplay').textContent = s.depositRate.toFixed(2) + '%';

  document.getElementById('ecbMlf').textContent = 'MLF ' + s.ecbMlfRate.toFixed(2) + '%';
  document.getElementById('ecbMro').textContent = 'MRO ' + s.ecbMroRate.toFixed(2) + '%';
  document.getElementById('ecbDepo').textContent = 'Depo ' + s.ecbDepositRate.toFixed(2) + '%';

  const cntContainer = document.getElementById('acceptedLoanCount');
  if (cntContainer) {
    let active = 0, repaid = 0, defaulted = 0;
    for (const lr of s.loanRecords) {
      if (lr.status === 'active') active++;
      else if (lr.status === 'repaid') repaid++;
      else if (lr.status === 'defaulted') defaulted++;
    }
    cntContainer.textContent = active + ' active / ' + repaid + ' repaid / ' + defaulted + ' defaulted';
  }
}

export function updateEventLog() {
  const s = getState();
  const container = document.getElementById('eventLog');
  if (s.eventLog.length === 0) {
    container.innerHTML = '<div class="events-empty">Waiting for events…</div>';
    return;
  }
  let html = '';
  for (const e of s.eventLog) {
    html += '<div class="event-entry">';
    html += '<span class="event-tick">[' + e.quarter + ']</span>';
    html += '<span class="event-msg ' + (e.cls || '') + '">' + escapeHtml(e.msg);
    if (e.type === 'loan_request' && e.approved === undefined) {
      html += ' <span class="event-prob">(default: ' + e.defaultProb.toFixed(1) + '%)</span>';
    }
    html += '</span></div>';
  }
  container.innerHTML = html;
}

function pnlSigned(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  if (Math.abs(n) < 0.5) return '$0';
  const abs = fmtDollar(Math.abs(n));
  return n >= 0 ? '+' + abs : '−' + abs;
}

function pnlRow(label, value, cls) {
  return '<div class="pnl-row"><span class="pnl-label">' + label + '</span><span class="pnl-value ' + cls + '">' + value + '</span></div>';
}

function pnlSection(title, p, cls) {
  const net = (p.loanInterest || 0) + (p.reserveInterest || 0) - (p.depositInterest || 0) - (p.cbInterest || 0) - (p.defaults || 0);
  const netCls = net >= 0 ? 'pnl-income' : 'pnl-expense';
  return '<div class="' + cls + '">' + title + '</div>' +
    '<div class="pnl-rows">' +
    pnlRow('Loan Interest', pnlSigned(p.loanInterest), 'pnl-income') +
    pnlRow('Reserve Interest', pnlSigned(p.reserveInterest), 'pnl-income') +
    pnlRow('Deposit Interest', pnlSigned(-(p.depositInterest || 0)), 'pnl-expense') +
    pnlRow('CB Interest', pnlSigned(-(p.cbInterest || 0)), 'pnl-expense') +
    pnlRow('Defaults', pnlSigned(-(p.defaults || 0)), 'pnl-expense') +
    '<div class="pnl-divider"></div>' +
    pnlRow('Net P&L', pnlSigned(net), netCls) +
    '</div>';
}

export function updatePnlDisplay() {
  const s = getState();
  const pnl = s.pnl;
  const ticksSince = s.tick - pnl.lastResetTick;
  const pct = ticksSince > 0 ? Math.min(100, Math.round(ticksSince / TICKS_PER_MONTH * 100)) : 0;
  const body = document.getElementById('pnlBody');
  if (!body) return;
  let html = '';
  if (pnl.lastTotal) {
    html += pnlSection('Last Month (completed)', pnl.lastTotal, 'pnl-progress pnl-progress-prev');
    html += '<div class="pnl-spacer"></div>';
  }
  html += pnlSection('Month ' + pct + '% complete', pnl, 'pnl-progress');
  body.innerHTML = html;
}

export function updateLoanApps() {
  const s = getState();
  const container = document.getElementById('loanAppsList');
  const pending = [];
  for (const e of s.eventLog) {
    if (e.type === 'loan_request' && e.approved === undefined) pending.push(e);
  }
  if (pending.length === 0) {
    container.innerHTML = '<div class="events-empty">No pending loan applications.</div>';
    return;
  }
  let html = '';
  for (const e of pending) {
    const rate = e.proposedRate || s.loanRate;
    const interest = e.loanAmount * rate / 100;
    const months = e.durationMonths || 12;
    const maturityTick = s.tick + months * TICKS_PER_MONTH;
    html += '<div class="la-entry" data-amount="' + e.loanAmount + '">';
    html += '<div class="la-top">';
    html += '<span class="la-id">' + e.loanRequestId + '</span>';
    html += '<span class="la-amount">' + fmtDollar(e.loanAmount) + '</span>';
    html += '</div>';
    html += '<div class="la-rate-row">';
    html += '<span class="la-rate-label">Rate:</span>';
    html += '<input type="range" class="app-rate-slider" data-id="' + e.loanRequestId + '" min="0.5" max="20" step="0.25" value="' + rate.toFixed(2) + '">';
    html += '<span class="rate-slider-val" data-id="' + e.loanRequestId + '">' + rate.toFixed(2) + '%</span>';
    html += '</div>';
    html += '<div class="la-dur-row">';
    html += '<span class="la-rate-label">Term:</span>';
    html += '<span class="dur-display">' + months + ' months</span>';
    html += '<span class="la-maturity">Matures ' + gameDateStr(maturityTick) + '</span>';
    html += '</div>';
    html += '<div class="la-stats">';
    html += '<span class="la-interest">Annual interest: +' + fmtDollar(interest).replace(/^\$/, '') + '</span>';
    html += '<span class="la-prob">Default risk: ' + e.defaultProb.toFixed(1) + '%</span>';
    html += '</div>';
    html += '<div class="la-actions">';
    html += '<button class="event-btn approve" data-action="approve" data-id="' + e.loanRequestId + '">APPROVE</button>';
    html += '<button class="event-btn reject" data-action="reject" data-id="' + e.loanRequestId + '">REJECT</button>';
    html += '</div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

export function updateAcceptedLoans() {
  const s = getState();
  const container = document.getElementById('acceptedLoansBody');
  if (!container) return;
  const sorted = s.loanRecords.slice().sort((a, b) => {
    const order = { active: 0, repaid: 1, defaulted: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.createdAt - b.createdAt;
  });
  let html = '';
  for (const lr of sorted) {
    const statusCls = lr.status === 'defaulted' ? 'al-status-defaulted' : lr.status === 'repaid' ? 'al-status-repaid' : 'al-status-active';
    const statusLabel = lr.status === 'defaulted' ? 'DEFAULTED' : lr.status === 'repaid' ? 'REPAID' : 'ACTIVE';
    html += '<div class="al-entry ' + statusCls + '">';
    html += '<div class="al-top"><span class="al-id">' + lr.id + '</span><span class="al-amount">' + fmtDollar(lr.amount) + '</span></div>';
    html += '<div class="al-mid">';
    html += '<span class="al-rate">' + lr.rate.toFixed(2) + '%</span>';
    html += '<span class="al-status ' + statusCls + '">' + statusLabel + '</span>';
    if (lr.status === 'active') {
      if (lr.durationTicks != null) {
        const months = Math.round(lr.durationTicks / TICKS_PER_MONTH);
        const remain = Math.max(0, lr.durationTicks - (s.tick - lr.createdAt));
        html += '<span class="al-dur">' + months + 'mo</span>';
        html += '<span class="al-remain">' + remain.toLocaleString() + ' ticks</span>';
      } else {
        html += '<span class="al-dur">∞</span>';
        html += '<span class="al-remain">No maturity</span>';
      }
    } else if (lr.repaidAtTick != null) {
      html += '<span class="al-remain">Finished at tick ' + lr.repaidAtTick + '</span>';
    }
    html += '</div></div>';
  }
  if (sorted.length === 0) {
    html = '<div class="events-empty">No loans.</div>';
  }
  container.innerHTML = html;
  drawDefaultRateChart(s);
}

function drawDefaultRateChart(s) {
  const svg = document.getElementById('defaultRateChart');
  if (!svg) return;
  const data = s.defaultRateHistory;
  if (data.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const visible = data.slice(-300);
  const w = svg.clientWidth || 320;
  const h = 80;
  const pl = 40, pr = 4, pt = 4, pb = 16;
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
  for (let i = 0; i <= 2; i++) {
    const y = pt + (i / 2) * ih;
    const val = yMax - (i / 2) * yRng;
    html += '<text x="' + (pl - 4) + '" y="' + (y + 3.5) + '" text-anchor="end" class="chart-label">' + val.toFixed(1) + '%</text>';
    html += '<line x1="' + pl + '" y1="' + y + '" x2="' + (pl + iw) + '" y2="' + y + '" class="chart-grid"/>';
  }
  const xStep = iw / (visible.length - 1);
  let path = '';
  for (let i = 0; i < visible.length; i++) {
    const x = pl + i * xStep;
    const y = pt + (1 - (visible[i] - yMin) / yRng) * ih;
    path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }
  html += '<path d="' + path + '" class="chart-line" stroke="#f85149"/>';
  const lastVal = visible[visible.length - 1];
  html += '<text x="' + (pl + iw - 2) + '" y="' + (pt + 10) + '" text-anchor="end" class="chart-value" fill="#f85149">' + lastVal.toFixed(1) + '%</text>';
  html += '<text x="' + (pl + iw / 2) + '" y="' + (h - 2) + '" text-anchor="middle" class="chart-title">Default Rate (rolling annual)</text>';
  html += '</svg>';
  svg.innerHTML = html;
}
