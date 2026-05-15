import { getState } from './state.js';
import { reserveRatio, equity, totalAssets, computeNim, trailingNpl } from './mechanics.js';
import { fmtDollar, fmtPct, escapeHtml, gameDateStr, quarterStr } from './utils.js';

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
    html += '<div class="la-entry">';
    html += '<div class="la-info">';
    html += '<span class="la-amount">' + fmtDollar(e.loanAmount) + '</span>';
    html += '<span class="la-prob">Default risk: ' + e.defaultProb.toFixed(1) + '%</span>';
    html += '</div>';
    html += '<div class="la-btns">';
    html += '<input type="number" class="rate-input" data-id="' + e.loanRequestId + '" value="' + (e.proposedRate || s.loanRate).toFixed(2) + '" step="0.25" min="0.5" max="20">';
    html += '<button class="event-btn approve" data-action="approve" data-id="' + e.loanRequestId + '">APPROVE</button>';
    html += '<button class="event-btn reject" data-action="reject" data-id="' + e.loanRequestId + '">REJECT</button>';
    html += '</div></div>';
  }
  container.innerHTML = html;
}
