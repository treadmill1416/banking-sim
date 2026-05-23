import { getState } from './state.js';
import { reserveRatio, equity, totalAssets, computeNim, computeRwa, trailingNpl, computeDefaultRate, activeLoanCapacity, countActiveLoans } from './mechanics.js';
import { fmtDollar, fmtPct, escapeHtml, gameDateStr, quarterStr, fmtTicks } from './utils.js';
import { TICKS_PER_MONTH, TICKS_PER_YEAR, HISTORY_MAX, LOAN_DEFAULT_DURATION, LOANS_PER_OFFICER, SALARY_PER_OFFICER, ANALYST_SALARY, RESEARCH_AUTO_GRAPH_COST, RESEARCH_ESTIMATE_COSTS, MAX_RISK_ESTIMATE_LEVEL, RESEARCH_BASE_RELATIVE_ERROR, RESEARCH_POINTS_PER_ANALYST, MAX_BRANCH_LEVEL, BRANCH_COSTS, BRANCH_CAPACITY_BONUS } from './constants.js';
import { getBalance, getNetIncome, getCurrentMonthPnl, ACCOUNT_TYPES } from './ledger.js';

/** @module ui - All DOM rendering. Updates the dashboard (balance sheet, metrics, P&L, loan panels, event log) and accounting tab. */

/** Main UI refresh: date, regime badge, balance sheet, metrics, rate displays, and loan counts. Called every tick. */
export function updateUI() {
  const s = getState();
  document.getElementById('gameDate').textContent = gameDateStr(s.tick);
  document.getElementById('quarter').textContent = quarterStr(s.tick);
  const badge = document.getElementById('regimeBadge');
  badge.textContent = s.regime.toUpperCase();
  badge.className = 'regime-badge regime-' + s.regime;

  const cash = getBalance(s, 'cash');
  const loans = getBalance(s, 'loansReceivable');
  const deposits = getBalance(s, 'deposits');
  const cb = getBalance(s, 'cbBorrowing');

  document.getElementById('bsReserves').textContent = fmtDollar(cash);
  document.getElementById('bsLoans').textContent = fmtDollar(loans);
  document.getElementById('bsAssetsTotal').textContent = fmtDollar(cash + loans);
  document.getElementById('bsDeposits').textContent = fmtDollar(deposits);
  document.getElementById('bsCbBorrowing').textContent = fmtDollar(cb);
  const eq = equity(s);
  const eqEl = document.getElementById('bsEquity');
  eqEl.textContent = fmtDollar(eq);
  eqEl.style.color = eq >= 0 ? '#2d8a4e' : '#cc0000';
  document.getElementById('bsLiabilitiesTotal').textContent = fmtDollar(deposits + cb + eq);

  const rr = reserveRatio(s);
  const nim = computeNim(s);
  const npl = trailingNpl(s);

  const rrEl = document.getElementById('metricReserveRatio');
  rrEl.textContent = fmtPct(rr);
  rrEl.style.color = rr >= 1 ? '#2d8a4e' : '#cc0000';
  const rwa = computeRwa(s);
  const capRatio = rwa > 0 ? (eq / rwa) * 100 : 100;
  document.getElementById('metricEquity').textContent = fmtDollar(eq);
  document.getElementById('metricEquity').title = 'RWA: ' + fmtDollar(rwa) + ' | Cap Ratio: ' + capRatio.toFixed(2) + '%';
  document.getElementById('metricEquity').style.color = eq >= 0 ? '#292929' : '#cc0000';
  document.getElementById('metricNim').textContent = fmtPct(nim);
  document.getElementById('metricNim').style.color = nim >= 0 ? '#2d8a4e' : '#cc0000';
  document.getElementById('metricNpl').textContent = fmtPct(npl);
  document.getElementById('metricNpl').style.color = npl < 2 ? '#2d8a4e' : npl < 5 ? '#d97706' : '#cc0000';

  document.getElementById('depositRateDisplay').textContent = s.depositRate.toFixed(2) + '%';
  const insEl = document.getElementById('insuranceDisplay');
  if (insEl) insEl.textContent = s.depositInsurancePct + '%';

  document.getElementById('ecbMlf').innerHTML = 'Lending Facility ' + s.ecbMlfRate.toFixed(2) + '% <span class="tip" data-tip="The rate at which banks can borrow overnight from the central bank (ceiling of the rate corridor)">?</span>';
  document.getElementById('ecbMro').innerHTML = 'Main Refi Rate ' + s.ecbMroRate.toFixed(2) + '% <span class="tip" data-tip="The central bank&#39;s main refinancing rate (mid-point of the rate corridor)">?</span>';
  document.getElementById('ecbDepo').innerHTML = 'Deposit Facility ' + s.ecbDepositRate.toFixed(2) + '% <span class="tip" data-tip="The rate at which banks can deposit excess reserves at the central bank (floor of the rate corridor)">?</span>';

  // Top metrics bar
  const tm = document.getElementById('topMetrics');
  if (tm) {
    const rrClass = rr >= 1 ? 'tm-pos' : 'tm-neg';
    const eqClass = eq >= 0 ? 'tm-pos' : 'tm-neg';
    const nimClass = nim >= 0 ? 'tm-pos' : 'tm-neg';
    const nplClass = npl < 2 ? 'tm-pos' : npl < 5 ? 'tm-warn' : 'tm-neg';
    tm.innerHTML =
      '<div class="tm-item"><span class="tm-label">Cash</span><span class="tm-value ' + (rr >= 1 ? '' : 'tm-neg') + '">' + fmtDollar(cash) + '</span></div>' +
      '<div class="tm-item"><span class="tm-label">Loans</span><span class="tm-value">' + fmtDollar(loans) + '</span></div>' +
      '<div class="tm-item"><span class="tm-label">Deposits</span><span class="tm-value">' + fmtDollar(deposits) + '</span></div>' +
      '<div class="tm-item"><span class="tm-label">Equity</span><span class="tm-value ' + eqClass + '">' + fmtDollar(eq) + '</span></div>' +
      '<div class="tm-item"><span class="tm-label">Reserve Ratio</span><span class="tm-value ' + rrClass + '">' + fmtPct(rr) + '</span></div>' +
      '<div class="tm-item"><span class="tm-label">NIM</span><span class="tm-value ' + nimClass + '">' + fmtPct(nim) + '</span></div>' +
      '<div class="tm-item"><span class="tm-label">NPL Ratio</span><span class="tm-value ' + nplClass + '">' + fmtPct(npl) + '</span></div>' +
      '<div class="tm-item"><span class="tm-label">Research</span><span class="tm-value">' + (s.researchPoints || 0) + '</span></div>';
  }

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
  updateCompliance(s);

  // Tab notification badge — pending loans
  const loansBadge = document.getElementById('loansBadge');
  if (loansBadge) {
    let _pending = 0;
    for (const _e of s.eventLog) {
      if (_e.type === 'loan_request' && _e.approved === undefined) _pending++;
    }
    loansBadge.textContent = _pending > 0 ? _pending : '';
    loansBadge.classList.toggle('show', _pending > 0);
  }

  // Marketing level display
  const mktDisp = document.getElementById('marketingLevelDisplay');
  if (mktDisp) {
    const lvl = s.marketingLevel || 0;
    mktDisp.textContent = 'Level ' + lvl + ' ($' + (lvl * 5000).toLocaleString() + '/mo)';
  }
}

/** Compliance check definitions: label, pass function, formatter */
const COMPLIANCE_CHECKS = [
  {
    label: 'Solvency',
    tip: 'Equity (assets minus liabilities) must be at least $0 to stay solvent',
    desc: 'Equity ≥ $0',
    pass: (s) => equity(s) >= 0,
    val: (s) => equity(s),
    fmt: (v) => fmtDollar(v),
  },
  {
    label: 'Capital Adequacy',
    tip: 'Equity must be at least 8% of risk-weighted assets (Basel-style)',
    desc: 'Equity / RWA ≥ 8%',
    pass: (s) => { const r = computeRwa(s); return r > 0 ? equity(s) / r >= 0.08 : true; },
    val: (s) => { const r = computeRwa(s); return r > 0 ? (equity(s) / r) * 100 : 100; },
    fmt: (v) => v.toFixed(2) + '%',
  },
  {
    label: 'Reserve Requirement',
    tip: 'Cash held at the central bank must be at least 1% of customer deposits',
    desc: 'Cash / Deposits ≥ 1%',
    pass: (s) => reserveRatio(s) >= 1,
    val: (s) => reserveRatio(s),
    fmt: (v) => v.toFixed(2) + '%',
  },
  {
    label: 'Liquidity',
    tip: 'Cash held at the central bank must be at least 5% of deposits — a stricter internal threshold',
    desc: 'Cash / Deposits ≥ 5%',
    pass: (s) => reserveRatio(s) >= 5,
    val: (s) => reserveRatio(s),
    fmt: (v) => v.toFixed(2) + '%',
  },
  {
    label: 'Non-Performing Loan Ratio',
    tip: 'Defaulted loans must not exceed 5% of the total loan portfolio',
    desc: 'Default rate ≤ 5%',
    pass: (s) => trailingNpl(s) <= 5,
    val: (s) => trailingNpl(s),
    fmt: (v) => v.toFixed(2) + '%',
  },
  {
    label: 'Staffing Capacity',
    tip: 'The number of active loans cannot exceed the collective capacity of your loan officers',
    desc: 'Active loans ≤ capacity',
    pass: (s) => countActiveLoans(s) <= activeLoanCapacity(s),
    val: (s) => countActiveLoans(s) + ' / ' + activeLoanCapacity(s),
    fmt: (v) => v,
  },
];

/** Render the Regulatory Compliance checklist. */
function updateCompliance(s) {
  const body = document.getElementById('complianceBody');
  if (!body) return;
  let html = '<div class="compliance-list">';
  for (const c of COMPLIANCE_CHECKS) {
    const ok = c.pass(s);
    html += '<div class="comp-item' + (ok ? ' comp-pass' : ' comp-fail') + '">' +
      '<span class="comp-icon">' + (ok ? '✓' : '✗') + '</span>' +
      '<span class="comp-label">' + c.label + '</span>' +
      '<span class="tip" data-tip="' + c.tip + '">?</span>' +
      '<span class="comp-desc">' + c.desc + '</span>' +
      '<span class="comp-val">' + c.fmt(c.val(s)) + '</span>' +
      '</div>';
  }
  html += '</div>';
  if (s.ticksNegativeEquity > 0) {
    const remaining = Math.max(0, 30 - s.ticksNegativeEquity);
    html += '<div class="comp-penalty">' +
      '<div class="comp-penalty-header">' +
        '<span style="color:#cc0000">⚠ INSOLVENT</span>' +
        '<span style="color:#cc0000">Seizure in ' + remaining + ' ticks</span>' +
      '</div>' +
      '<div class="comp-penalty-bar"><div class="comp-penalty-fill" style="width:' + (s.ticksNegativeEquity / 30 * 100) + '%;background:#cc0000"></div></div>' +
    '</div>';
  }
  if (s.penaltyPoints > 0) {
    const pct = s.penaltyPoints;
    const color = pct >= 80 ? '#e74c3c' : pct >= 40 ? '#e67e22' : '#f39c12';
    html += '<div class="comp-penalty">' +
      '<div class="comp-penalty-header">' +
        '<span>⚠ Penalty Points</span>' +
        '<span style="color:' + color + '">' + pct.toFixed(1) + ' / 100</span>' +
      '</div>' +
      '<div class="comp-penalty-bar"><div class="comp-penalty-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
    '</div>';
  }
  body.innerHTML = html;
}

/** Render the scrollable event log, most recent first. Shows loan request default probabilities when pending. */
export function updateEventLog() {
  const s = getState();
  const container = document.querySelector('#eventLog .event-log-content');
  if (!container) return;
  if (s.eventLog.length === 0) {
    container.innerHTML = '<div class="events-empty">Waiting for events…</div>';
    updateEventLog._lastLen = 0;
    return;
  }
  if (s.eventLog.length === updateEventLog._lastLen) return;
  updateEventLog._lastLen = s.eventLog.length;
  const scrollParent = container.parentElement;
  const prevScroll = scrollParent ? scrollParent.scrollTop : 0;
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
  if (scrollParent) scrollParent.scrollTop = prevScroll;
}

/** Format a signed dollar value for P&L display (e.g. "+$1.5M" or "−$200K").
 *  @param {number|undefined|null} n
 *  @returns {string} */
function pnlSigned(n) {
  if (n === undefined || n === null || isNaN(n)) return '—';
  if (Math.abs(n) < 0.5) return '$0';
  const abs = fmtDollar(Math.abs(n));
  return n >= 0 ? '+' + abs : '−' + abs;
}

/** Format signed dollar change in brackets, e.g. "(+$50K)" or "(−$12K)". */
function pnlDeltaStr(n) {
  if (n === undefined || n === null || isNaN(n)) return '';
  if (Math.abs(n) < 0.5) return '($0)';
  const abs = fmtDollar(Math.abs(n));
  const sign = n >= 0 ? '+' : '−';
  return '(' + sign + abs + ')';
}

/** Build a P&L table row: label | value (right-aligned) | delta (right-aligned). */
function pnlRow(label, cls, value, delta) {
  const d = delta !== undefined ? pnlDeltaStr(delta) : '';
  return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td class="pnl-num">' + value + '</td><td class="pnl-del">' + d + '</td></tr>';
}

/** Compute net P&L from a period object. */
function pnlNet(p) {
  return (p.interestIncome || 0) + (p.reserveInterestIncome || 0) - (p.interestExpense || 0) - (p.cbInterestExpense || 0) - (p.defaultLosses || 0) - (p.salaryExpense || 0) - (p.insuranceExpense || 0);
}

/** Render the Monthly P&L card showing current month with changes vs previous month in brackets. */
export function updatePnlDisplay() {
  const s = getState();
  const body = document.getElementById('pnlBody');
  if (!body) return;
  const cur = getCurrentMonthPnl(s);
  if (!cur) {
    body.innerHTML = '<div class="events-empty">—</div>';
    return;
  }
  const pct = s.tick - (s.ledgerMonthStart?.tick || 0);
  const pctDisplay = Math.min(100, Math.round(pct / TICKS_PER_MONTH * 100));
  const prev = s.ledgerLastMonth || {};
  const netCur = pnlNet(cur);
  const netPrev = pnlNet(prev);
  const neg = (v) => -v;
  body.innerHTML =
    '<div class="pnl-progress">Month ' + pctDisplay + '% complete</div>' +
    '<table class="pnl-table">' +
    '<thead><tr><th class="pnl-th-l">Item</th><th class="pnl-th-r">Amount</th><th class="pnl-th-r">Change</th></tr></thead>' +
    '<tbody>' +
    pnlRow('Loan Interest <span class="tip" data-tip="Interest earned on the loan portfolio">?</span>', 'pnl-income', pnlSigned(cur.interestIncome), (cur.interestIncome || 0) - (prev.interestIncome || 0)) +
    pnlRow('Interest on Cash <span class="tip" data-tip="Interest earned on cash reserves at the central bank deposit facility">?</span>', 'pnl-income', pnlSigned(cur.reserveInterestIncome), (cur.reserveInterestIncome || 0) - (prev.reserveInterestIncome || 0)) +
    pnlRow('Deposit Interest <span class="tip" data-tip="Interest paid to depositors on their deposits">?</span>', 'pnl-expense', pnlSigned(-(cur.interestExpense || 0)), neg(cur.interestExpense || 0) - neg(prev.interestExpense || 0)) +
    pnlRow('Central Bank Interest <span class="tip" data-tip="Interest paid on borrowings from the central bank">?</span>', 'pnl-expense', pnlSigned(-(cur.cbInterestExpense || 0)), neg(cur.cbInterestExpense || 0) - neg(prev.cbInterestExpense || 0)) +
    pnlRow('Salaries <span class="tip" data-tip="Monthly salaries for loan officers and risk analysts">?</span>', 'pnl-expense', pnlSigned(-(cur.salaryExpense || 0)), neg(cur.salaryExpense || 0) - neg(prev.salaryExpense || 0)) +
    pnlRow('Insurance <span class="tip" data-tip="Deposit insurance premium, charged monthly on covered deposits">?</span>', 'pnl-expense', pnlSigned(-(cur.insuranceExpense || 0)), neg(cur.insuranceExpense || 0) - neg(prev.insuranceExpense || 0)) +
    pnlRow('Credit Losses <span class="tip" data-tip="Losses from loan defaults and write-offs">?</span>', 'pnl-expense', pnlSigned(-(cur.defaultLosses || 0)), neg(cur.defaultLosses || 0) - neg(prev.defaultLosses || 0)) +
    '<tr class="pnl-divider-row"><td colspan="3"></td></tr>' +
    pnlRow('Net Income <span class="tip" data-tip="Total income minus total expenses for the current month">?</span>', netCur >= 0 ? 'pnl-income pnl-total' : 'pnl-expense pnl-total', pnlSigned(netCur), netCur - netPrev) +
    '</tbody></table>';
}

/** Render the legacy ledger display (Dashboard tab): balance sheet accounts, P&L accounts, and recent journal entries. */
export function updateLedgerDisplay() {
  const s = getState();
  const body = document.getElementById('ledgerBody');
  if (!body) return;
  const b = s.ledgerBalances;

  const bsAccounts = [
    { label: 'Cash', acct: 'cash' },
    { label: 'Loans Receivable', acct: 'loansReceivable' },
    { label: 'Deposits', acct: 'deposits' },
    { label: 'CB Borrowing', acct: 'cbBorrowing' },
    { label: 'Equity', acct: 'equity' },
  ];
  const bsRows = bsAccounts.map(a =>
    '<div class="lr-row"><span class="lr-label">' + a.label + '</span><span class="lr-val">' + fmtDollar(b[a.acct] || 0) + '</span></div>'
  ).join('');

  const plAccounts = [
    { label: 'Interest Income', acct: 'interestIncome' },
    { label: 'Reserve Interest Income', acct: 'reserveInterestIncome' },
    { label: 'Interest Expense', acct: 'interestExpense' },
    { label: 'CB Interest Expense', acct: 'cbInterestExpense' },
    { label: 'Default Losses', acct: 'defaultLosses' },
    { label: 'Insurance Expense', acct: 'insuranceExpense' },
  ];
  const plRows = plAccounts.map(a =>
    '<div class="lr-row"><span class="lr-label">' + a.label + '</span><span class="lr-val">' + fmtDollar(b[a.acct] || 0) + '</span></div>'
  ).join('');

  const journal = s.ledgerJournal;
  const recent = journal.slice(-15).reverse();
  const jeHtml = recent.map(je => {
    const parts = je.entries.map(e =>
      (e.debit ? fmtDollar(e.debit) + ' Dr' : '') +
      (e.debit && e.credit ? ' / ' : '') +
      (e.credit ? fmtDollar(e.credit) + ' Cr' : '')
    ).join(' | ');
    return '<div class="je-entry">' +
      '<span class="je-id">' + je.id + '</span>' +
      '<span class="je-day">Day ' + je.day + '</span>' +
      '<span class="je-desc">' + escapeHtml(je.desc) + '</span>' +
      '<span class="je-parts">' + parts + '</span>' +
      '</div>';
  }).join('') || '<div class="events-empty">No entries.</div>';

  body.innerHTML =
    '<div class="ledger-grid">' +
    '<div class="ledger-col"><div class="ledger-section">Balances</div>' + bsRows + '<div class="lr-divider"></div>' + plRows + '</div>' +
    '<div class="ledger-col"><div class="ledger-section">Journal (last 15)</div>' + jeHtml + '</div>' +
    '</div>';
}

/** Render the Loan Applications panel with per-loan rate sliders, default probability, and approve/reject buttons. */
export function updateLoanApps() {
  const s = getState();
  const container = document.getElementById('loanAppsList');
  const pending = [];
  for (const e of s.eventLog) {
    if (e.type === 'loan_request' && e.approved === undefined) pending.push(e);
  }
  const key = pending.length + ':' + pending.map(e => e.loanRequestId + ':' + e.approved).join('|');
  if (key === updateLoanApps._lastKey && container.innerHTML !== '') return;
  updateLoanApps._lastKey = key;
  // Preserve slider values across re-render
  const sliderVals = {};
  const termVals = {};
  container.querySelectorAll('.app-rate-slider').forEach(sl => { sliderVals[sl.dataset.id] = sl.value; });
  container.querySelectorAll('.term-btn.active').forEach(btn => { termVals[btn.dataset.id] = btn.dataset.term; });
  if (pending.length === 0) {
    container.innerHTML = '<div class="events-empty">No pending loan applications.</div>';
    return;
  }
  let html = '';
  const active = countActiveLoans(s);
  const capacity = activeLoanCapacity(s);
  if (active >= capacity) {
    html += '<div class="hr-warn">⚠ All loan officers are occupied (' + active + '/' + capacity + '). Hire more to process additional loans.</div>';
  }
  for (const e of pending) {
    const savedRate = sliderVals[e.loanRequestId];
    const suggested = e.suggestedRate !== null && e.suggestedRate !== undefined ? e.suggestedRate : null;
    const defaultRate = suggested !== null ? suggested : s.loanRate;
    const rate = savedRate !== undefined ? parseFloat(savedRate) : defaultRate;
    const rejectSuggested = suggested === null;
    const savedTerm = termVals[e.loanRequestId];
    const months = savedTerm ? parseInt(savedTerm) : (e.durationMonths || 12);
    const monthlyPrincipal = e.loanAmount / months;
    const monthlyRateVal = rate / 100 / 12;
    const monthlyPmt = monthlyPrincipal + e.loanAmount * monthlyRateVal;
    const interest = e.loanAmount * rate / 100;
    html += '<div class="la-entry' + (rejectSuggested ? ' la-suggest-reject' : '') + '" data-amount="' + e.loanAmount + '">';
    html += '<div class="la-top">';
    html += '<span class="la-id">' + e.loanRequestId + '</span>';
    html += '<span class="la-amount">' + fmtDollar(e.loanAmount) + '</span>';
    if (rejectSuggested) html += '<span class="la-suggest-badge">REJECT</span>';
    html += '</div>';
    html += '<div class="la-rate-row">';
    html += '<span class="la-rate-label">Rate:</span>';
    html += '<input type="range" class="app-rate-slider" data-id="' + e.loanRequestId + '" min="0.5" max="20" step="0.25" value="' + rate.toFixed(2) + '">';
    html += '<span class="rate-slider-val" data-id="' + e.loanRequestId + '">' + rate.toFixed(2) + '%</span>';
    html += '</div>';
    html += '<div class="la-term-row">';
    html += '<span class="la-term-label">Term:</span>';
    for (const t of [12, 24, 36]) {
      const active = t === months ? ' active' : '';
      html += '<button class="term-btn' + active + '" data-action="set-term" data-id="' + e.loanRequestId + '" data-term="' + t + '">' + t + 'mo</button>';
    }
    html += '</div>';
    html += '<div class="la-stats">';
    html += '<span class="la-interest">Annual: +' + fmtDollar(interest).replace(/^\$/, '') + '</span>';
    html += '<span class="la-pmt">mo: ' + fmtDollar(monthlyPmt) + '</span>';
    html += '<span class="la-prob">Risk: ' + e.defaultProb.toFixed(1) + '%</span>';
    html += '</div>';
    html += '<div class="la-actions">';
    html += '<button class="event-btn approve" data-action="approve" data-id="' + e.loanRequestId + '">APPROVE</button>';
    html += '<button class="event-btn reject" data-action="reject" data-id="' + e.loanRequestId + '">REJECT</button>';
    html += '</div>';
    html += '</div>';
  }
  container.innerHTML = html;
}

/** Render all accepted loan records sorted by status (active → repaid → defaulted), then by creation date. Includes progress bar and monthly payment info. */
export function updateAcceptedLoans() {
  const s = getState();
  const container = document.getElementById('acceptedLoansBody');
  if (!container) return;
  let a = 0, r = 0, d = 0;
  for (const lr of s.loanRecords) {
    if (lr.status === 'active') a++;
    else if (lr.status === 'repaid') r++;
    else if (lr.status === 'defaulted') d++;
  }
  const fp = s.loanRecords.length + ':' + a + ':' + r + ':' + d;
  if (fp === updateAcceptedLoans._lastFp && container.innerHTML !== '') return;
  updateAcceptedLoans._lastFp = fp;
  const scrollParent = container.parentElement;
  const prevScroll = scrollParent ? scrollParent.scrollTop : 0;
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
      if (lr.durationMonths != null) {
        const remaining = Math.max(0, lr.remainingBalance || lr.amount);
        const pct = ((lr.amount - remaining) / lr.amount * 100).toFixed(1);
        const monthlyRateVal = lr.rate / 100 / 12;
        const monthlyInt = remaining * monthlyRateVal;
        const monthlyPmt = lr.monthlyPrincipal + monthlyInt;
        html += '<span class="al-dur">' + lr.durationMonths + 'mo</span>';
        html += '<span class="al-remain">' + fmtDollar(remaining) + ' (' + pct + '%)</span>';
        html += '<span class="al-pmt">mo: ' + fmtDollar(monthlyPmt) + '</span>';
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
  if (scrollParent) scrollParent.scrollTop = prevScroll;
  drawDefaultRateChart(s);
}

/** Draw a mini SVG sparkline for the rolling annual default rate history. */
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
  html += '<path d="' + path + '" class="chart-line" stroke="#cc0000"/>';
  const lastVal = visible[visible.length - 1];
  html += '<text x="' + (pl + iw - 2) + '" y="' + (pt + 10) + '" text-anchor="end" class="chart-value" fill="#cc0000">' + lastVal.toFixed(1) + '%</text>';
  html += '<text x="' + (pl + iw / 2) + '" y="' + (h - 2) + '" text-anchor="middle" class="chart-title">Default Rate (rolling annual)</text>';
  html += '</svg>';
  svg.innerHTML = html;
}

/** Build a single accounting row. */
function acctRow(label, value, cls) {
  return '<div class="acct-row' + (cls ? ' ' + cls : '') + '"><span class="acct-label">' + label + '</span><span>' + fmtDollar(value) + '</span></div>';
}

/** Render the full Accounting tab: Chart of Accounts, Trial Balance, Income Statement, and Journal Register. */
export function updateAccountingTab() {
  const s = getState();
  const b = s.ledgerBalances;

  // Chart of Accounts
  const coaBody = document.getElementById('acctCoaBody');
  if (coaBody) {
    const coaPrev = coaBody.querySelector('.acct-body-inner')?.scrollTop || 0;
    coaBody.innerHTML = '<div class="acct-body-inner">' +
      '<div class="acct-section">Assets</div>' +
      acctRow('Cash', b.cash || 0) +
      acctRow('Loans Receivable', b.loansReceivable || 0) +
      acctRow('Total Assets', (b.cash || 0) + (b.loansReceivable || 0), 'total') +
      '<div class="acct-section">Liabilities</div>' +
      acctRow('Deposits', b.deposits || 0) +
      acctRow('CB Borrowing', b.cbBorrowing || 0) +
      acctRow('Total Liabilities', (b.deposits || 0) + (b.cbBorrowing || 0), 'total') +
      '<div class="acct-section">Equity</div>' +
      acctRow('Equity', b.equity || 0) +
      acctRow('Retained Earnings', b.retainedEarnings || 0) +
      acctRow('Current Period P&L', getNetIncome(s), 'total') +
      acctRow('Total Equity', equity(s), 'total') +
      '<div class="acct-section">Income</div>' +
      acctRow('Interest Income', b.interestIncome || 0) +
      acctRow('Reserve Interest Income', b.reserveInterestIncome || 0) +
      '<div class="acct-section">Expenses</div>' +
      acctRow('Interest Expense', b.interestExpense || 0) +
      acctRow('CB Interest Expense', b.cbInterestExpense || 0) +
      acctRow('Salary Expense', b.salaryExpense || 0) +
      acctRow('Insurance Expense', b.insuranceExpense || 0) +
      acctRow('Default Losses', b.defaultLosses || 0) +
    '</div>';
    const coaNew = coaBody.querySelector('.acct-body-inner');
    if (coaNew) coaNew.scrollTop = coaPrev;
  }

  // Trial Balance
  const tbBody = document.getElementById('acctTbBody');
  if (tbBody) {
    const tbPrev = tbBody.querySelector('.acct-body-inner')?.scrollTop || 0;
    const accounts = [
      { label: 'Cash', acct: 'cash' },
      { label: 'Loans Receivable', acct: 'loansReceivable' },
      { label: 'Deposits', acct: 'deposits' },
      { label: 'CB Borrowing', acct: 'cbBorrowing' },
      { label: 'Equity', acct: 'equity' },
      { label: 'Retained Earnings', acct: 'retainedEarnings' },
      { label: 'Interest Income', acct: 'interestIncome' },
      { label: 'Reserve Interest Income', acct: 'reserveInterestIncome' },
      { label: 'Interest Expense', acct: 'interestExpense' },
      { label: 'CB Interest Expense', acct: 'cbInterestExpense' },
      { label: 'Default Losses', acct: 'defaultLosses' },
      { label: 'Salary Expense', acct: 'salaryExpense' },
      { label: 'Insurance Expense', acct: 'insuranceExpense' },
    ];
    let totalDr = 0, totalCr = 0;
    let rows = '';
    for (const a of accounts) {
      const val = b[a.acct] || 0;
      if (val === 0) continue;
      const type = ACCOUNT_TYPES[a.acct];
      const isDr = type === 'asset' || type === 'expense';
      const dr = isDr ? val : 0;
      const cr = !isDr ? val : 0;
      totalDr += dr; totalCr += cr;
      rows += '<tr><td>' + a.label + '</td><td>' + (dr ? fmtDollar(dr) : '') + '</td><td>' + (cr ? fmtDollar(cr) : '') + '</td></tr>';
    }
    tbBody.innerHTML = '<div class="acct-body-inner"><table class="tb-table">' +
      '<thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>' +
      '<tbody>' + rows +
      '<tr class="total"><td>Total</td><td>' + fmtDollar(totalDr) + '</td><td>' + fmtDollar(totalCr) + '</td></tr>' +
      '</tbody></table></div>';
    const tbNew = tbBody.querySelector('.acct-body-inner');
    if (tbNew) tbNew.scrollTop = tbPrev;
  }

  // Income Statement
  const isBody = document.getElementById('acctIsBody');
  if (isBody) {
    const isPrev = isBody.querySelector('.acct-body-inner')?.scrollTop || 0;
    const cur = getCurrentMonthPnl(s);
    if (cur) {
      const income = (cur.interestIncome || 0) + (cur.reserveInterestIncome || 0);
      const expenses = (cur.interestExpense || 0) + (cur.cbInterestExpense || 0) + (cur.salaryExpense || 0) + (cur.insuranceExpense || 0) + (cur.defaultLosses || 0);
      isBody.innerHTML = '<div class="acct-body-inner">' +
        '<div class="acct-section">Income</div>' +
        acctRow('Interest Income', cur.interestIncome || 0) +
        acctRow('Reserve Interest Income', cur.reserveInterestIncome || 0) +
        acctRow('Total Income', income, 'total') +
        '<div class="acct-section">Expenses</div>' +
        acctRow('Interest Expense', cur.interestExpense || 0) +
        acctRow('CB Interest Expense', cur.cbInterestExpense || 0) +
        acctRow('Salary Expense', cur.salaryExpense || 0) +
        acctRow('Insurance Expense', cur.insuranceExpense || 0) +
        acctRow('Default Losses', cur.defaultLosses || 0) +
        acctRow('Total Expenses', expenses, 'total') +
        '<div class="acct-section">' +
        (income >= expenses ? 'Net Income' : 'Net Loss') + '</div>' +
        acctRow('', income - expenses, 'total') +
      '</div>';
    } else {
      isBody.innerHTML = '<div class="acct-body-inner"><div class="events-empty">—</div></div>';
    }
    const isNew = isBody.querySelector('.acct-body-inner');
    if (isNew) isNew.scrollTop = isPrev;
  }

  // Journal Register
  const jrBody = document.getElementById('acctJournalBody');
  if (jrBody) {
    const jlen = s.ledgerJournal.length;
    if (jlen !== updateAccountingTab._lastJrLen || jrBody.innerHTML === '') {
      updateAccountingTab._lastJrLen = jlen;
      const jrPrev = jrBody.querySelector('.acct-body-inner')?.scrollTop || 0;
      const journal = s.ledgerJournal;
      const recent = journal.slice(-50).reverse();
      if (recent.length === 0) {
        jrBody.innerHTML = '<div class="acct-body-inner"><div class="events-empty">No entries.</div></div>';
      } else {
        let html = '<div class="acct-body-inner">';
        for (const je of recent) {
          html += '<div class="jr-entry">';
          html += '<span class="jr-id">' + je.id + '</span>';
          html += '<span class="jr-day">Day ' + je.day + '</span>';
          html += '<span class="jr-desc">' + escapeHtml(je.desc) + '</span>';
          html += '<div class="jr-lines">';
          for (const e of je.entries) {
            const type = ACCOUNT_TYPES[e.account];
            const label = e.account.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
            if (e.debit) html += '<div class="jr-line"><span class="jr-acct">' + label + '</span><span class="jr-amt">' + fmtDollar(e.debit) + ' Dr</span></div>';
            if (e.credit) html += '<div class="jr-line"><span class="jr-acct">' + label + '</span><span class="jr-amt">' + fmtDollar(e.credit) + ' Cr</span></div>';
          }
          html += '</div></div>';
        }
        jrBody.innerHTML = html + '</div>';
      }
      const jrNew = jrBody.querySelector('.acct-body-inner');
      if (jrNew) jrNew.scrollTop = jrPrev;
    }
  }
}

/** Render the loan officers section in the Loans tab. */
export function updateLoanOfficers(s) {
  const body = document.getElementById('loanOfficerBody');
  if (!body) return;
  const active = countActiveLoans(s);
  const cap = activeLoanCapacity(s);
  const officerCost = s.numWorkers * SALARY_PER_OFFICER;
  body.innerHTML =
    '<div class="hr-stats">' +
      '<div class="hr-stat"><div class="hr-stat-label">Loan Officers <span class="tip" data-tip="Each officer manages up to ' + LOANS_PER_OFFICER + ' active loans at a time">?</span></div><div class="hr-stat-value">' + s.numWorkers + '</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Active Loans</div><div class="hr-stat-value">' + active + '</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Utilization</div><div class="hr-stat-value">' + active + ' / ' + cap + '</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Payroll</div><div class="hr-stat-value">' + fmtDollar(officerCost) + '/mo</div></div>' +
    '</div>' +
    '<div class="hr-actions">' +
      '<button class="hr-btn hire" data-action="hire"' + (s.paused === false ? '' : '') + '>Hire +1</button>' +
      '<button class="hr-btn fire" data-action="fire"' + (s.numWorkers <= 1 || active > (s.numWorkers - 1) * LOANS_PER_OFFICER ? ' disabled' : '') + '>Fire -1</button>' +
    '</div>' +
    '<div class="hr-detail">' +
      '<div class="hr-detail-row"><span>Each officer manages up to <strong>' + LOANS_PER_OFFICER + '</strong> active loans. Salary: <strong>' + fmtDollar(SALARY_PER_OFFICER) + '</strong>/mo.</span></div>' +
    '</div>';
}

/** Render the Research tab: analysts, research points, upgrades. */
export function updateResearchTab() {
  const s = getState();
  const body = document.getElementById('researchBody');
  if (!body) return;
  const analysts = s.creditAnalysts || 0;
  const analystCost = analysts * ANALYST_SALARY;
  const rp = s.researchPoints || 0;
  const riskLevel = s.riskEstimateLevel || 0;
  const autoUnlocked = s.autoLoanGraphUnlocked || false;

  // Error margin at current level
  const errMargin = (RESEARCH_BASE_RELATIVE_ERROR / (1 + riskLevel) * 100).toFixed(1);

  // Risk estimate upgrade
  let riskHtml;
  if (riskLevel >= MAX_RISK_ESTIMATE_LEVEL) {
    riskHtml = '<div class="hr-detail-row" style="color:#2d8a4e;font-weight:600">✓ MAX LEVEL — Error: ±' + errMargin + '%</div>';
  } else {
    const cost = RESEARCH_ESTIMATE_COSTS[riskLevel];
    const canBuy = rp >= cost;
    riskHtml =
      '<div class="hr-stats" style="margin-bottom:4px">' +
        '<div class="hr-stat"><div class="hr-stat-label">Level</div><div class="hr-stat-value">' + riskLevel + ' / ' + MAX_RISK_ESTIMATE_LEVEL + '</div></div>' +
        '<div class="hr-stat"><div class="hr-stat-label">Error</div><div class="hr-stat-value">±' + errMargin + '%</div></div>' +
        '<div class="hr-stat"><div class="hr-stat-label">Next Cost</div><div class="hr-stat-value">' + cost + ' RP</div></div>' +
      '</div>' +
      '<div class="hr-actions">' +
        '<button class="hr-btn hire" data-action="buy-risk-estimate"' + (canBuy ? '' : ' disabled') + '>Upgrade to Level ' + (riskLevel + 1) + '</button>' +
      '</div>';
  }

  // Auto loan processing upgrade
  let autoHtml;
  if (autoUnlocked) {
    autoHtml = '<div class="hr-detail-row" style="color:#2d8a4e;font-weight:600">✓ PURCHASED — Loans are auto-processed via risk graph</div>';
  } else {
    const canBuy = rp >= RESEARCH_AUTO_GRAPH_COST;
    autoHtml =
      '<div class="hr-stats" style="margin-bottom:4px">' +
        '<div class="hr-stat"><div class="hr-stat-label">Status</div><div class="hr-stat-value">🔒 Locked</div></div>' +
        '<div class="hr-stat"><div class="hr-stat-label">Cost</div><div class="hr-stat-value">' + RESEARCH_AUTO_GRAPH_COST + ' RP</div></div>' +
      '</div>' +
      '<div class="hr-actions">' +
        '<button class="hr-btn hire" data-action="buy-auto-graph"' + (canBuy ? '' : ' disabled') + '>Purchase</button>' +
      '</div>' +
      '<div class="hr-detail">' +
        '<div class="hr-detail-row"><span>Auto-approves or rejects loan applications using the Pricing Curve after 15 ticks, removing the need for manual decisions.</span></div>' +
      '</div>';
  }

  body.innerHTML =
    '<div class="research-points-bar">' +
      '<span class="research-rp-label">Research Points <span class="tip" data-tip="Earned monthly by Risk Analysts. Spent on R&amp;D upgrades.">?</span></span>' +
      '<span class="research-rp-value">⭐ ' + rp + '</span>' +
    '</div>' +

    '<div class="hr-section-title">Risk Analysts <span class="tip" data-tip="Each analyst produces 1 research point per month. Salary: $800/mo.">?</span></div>' +
    '<div class="hr-stats">' +
      '<div class="hr-stat"><div class="hr-stat-label">Count</div><div class="hr-stat-value">' + analysts + '</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Yield</div><div class="hr-stat-value">' + (analysts * RESEARCH_POINTS_PER_ANALYST) + ' / mo</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Payroll</div><div class="hr-stat-value">' + fmtDollar(analystCost) + '/mo</div></div>' +
    '</div>' +
    '<div class="hr-actions">' +
      '<button class="hr-btn hire" data-action="hire-analyst"' + (s.paused === false ? '' : '') + '>Hire +1</button>' +
      '<button class="hr-btn fire" data-action="fire-analyst"' + (analysts <= 0 ? ' disabled' : '') + '>Fire -1</button>' +
    '</div>' +

    '<div class="hr-section-title" style="margin-top:16px">Default Risk Estimation <span class="tip" data-tip="Reduces the relative error in displayed loan default probabilities. Less error = more accurate underwriting.">?</span></div>' +
    '<div class="hr-detail-row" style="margin-bottom:6px">Reduces the relative error in displayed default probabilities.</div>' +
    riskHtml +

    '<div class="hr-section-title" style="margin-top:16px">Automated Underwriting <span class="tip" data-tip="When purchased, loan applications are auto-approved or auto-rejected using the Pricing Curve after 15 ticks, removing the need for manual decisions.">?</span></div>' +
    autoHtml +

    // Branch expansion
    (function() {
      const bl = s.branchLevel || 0;
      if (bl >= MAX_BRANCH_LEVEL) {
        return '<div class="hr-section-title" style="margin-top:16px">Branch Network <span class="tip" data-tip="Each branch adds ' + BRANCH_CAPACITY_BONUS + ' loan officer capacity and boosts customer demand.">?</span></div>' +
          '<div class="hr-detail-row" style="color:#2d8a4e;font-weight:600">✓ MAX LEVEL — +' + (bl * BRANCH_CAPACITY_BONUS) + ' capacity</div>';
      }
      const cost = BRANCH_COSTS[bl];
      const canBuy = rp >= cost;
      return '<div class="hr-section-title" style="margin-top:16px">Branch Network <span class="tip" data-tip="Each branch adds ' + BRANCH_CAPACITY_BONUS + ' loan officer capacity and boosts customer demand.">?</span></div>' +
        '<div class="hr-stats" style="margin-bottom:4px">' +
          '<div class="hr-stat"><div class="hr-stat-label">Branches</div><div class="hr-stat-value">' + bl + ' / ' + MAX_BRANCH_LEVEL + '</div></div>' +
          '<div class="hr-stat"><div class="hr-stat-label">Capacity Bonus</div><div class="hr-stat-value">+' + (bl * BRANCH_CAPACITY_BONUS) + '</div></div>' +
          '<div class="hr-stat"><div class="hr-stat-label">Next Cost</div><div class="hr-stat-value">' + cost + ' RP</div></div>' +
        '</div>' +
        '<div class="hr-actions">' +
          '<button class="hr-btn hire" data-action="buy-branch"' + (canBuy ? '' : ' disabled') + '>Open Branch ' + (bl + 1) + '</button>' +
        '</div>' +
        '<div class="hr-detail">' +
          '<div class="hr-detail-row"><span>Each branch adds ' + BRANCH_CAPACITY_BONUS + ' loan officer capacity and attracts more customers.</span></div>' +
        '</div>';
    })();
}
