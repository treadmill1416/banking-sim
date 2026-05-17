import { getState, addEvent } from './state.js';
import { postJournal, getBalance, getEquity } from './ledger.js';
import { fmtDollar, fmtPct } from './utils.js';
import { DEFAULT_WINDOW } from './constants.js';
import { recomputeWeightedLoanRate } from './mechanics.js';
import { updateAll, resetGame, intervalId } from './main.js';
import { gameDateStr } from './utils.js';

export function initTesting() {
  const s = getState();
  const bar = document.getElementById('debugBar');
  if (!s.debug) {
    if (bar) bar.style.display = 'none';
    return;
  }
  if (bar) bar.style.display = '';
  updateDebugEquity();
  document.getElementById('defaultAllLoansBtn')?.addEventListener('click', defaultAllLoans);
  document.getElementById('startBankRunBtn')?.addEventListener('click', startBankRun);
  document.getElementById('finishGameBtn')?.addEventListener('click', finishGame);
  document.getElementById('gameoverRestart')?.addEventListener('click', () => {
    document.getElementById('gameoverOverlay').style.display = 'none';
    resetGame();
  });
}

export function updateDebugEquity() {
  const s = getState();
  const el = document.getElementById('debugEquity');
  if (!el || !s.debug) return;
  const cur = getEquity(s);
  const prev = s.debugMonthStartEquity || cur;
  const chg = cur - prev;
  const pct = prev !== 0 ? (chg / prev) * 100 : 0;
  const cls = chg > 0 ? 'eq-chg-pos' : chg < 0 ? 'eq-chg-neg' : 'eq-chg-zero';
  const arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '–';
  const eqCls = cur >= 0 ? 'eq-val' : 'eq-val eq-val-neg';
  el.innerHTML =
    'Equity: <span class="' + eqCls + '">' + fmtDollar(cur) + '</span>' +
    ' <span class="' + cls + '">' + arrow + ' ' + fmtDollar(chg) + ' (' + pct.toFixed(2) + '%)</span>';
  const mroEl = document.getElementById('debugMro');
  if (mroEl) mroEl.textContent = 'MRO: ' + s.ecbMroRate.toFixed(2) + '%';
}

function startBankRun() {
  const s = getState();
  if (s.bankRunActive) {
    if (!confirm('A bank run is already in progress! Start another?')) return;
  }
  const deposits = getBalance(s, 'deposits');
  if (deposits < 1000) {
    alert('Not enough deposits for a bank run.');
    return;
  }
  const pct = 0.15 + Math.random() * 0.10;
  const outflow = deposits * pct;
  const actual = Math.min(outflow, deposits);
  postJournal(s, [
    { account: 'deposits', debit: actual },
    { account: 'cash', credit: actual },
  ], 'Bank run triggered');
  s.bankRunActive = true;
  s.bankRunStartTick = s.tick;
  addEvent(s, 'deposit', 'BANK RUN initiated — ' + fmtDollar(actual) + ' fled in panic!', 'event-expense');
  updateAll();
}

function defaultAllLoans() {
  if (!confirm('Default ALL active loans? This cannot be undone.')) return;
  const s = getState();
  let count = 0;
  let totalAmount = 0;
  for (const lr of s.loanRecords) {
    if (lr.status !== 'active') continue;
    const bal = lr.remainingBalance || lr.amount;
    const actual = Math.min(bal, getBalance(s, 'loansReceivable'));
    if (actual <= 0) continue;
    postJournal(s, [
      { account: 'defaultLosses', debit: actual },
      { account: 'loansReceivable', credit: actual },
    ], 'Loan default (testing) - ' + lr.id);
    s.cumulativeDefaults += actual;
    s.defaultTicks.push(s.tick);
    s.defaultAmounts.push(actual);
    while (s.defaultTicks.length > 0 && s.tick - s.defaultTicks[0] > DEFAULT_WINDOW) {
      s.defaultTicks.shift();
      s.defaultAmounts.shift();
    }
    lr.remainingBalance = Math.max(0, (lr.remainingBalance || lr.amount) - actual);
    lr.status = 'defaulted';
    lr.repaidAtTick = s.tick;
    addEvent(s, 'default', 'Loan defaulted (testing): ' + fmtDollar(actual) + ' (' + lr.id + ')', 'event-expense');
    count++;
    totalAmount += actual;
  }
  if (count > 0) {
    recomputeWeightedLoanRate(s);
    addEvent(s, 'info', 'Testing: defaulted ' + count + ' loans totaling ' + fmtDollar(totalAmount), 'event-warn');
  }
  updateAll();
}

function finishGame() {
  const s = getState();
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  s.paused = true;
  const body = document.getElementById('gameoverBody');

  const cash = getBalance(s, 'cash');
  const loans = getBalance(s, 'loansReceivable');
  const deposits = getBalance(s, 'deposits');
  const cb = getBalance(s, 'cbBorrowing');
  const eq = getEquity(s);
  let active = 0, repaid = 0, defaulted = 0, totalApproved = 0;
  for (const lr of s.loanRecords) {
    if (lr.status === 'active') active++;
    else if (lr.status === 'repaid') repaid++;
    else if (lr.status === 'defaulted') defaulted++;
    totalApproved++;
  }

  body.innerHTML =
    '<div class="gameover-summary">' +
      '<div class="go-row"><span class="go-label">Game Duration</span><span class="go-val">' + gameDateStr(s.tick) + '</span></div>' +
      '<div class="go-row"><span class="go-label">Total Ticks</span><span class="go-val">' + s.tick.toLocaleString() + '</span></div>' +
    '</div>' +
    '<div class="go-section">Final Balance Sheet</div>' +
    '<div class="go-grid">' +
      '<div class="go-col"><div class="go-col-head">Assets</div>' +
        '<div class="go-row"><span class="go-label">Reserves</span><span class="go-val">' + fmtDollar(cash) + '</span></div>' +
        '<div class="go-row"><span class="go-label">Loans</span><span class="go-val">' + fmtDollar(loans) + '</span></div>' +
        '<div class="go-row go-total"><span class="go-label">Total</span><span class="go-val">' + fmtDollar(cash + loans) + '</span></div>' +
      '</div>' +
      '<div class="go-col"><div class="go-col-head">Liabilities</div>' +
        '<div class="go-row"><span class="go-label">Deposits</span><span class="go-val">' + fmtDollar(deposits) + '</span></div>' +
        '<div class="go-row"><span class="go-label">CB Borrowing</span><span class="go-val">' + fmtDollar(cb) + '</span></div>' +
        '<div class="go-row"><span class="go-label">Equity</span><span class="go-val ' + (eq >= 0 ? 'go-positive' : 'go-negative') + '">' + fmtDollar(eq) + '</span></div>' +
        '<div class="go-row go-total"><span class="go-label">Total</span><span class="go-val">' + fmtDollar(deposits + cb + eq) + '</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="go-section">Loan Summary</div>' +
    '<div class="go-row"><span class="go-label">Total Loans Approved</span><span class="go-val">' + totalApproved + '</span></div>' +
    '<div class="go-row"><span class="go-label">Active</span><span class="go-val">' + active + '</span></div>' +
    '<div class="go-row"><span class="go-label">Repaid</span><span class="go-val">' + repaid + '</span></div>' +
    '<div class="go-row"><span class="go-label">Defaulted</span><span class="go-val go-negative">' + defaulted + '</span></div>';

  document.getElementById('gameoverOverlay').style.display = 'flex';
}
