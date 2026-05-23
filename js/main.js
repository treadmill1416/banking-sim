import { getState, setState, createInitialState, load, save, reset as resetState } from './state.js';
import { accrueInterest, processDefaults, checkReserves, expireOldLoans, processAutoDecisions, reserveRatio, computeNim, computeRwa, equity, totalAssets, tryDepositStability, processLoanPayments, computeDefaultRate, processSalaries, activeLoanCapacity, countActiveLoans, updatePenalty, checkSolvency, processResearch } from './mechanics.js';
import { tryDepositFlow, tryLoanRequest, tryEcbChange, tryRegimeChange } from './events.js';
import { approveLoan, rejectLoan, cbBorrow, cbRepay } from './actions.js';
import { fmtDollar, gameDateStr, fmtTicks } from './utils.js';
import { updateUI, updateEventLog, updateLoanApps, updatePnlDisplay, updateAcceptedLoans, updateLedgerDisplay, updateAccountingTab, updateLoanOfficers, updateResearchTab } from './ui.js';
import { updateCharts } from './charts.js';
import { HISTORY_MAX, LOANS_PER_OFFICER, RESEARCH_ESTIMATE_COSTS, RESEARCH_AUTO_GRAPH_COST, TICKS_PER_YEAR, MAX_RISK_ESTIMATE_LEVEL, MAX_BRANCH_LEVEL, BRANCH_COSTS, MARKETING_COST_PER_LEVEL, MARKETING_MAX_LEVEL } from './constants.js';
import { addEvent } from './state.js';
import { initAdmin } from './admin.js';
import { initTesting, updateDebugEquity } from './testing.js';
import { postDailyInterest, updateLedgerPnl, initLedger } from './ledger.js';
import { initRiskGraph, updateRiskGraph } from './riskGraph.js';

/** @module main - Application entry point. Orchestrates the game loop, event delegation, initialization, tab switching, and collapsible cards. */

/** The active setInterval ID for the game loop. null when paused. */
export let intervalId = null;

/** Core game tick: advance time by 1 hour, run all mechanics and events, update UI, save.
 *  Order: accrue interest → process defaults → P&L snapshots → loan payments →
 *  deposit flows → deposit stability → loan requests → auto decisions →
 *  ECB changes → regime changes → expire old loans → check reserves. */
function tick() {
  const s = getState();
  s.tick++;

  accrueInterest(s);
  processDefaults(s);
  updateLedgerPnl(s);
  processSalaries(s);
  processResearch(s);
  processLoanPayments(s);
  tryDepositFlow(s);
  tryDepositStability(s);
  tryLoanRequest(s);
  processAutoDecisions(s);
  tryEcbChange(s);
  tryRegimeChange(s);
  expireOldLoans(s);
  checkReserves(s);
  updatePenalty(s);
  checkSolvency(s);

  if (s.penaltyPoints >= 100) { triggerGameOver(s); return; }
  if (s.ticksNegativeEquity >= 30) { triggerGameOverInsolvent(s); return; }

  if (s.tick % 2 === 0) postDailyInterest(s);

  s.defaultRateHistory.push(computeDefaultRate(s));
  if (s.defaultRateHistory.length > HISTORY_MAX) s.defaultRateHistory.shift();

  s.historyRR.push(reserveRatio(s));
  s.historyNIM.push(computeNim(s));
  s.historyEQ.push(equity(s));
  if (s.historyRR.length > HISTORY_MAX) { s.historyRR.shift(); s.historyNIM.shift(); s.historyEQ.shift(); }

  // Slow to 1x on critical events
  if (s.speed > 1 && s.eventLog.length > 0) {
    const last = s.eventLog[0];
    if (last.tick === s.tick && (
      last.type === 'regime' ||
      (last.type === 'regulatory' && last.msg.includes('SOLVENCY')) ||
      last.msg.includes('deposit flight') ||
      last.msg.includes('bank run') ||
      last.type === 'default'
    )) {
      setSpeed(1);
    }
  }

  updateUI();
  updatePnlDisplay();
  if (s.tick % 2 === 0) { updateLedgerDisplay(); updateAccountingTab(); }
  updateCharts();
  updateRiskGraph();
  updateEventLog();
  updateLoanApps();
  updateAcceptedLoans();
  updateDebugEquity();
  save();
}

/** Restart the game loop interval at the current speed. Batches multiple ticks per frame at high speeds (≥50 ticks/s). */
export function updateLoop() {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  const s = getState();
  if (s.paused) return;
  const ms = Math.round(1000 / s.speed);
  if (ms < 20) {
    const batch = Math.floor(s.speed);
    intervalId = setInterval(() => { for (let i = 0; i < batch; i++) tick(); }, 1000);
  } else {
    intervalId = setInterval(tick, ms);
  }
}

/** Reset the game with admin-provided overrides merged into initial state. Reinitializes ledger, history, and UI.
 *  @param {object} overrides - State properties to override */
export function applyAdminConfig(overrides) {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  resetState();
  const s = getState();
  Object.assign(s, overrides);
  s.tick = 0;
  s.paused = true;
  s.weightedLoanRate = overrides.loanRate || s.loanRate;
  initLedger(s);
  s.historyRR = [reserveRatio(s)];
  s.historyNIM = [computeNim(s)];
  s.historyEQ = [equity(s)];
  s.eventLog = [];
  s.nextEventId = 1;
  s.cumulativeDefaults = 0;
  s.defaultTicks = [];
  s.defaultAmounts = [];
  s.pendingLoans = {};
  s.loanRecords = s.loans > 0 ? [{
    id: 'loan-0',
    amount: s.loans,
    rate: s.loanRate,
    durationMonths: null,
    monthlyPrincipal: 0,
    remainingBalance: s.loans,
    defaultProb: 2,
    status: 'active',
    createdAt: 0,
    repaidAtTick: null,
    lastPaymentTick: 0,
  }] : [];
  s.nextLoanRecordId = 1;
  s.defaultRateHistory = [];
  document.getElementById('depositRateSlider').value = s.depositRate;
  document.getElementById('autoCbCheckbox').checked = s.autoCbBorrowing;
  initRiskGraph();
  document.getElementById('pauseBtn').textContent = '▶';
  updateAll();
  updateLoop();
}

/** Change game speed and restart the loop. Highlights the active speed button. */
function setSpeed(speed) {
  getState().speed = speed;
  document.querySelectorAll('.speed-btn[data-speed]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.speed) === speed);
  });
  updateLoop();
}

/** Pause or resume the game loop. Updates the pause button label. */
function togglePause() {
  const s = getState();
  s.paused = !s.paused;
  document.getElementById('pauseBtn').textContent = s.paused ? '▶' : '⏸';
  updateLoop();
}

/** Compute a performance score from game state. */
function computeScore(s) {
  const startEq = 100000;
  const peakEq = Math.max(...s.historyEQ, startEq);
  const survivalYears = s.tick / TICKS_PER_YEAR;
  const base = (peakEq / startEq) * Math.max(0.1, survivalYears);
  let mult = 1;
  if (s.riskEstimateLevel >= MAX_RISK_ESTIMATE_LEVEL) mult += 0.2;
  if (s.autoLoanGraphUnlocked) mult += 0.1;
  if ((s.branchLevel || 0) >= MAX_BRANCH_LEVEL) mult += 0.2;
  if (s.numWorkers > 1) mult += Math.min(0.5, (s.numWorkers - 1) * 0.05);
  const defPenalty = Math.min(0.5, (s.cumulativeDefaults || 0) / Math.max(1, peakEq) * 0.1);
  mult -= defPenalty;
  return Math.round(base * Math.max(0.1, mult));
}

/** Build game-over summary HTML shared by both trigger functions. */
function gameOverSummaryHtml(s, reason) {
  const score = computeScore(s);
  const peakEq = Math.max(...s.historyEQ, 100000);
  const totalLoanAmt = s.loanRecords.reduce((sum, lr) => sum + lr.amount, 0);
  const defCount = s.loanRecords.filter(lr => lr.status === 'defaulted').length;
  const repCount = s.loanRecords.filter(lr => lr.status === 'repaid').length;
  return (
    '<div class="gameover-reason">' + reason + '</div>' +
    '<div class="gameover-sub">Survived ' + fmtTicks(s.tick) + '</div>' +
    '<div class="go-score"><div class="go-score-value">' + score.toLocaleString() + '</div><div class="go-score-label">Performance Score</div></div>' +
    '<div class="go-stats">' +
      '<div class="go-stat"><div class="go-stat-label">Peak Equity</div><div class="go-stat-value">' + fmtDollar(peakEq) + '</div></div>' +
      '<div class="go-stat"><div class="go-stat-label">Loans Originated</div><div class="go-stat-value">' + s.loanRecords.length + '</div></div>' +
      '<div class="go-stat"><div class="go-stat-label">Repaid</div><div class="go-stat-value">' + repCount + '</div></div>' +
      '<div class="go-stat"><div class="go-stat-label">Defaulted</div><div class="go-stat-value">' + defCount + '</div></div>' +
      '<div class="go-stat"><div class="go-stat-label">Peak Loan Officers</div><div class="go-stat-value">' + s.numWorkers + '</div></div>' +
      '<div class="go-stat"><div class="go-stat-label">Research Upgrades</div><div class="go-stat-value">Lv.' + (s.riskEstimateLevel || 0) + '</div></div>' +
    '</div>'
  );
}

/** Pause the game and show the Game Over overlay with penalty reason. */
function triggerGameOver(s) {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  s.paused = true;
  const body = document.getElementById('gameoverBody');
  body.innerHTML = gameOverSummaryHtml(s, '⚠ REGULATORS SEIZED THE BANK — Penalty Points: ' + s.penaltyPoints + '/100');
  document.getElementById('gameoverOverlay').style.display = 'flex';
}

/** Pause the game and show the Game Over overlay for insolvency (negative equity too long). */
function triggerGameOverInsolvent(s) {
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  s.paused = true;
  const body = document.getElementById('gameoverBody');
  body.innerHTML = gameOverSummaryHtml(s, '⚠ BANK DECLARED INSOLVENT — Negative equity for ' + s.ticksNegativeEquity + ' ticks');
  document.getElementById('gameoverOverlay').style.display = 'flex';
}

/** Reset game to initial state after user confirmation. Reinitializes ledger, loan records, and history. */
export function resetGame() {
  if (!confirm('Reset game? All progress will be lost.')) return;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  resetState();
  const s = getState();
  if (s.loans > 0) {
    s.loanRecords.push({
      id: 'loan-0',
      amount: s.loans,
      rate: s.loanRate,
      durationMonths: null,
      monthlyPrincipal: 0,
      remainingBalance: s.loans,
      defaultProb: 2,
      status: 'active',
      createdAt: 0,
      repaidAtTick: null,
      lastPaymentTick: 0,
    });
  }
  initLedger(s);
  s.historyRR.push(reserveRatio(s));
  s.historyNIM.push(computeNim(s));
  s.historyEQ.push(equity(s));
  document.getElementById('autoCbCheckbox').checked = s.autoCbBorrowing;
  initRiskGraph();
  document.getElementById('pauseBtn').textContent = s.paused ? '▶' : '⏸';
  updateAll();
  updateLoop();
}

// --- Event delegation handlers ---

/** Handle speed button clicks via event delegation. */
function onSpeedClick(e) {
  const btn = e.target.closest('.speed-btn[data-speed]');
  if (btn) setSpeed(parseInt(btn.dataset.speed));
}

/** Handle approve/reject/term button clicks in the loan applications panel via event delegation. */
function onLoanAppsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'set-term') {
    btn.closest('.la-term-row').querySelectorAll('.term-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateLoanApps();
    return;
  }
  if (btn.dataset.action === 'approve') {
    const s = getState();
    const entry = s.eventLog.find(e2 => e2.loanRequestId === id && e2.type === 'loan_request');
    if (entry) {
      const pct = entry.loanAmount / Math.max(1, totalAssets(s)) * 100;
      if (pct >= 10 && !confirm('This loan is ' + fmtDollar(entry.loanAmount) + ' (' + pct.toFixed(1) + '% of assets). Approve?')) return;
    }
    approveLoan(id);
    updateAll();
  }
  if (btn.dataset.action === 'reject') {
    const s = getState();
    const entry = s.eventLog.find(e2 => e2.loanRequestId === id && e2.type === 'loan_request');
    if (entry) {
      const pct = entry.loanAmount / Math.max(1, totalAssets(s)) * 100;
      if (pct >= 10 && !confirm('Reject ' + fmtDollar(entry.loanAmount) + ' loan (' + pct.toFixed(1) + '% of assets)?')) return;
    }
    rejectLoan(id);
    updateAll();
  }
}

/** Borrow from CB via UI button, then refresh all displays. */
function onCdBorrowClick() { cbBorrow(); updateAll(); }
/** Repay CB borrowing via UI button, then refresh all displays. */
function onCdRepayClick() { cbRepay(); updateAll(); }
/** Hire a loan officer. */
function onHireClick() {
  const s = getState();
  s.numWorkers++;
  addEvent(s, 'hr', 'Hired a loan officer — now ' + s.numWorkers + ' total', 'event-info');
  updateAll();
}
/** Fire a loan officer if it won't violate the capacity constraint. */
function onFireClick() {
  const s = getState();
  if (s.numWorkers <= 1) return;
  if (countActiveLoans(s) > (s.numWorkers - 1) * LOANS_PER_OFFICER) {
    addEvent(s, 'hr', 'Cannot fire — active loans exceed reduced capacity', 'event-warn');
    return;
  }
  s.numWorkers--;
  addEvent(s, 'hr', 'Fired a loan officer — now ' + s.numWorkers + ' total', 'event-expense');
  updateAll();
}
/** Hire a credit analyst. */
function onHireAnalyst() {
  const s = getState();
  s.creditAnalysts = (s.creditAnalysts || 0) + 1;
  addEvent(s, 'hr', 'Hired a credit analyst — now ' + s.creditAnalysts + ' total', 'event-info');
  updateAll();
}
/** Fire a credit analyst. */
function onFireAnalyst() {
  const s = getState();
  if ((s.creditAnalysts || 0) <= 0) return;
  s.creditAnalysts--;
  addEvent(s, 'hr', 'Fired a credit analyst — now ' + s.creditAnalysts + ' total', 'event-expense');
  updateAll();
}
/** Buy the next level of risk estimation. */
function onBuyRiskEstimate() {
  const s = getState();
  const level = s.riskEstimateLevel || 0;
  if (level >= 5) return;
  const cost = RESEARCH_ESTIMATE_COSTS[level];
  if ((s.researchPoints || 0) < cost) return;
  s.researchPoints -= cost;
  s.riskEstimateLevel = level + 1;
  addEvent(s, 'research', 'Risk estimation upgraded to level ' + s.riskEstimateLevel + ' (error: ±' + (50 / (1 + s.riskEstimateLevel)).toFixed(1) + '%)', 'event-info');
  updateAll();
}
/** Buy auto loan graph processing. */
function onBuyAutoGraph() {
  const s = getState();
  if (s.autoLoanGraphUnlocked) return;
  if ((s.researchPoints || 0) < RESEARCH_AUTO_GRAPH_COST) return;
  s.researchPoints -= RESEARCH_AUTO_GRAPH_COST;
  s.autoLoanGraphUnlocked = true;
  addEvent(s, 'research', 'Auto loan processing unlocked! Loans will now be processed automatically via the risk graph.', 'event-income');
  updateAll();
}

/** Reset the pricing curve to defaults and pause the game. */
function onResetCurve() {
  const s = getState();
  s.riskRateMap = [
    { risk: 0, rate: 5.5 },
    { risk: 10, rate: 7.0 },
    { risk: 20, rate: 10.0 },
    { risk: 35, rate: 20.0 },
    { risk: 50, rate: 20.0 },
  ];
  if (!s.paused) togglePause();
  updateAll();
}

/** Buy the next branch level. */
function onBuyBranch() {
  const s = getState();
  const bl = s.branchLevel || 0;
  if (bl >= MAX_BRANCH_LEVEL) return;
  const cost = BRANCH_COSTS[bl];
  if ((s.researchPoints || 0) < cost) return;
  s.researchPoints -= cost;
  s.branchLevel = bl + 1;
  addEvent(s, 'research', 'Opened Branch ' + (bl + 1) + '! Loan capacity +' + 5 + ', customer demand boosted.', 'event-income');
  updateAll();
}

/** Refresh all UI displays and save state. Used after any player action (approve/reject/borrow/repay). */
export function updateAll() {
  updateUI();
  updatePnlDisplay();
  updateLedgerDisplay();
  updateAccountingTab();
  updateLoanOfficers(getState());
  updateResearchTab();
  updateCharts();
  updateEventLog();
  updateLoanApps();
  updateAcceptedLoans();
  updateDebugEquity();
  updateRiskGraph();
  save();
}

/** Handle keyboard shortcuts. */
function onKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === ' ' || e.key === 'Space') { e.preventDefault(); togglePause(); return; }
  if (e.key === '1') { setSpeed(1); return; }
  if (e.key === '3') { setSpeed(3); return; }
  if (e.key === '5') { setSpeed(5); return; }
  if (e.key === '0') { setSpeed(100); return; }
  if (e.key === 'a' || e.key === 'A') {
    const s = getState();
    const first = s.eventLog.find(e2 => e2.type === 'loan_request' && e2.approved === undefined);
    if (first) { onLoanAppsClick({ target: { closest: () => ({ dataset: { action: 'approve', id: first.loanRequestId } }) } }); }
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    const s = getState();
    const first = s.eventLog.find(e2 => e2.type === 'loan_request' && e2.approved === undefined);
    if (first) { onLoanAppsClick({ target: { closest: () => ({ dataset: { action: 'reject', id: first.loanRequestId } }) } }); }
    return;
  }
}

/** Wire all DOM event listeners: speed buttons, pause, reset, loan actions, sliders, CB desk, tab bar. Called once on init. */
function bindEvents() {
  document.querySelector('.header-controls').addEventListener('click', onSpeedClick);
  document.getElementById('pauseBtn').addEventListener('click', togglePause);
  document.getElementById('resetBtn').addEventListener('click', resetGame);
  document.getElementById('loanAppsList').addEventListener('click', onLoanAppsClick);
  document.getElementById('loanOfficerBody').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'hire') onHireClick();
    if (btn.dataset.action === 'fire') onFireClick();
  });
  document.getElementById('researchBody').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'hire-analyst') onHireAnalyst();
    if (btn.dataset.action === 'fire-analyst') onFireAnalyst();
    if (btn.dataset.action === 'buy-risk-estimate') onBuyRiskEstimate();
    if (btn.dataset.action === 'buy-auto-graph') onBuyAutoGraph();
    if (btn.dataset.action === 'buy-branch') onBuyBranch();
  });
  document.getElementById('resetCurveBtn').addEventListener('click', onResetCurve);
  document.getElementById('loanAppsList').addEventListener('input', function (e) {
    const slider = e.target.closest('.app-rate-slider');
    if (!slider) return;
    const entry = slider.closest('.la-entry');
    const amount = parseFloat(entry.dataset.amount);
    const rate = parseFloat(slider.value);
    const activeTerm = entry.querySelector('.term-btn.active');
    const months = activeTerm ? parseInt(activeTerm.dataset.term) : 12;
    if (amount && rate) {
      const interest = amount * rate / 100;
      const monthlyPrincipal = amount / months;
      const monthlyRateVal = rate / 100 / 12;
      const monthlyPmt = monthlyPrincipal + amount * monthlyRateVal;
      entry.querySelector('.la-interest').textContent = 'Annual: +' + fmtDollar(interest).replace(/^\$/, '');
      entry.querySelector('.la-pmt').textContent = 'mo: ' + fmtDollar(monthlyPmt);
      entry.querySelector('.rate-slider-val').textContent = rate.toFixed(2) + '%';
    }
  });
  document.getElementById('cbBorrowBtn').addEventListener('click', onCdBorrowClick);
  document.getElementById('cbRepayBtn').addEventListener('click', onCdRepayClick);

  document.getElementById('depositRateSlider').addEventListener('input', function () {
    getState().depositRate = parseFloat(this.value);
    updateUI();
    save();
  });

  document.getElementById('insuranceSlider').addEventListener('input', function () {
    getState().depositInsurancePct = parseFloat(this.value);
    document.getElementById('insuranceDisplay').textContent = getState().depositInsurancePct + '%';
    updateAll();
  });

  document.getElementById('autoCbCheckbox').addEventListener('change', function () {
    getState().autoCbBorrowing = this.checked;
    save();
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'autoGraphToggle') {
      getState().autoLoanGraphEnabled = e.target.checked;
      const status = e.target.closest('.auto-toggle-row')?.querySelector('.auto-toggle-status');
      if (status) {
        status.textContent = e.target.checked ? 'ON' : 'OFF';
        status.className = 'auto-toggle-status ' + (e.target.checked ? 'auto-toggle-on' : 'auto-toggle-off');
      }
      save();
    }
  });

  const mktSlider = document.getElementById('marketingSlider');
  if (mktSlider) {
    mktSlider.value = (getState().marketingLevel || 0);
    mktSlider.addEventListener('input', function () {
      getState().marketingLevel = parseInt(this.value);
      document.getElementById('marketingLevelDisplay').textContent = 'Level ' + this.value + ' ($' + (parseInt(this.value) * MARKETING_COST_PER_LEVEL).toLocaleString() + '/mo)';
      save();
    });
  }

  document.addEventListener('keydown', onKeydown);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('tab' + this.dataset.tab.charAt(0).toUpperCase() + this.dataset.tab.slice(1)).classList.add('active');
      if (this.dataset.tab === 'accounting') updateAccountingTab();
      if (this.dataset.tab === 'loans') { updateLoanOfficers(getState()); updateLoanApps(); updateAcceptedLoans(); updateCharts(); }
      if (this.dataset.tab === 'research') updateResearchTab();
      if (this.dataset.tab === 'dashboard') updateRiskGraph();
    });
  });
}

/** Add collapse/expand buttons to all card headers. */
function initCollapsible() {
  document.querySelectorAll('.card h2').forEach(h2 => {
    const btn = document.createElement('button');
    btn.className = 'collapse-btn';
    btn.textContent = '−';
    btn.addEventListener('click', () => {
      h2.parentElement.classList.toggle('collapsed');
      btn.textContent = h2.parentElement.classList.contains('collapsed') ? '+' : '−';
    });
    h2.prepend(btn);
  });
}

/** Application entry: load saved state (or create fresh), init ledger, bind events, render UI, start game loop. */
function init() {
  if (!load()) {
    setState(createInitialState());
  }
  const s = getState();
  if (!s.ledgerJournal || s.ledgerJournal.length === 0) initLedger(s);
  if (s.loanRecords.length === 0 && s.loans > 0) {
    s.loanRecords.push({
      id: 'loan-0',
      amount: s.loans,
      rate: s.weightedLoanRate || s.loanRate,
      durationMonths: null,
      monthlyPrincipal: 0,
      remainingBalance: s.loans,
      defaultProb: 2,
      status: 'active',
      createdAt: 0,
      repaidAtTick: null,
      lastPaymentTick: 0,
    });
  }
  if (s.historyRR.length === 0) {
    s.historyRR.push(reserveRatio(s));
    s.historyNIM.push(computeNim(s));
    s.historyEQ.push(equity(s));
  }
  document.querySelector('.speed-btn[data-speed="' + s.speed + '"]')?.classList.add('active');
  if (s.paused) document.getElementById('pauseBtn').textContent = '▶';
  document.getElementById('insuranceSlider').value = s.depositInsurancePct;
  document.getElementById('insuranceDisplay').textContent = s.depositInsurancePct + '%';
  document.getElementById('autoCbCheckbox').checked = s.autoCbBorrowing;
  initCollapsible();
  initRiskGraph();
  bindEvents();
  initAdmin();
  initTesting();
  updateAll();
  updateLoop();
}

document.addEventListener('DOMContentLoaded', init);
