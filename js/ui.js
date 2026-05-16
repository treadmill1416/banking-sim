import { getState } from './state.js';
import { reserveRatio, equity, totalAssets, computeNim, trailingNpl, computeDefaultRate, activeLoanCapacity, countActiveLoans } from './mechanics.js';
import { fmtDollar, fmtPct, escapeHtml, gameDateStr, quarterStr, fmtTicks } from './utils.js';
import { TICKS_PER_MONTH, TICKS_PER_YEAR, HISTORY_MAX, LOAN_DEFAULT_DURATION, LOANS_PER_OFFICER, SALARY_PER_OFFICER } from './constants.js';
import { getBalance, getNetIncome, getCurrentMonthPnl, ACCOUNT_TYPES } from './ledger.js';

/** @module ui - All DOM rendering. Updates the dashboard (balance sheet, metrics, P&L, loan panels, event log) and accounting tab. */

/** Main UI refresh: date, regime badge, balance sheet, metrics, rate displays, and loan counts. Called every tick. */
export function updateUI() {
  const s = getState();
  document.getElementById('gameDate').textContent = gameDateStr(s.tick);
  document.getElementById('quarter').textContent = quarterStr(s.tick);
  document.getElementById('autoAcceptDisplay').textContent = s.autoAcceptThreshold.toFixed(1) + '%';
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
  eqEl.style.color = eq >= 0 ? '#3fb950' : '#f85149';
  document.getElementById('bsLiabilitiesTotal').textContent = fmtDollar(deposits + cb + eq);

  const rr = reserveRatio(s);
  const nim = computeNim(s);
  const npl = trailingNpl(s);

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
  const insEl = document.getElementById('insuranceDisplay');
  if (insEl) insEl.textContent = s.depositInsurancePct + '%';

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

/** Build a single P&L row. */
function pnlRow(label, value, cls) {
  return '<div class="pnl-row"><span class="pnl-label">' + label + '</span><span class="pnl-value ' + cls + '">' + value + '</span></div>';
}

/** Build a complete P&L section with all income/expense rows and net total. */
function pnlSection(title, p, cls) {
  const net = (p.interestIncome || 0) + (p.reserveInterestIncome || 0) - (p.interestExpense || 0) - (p.cbInterestExpense || 0) - (p.defaultLosses || 0) - (p.salaryExpense || 0) - (p.insuranceExpense || 0);
  const netCls = net >= 0 ? 'pnl-income' : 'pnl-expense';
  return '<div class="' + cls + '">' + title + '</div>' +
    '<div class="pnl-rows">' +
    pnlRow('Loan Interest', pnlSigned(p.interestIncome), 'pnl-income') +
    pnlRow('Reserve Interest', pnlSigned(p.reserveInterestIncome), 'pnl-income') +
    pnlRow('Deposit Interest', pnlSigned(-(p.interestExpense || 0)), 'pnl-expense') +
    pnlRow('CB Interest', pnlSigned(-(p.cbInterestExpense || 0)), 'pnl-expense') +
    pnlRow('Salaries', pnlSigned(-(p.salaryExpense || 0)), 'pnl-expense') +
    pnlRow('Insurance', pnlSigned(-(p.insuranceExpense || 0)), 'pnl-expense') +
    pnlRow('Defaults', pnlSigned(-(p.defaultLosses || 0)), 'pnl-expense') +
    '<div class="pnl-divider"></div>' +
    pnlRow('Net P&L', pnlSigned(net), netCls) +
    '</div>';
}

/** Render the Monthly P&L card showing last completed month and current month-to-date. */
export function updatePnlDisplay() {
  const s = getState();
  const body = document.getElementById('pnlBody');
  if (!body) return;
  let html = '';
  if (s.ledgerLastMonth) {
    html += pnlSection('Last Month (completed)', s.ledgerLastMonth, 'pnl-progress pnl-progress-prev');
    html += '<div class="pnl-spacer"></div>';
  }
  const cur = getCurrentMonthPnl(s);
  if (cur) {
    const pct = s.tick - (s.ledgerMonthStart?.tick || 0);
    const pctDisplay = Math.min(100, Math.round(pct / TICKS_PER_MONTH * 100));
    html += pnlSection('Month ' + pctDisplay + '% complete', cur, 'pnl-progress');
  } else {
    html += '<div class="events-empty">—</div>';
  }
  body.innerHTML = html;
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
  container.querySelectorAll('.app-rate-slider').forEach(sl => { sliderVals[sl.dataset.id] = sl.value; });
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
    const rate = savedRate !== undefined ? parseFloat(savedRate) : s.loanRate;
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
  html += '<path d="' + path + '" class="chart-line" stroke="#f85149"/>';
  const lastVal = visible[visible.length - 1];
  html += '<text x="' + (pl + iw - 2) + '" y="' + (pt + 10) + '" text-anchor="end" class="chart-value" fill="#f85149">' + lastVal.toFixed(1) + '%</text>';
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
  }

  // Trial Balance
  const tbBody = document.getElementById('acctTbBody');
  if (tbBody) {
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
  }

  // Income Statement
  const isBody = document.getElementById('acctIsBody');
  if (isBody) {
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
  }

  // Journal Register
  const jrBody = document.getElementById('acctJournalBody');
  if (jrBody) {
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
  }
}

/** Render the Human Resources tab: loan officer count, capacity usage, hire/fire buttons, and salary info. */
export function updateHrTab() {
  const s = getState();
  const body = document.getElementById('hrBody');
  if (!body) return;
  const active = countActiveLoans(s);
  const cap = activeLoanCapacity(s);
  const cost = s.numWorkers * SALARY_PER_OFFICER;
  body.innerHTML =
    '<div class="hr-stats">' +
      '<div class="hr-stat"><div class="hr-stat-label">Loan Officers</div><div class="hr-stat-value">' + s.numWorkers + '</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Active Loans</div><div class="hr-stat-value">' + active + '</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Capacity</div><div class="hr-stat-value">' + active + ' / ' + cap + '</div></div>' +
      '<div class="hr-stat"><div class="hr-stat-label">Monthly Salary Cost</div><div class="hr-stat-value">' + fmtDollar(cost) + '</div></div>' +
    '</div>' +
    '<div class="hr-actions">' +
      '<button class="hr-btn hire" data-action="hire"' + (s.paused === false ? '' : '') + '>Hire +1</button>' +
      '<button class="hr-btn fire" data-action="fire"' + (s.numWorkers <= 1 || active > (s.numWorkers - 1) * LOANS_PER_OFFICER ? ' disabled' : '') + '>Fire -1</button>' +
    '</div>' +
    '<div class="hr-detail">' +
      '<div class="hr-detail-row"><span>Each loan officer can manage up to <strong>' + LOANS_PER_OFFICER + '</strong> active loans.</span></div>' +
      '<div class="hr-detail-row"><span>Salary: <strong>' + fmtDollar(SALARY_PER_OFFICER) + '</strong> per officer per month.</span></div>' +
    '</div>';
}
