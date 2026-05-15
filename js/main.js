import { getState, setState, createInitialState, load, save, reset as resetState } from './state.js';
import { accrueInterest, processDefaults, checkReserves, expireOldLoans, reserveRatio, computeNim, equity, tryDepositStability, processLoanMaturities, computeDefaultRate } from './mechanics.js';
import { tryDepositFlow, tryLoanRequest, tryEcbChange, tryRegimeChange } from './events.js';
import { approveLoan, rejectLoan, cbBorrow, cbRepay } from './actions.js';
import { fmtDollar } from './utils.js';
import { updateUI, updateEventLog, updateLoanApps, updatePnlDisplay, updateAcceptedLoans, updateLedgerDisplay, updateAccountingTab } from './ui.js';
import { updateCharts } from './charts.js';
import { HISTORY_MAX } from './constants.js';
import { initAdmin } from './admin.js';
import { postDailyInterest, updateLedgerPnl, initLedger } from './ledger.js';

export let intervalId = null;

function tick() {
  const s = getState();
  s.tick++;

  accrueInterest(s);
  processDefaults(s);
  processLoanMaturities(s);
  tryDepositFlow(s);
  tryDepositStability(s);
  tryLoanRequest(s);
  tryEcbChange(s);
  tryRegimeChange(s);
  expireOldLoans(s);
  checkReserves(s);

  if (s.tick % 24 === 0) postDailyInterest(s);
  updateLedgerPnl(s);

  s.defaultRateHistory.push(computeDefaultRate(s));
  if (s.defaultRateHistory.length > HISTORY_MAX) s.defaultRateHistory.shift();

  s.historyRR.push(reserveRatio(s));
  s.historyNIM.push(computeNim(s));
  s.historyEQ.push(equity(s));
  if (s.historyRR.length > HISTORY_MAX) { s.historyRR.shift(); s.historyNIM.shift(); s.historyEQ.shift(); }

  updateUI();
  updatePnlDisplay();
  if (s.tick % 24 === 0) { updateLedgerDisplay(); updateAccountingTab(); }
  updateCharts();
  updateEventLog();
  updateLoanApps();
  updateAcceptedLoans();
  save();
}

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
    durationTicks: null,
    defaultProb: 2,
    status: 'active',
    createdAt: 0,
    repaidAtTick: null
  }] : [];
  s.nextLoanRecordId = 1;
  s.defaultRateHistory = [];
  document.getElementById('loanRateSlider').value = s.loanRate;
  document.getElementById('depositRateSlider').value = s.depositRate;
  document.getElementById('autoAcceptSlider').value = s.autoAcceptThreshold;
  document.getElementById('autoCbCheckbox').checked = s.autoCbBorrowing;
  document.getElementById('pauseBtn').textContent = '▶';
  updateAll();
  updateLoop();
}

function setSpeed(speed) {
  getState().speed = speed;
  document.querySelectorAll('.speed-btn[data-speed]').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.speed) === speed);
  });
  updateLoop();
}

function togglePause() {
  const s = getState();
  s.paused = !s.paused;
  document.getElementById('pauseBtn').textContent = s.paused ? '▶' : '⏸';
  updateLoop();
}

function resetGame() {
  if (!confirm('Reset game? All progress will be lost.')) return;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
  resetState();
  const s = getState();
  if (s.loans > 0) {
    s.loanRecords.push({
      id: 'loan-0',
      amount: s.loans,
      rate: s.loanRate,
      durationTicks: null,
      defaultProb: 2,
      status: 'active',
      createdAt: 0,
      repaidAtTick: null
    });
  }
  initLedger(s);
  s.historyRR.push(reserveRatio(s));
  s.historyNIM.push(computeNim(s));
  s.historyEQ.push(equity(s));
  document.getElementById('autoAcceptSlider').value = s.autoAcceptThreshold;
  document.getElementById('autoCbCheckbox').checked = s.autoCbBorrowing;
  document.getElementById('pauseBtn').textContent = s.paused ? '▶' : '⏸';
  updateAll();
  updateLoop();
}

// --- Event delegation ---

function onSpeedClick(e) {
  const btn = e.target.closest('.speed-btn[data-speed]');
  if (btn) setSpeed(parseInt(btn.dataset.speed));
}

function onLoanAppsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'approve') { approveLoan(id); updateAll(); }
  if (btn.dataset.action === 'reject') { rejectLoan(id); updateAll(); }
}

function onCdBorrowClick() { cbBorrow(); updateAll(); }
function onCdRepayClick() { cbRepay(); updateAll(); }

export function updateAll() {
  updateUI();
  updatePnlDisplay();
  updateLedgerDisplay();
  updateAccountingTab();
  updateCharts();
  updateEventLog();
  updateLoanApps();
  updateAcceptedLoans();
  save();
}

function bindEvents() {
  document.querySelector('.header-controls').addEventListener('click', onSpeedClick);
  document.getElementById('pauseBtn').addEventListener('click', togglePause);
  document.getElementById('resetBtn').addEventListener('click', resetGame);
  document.getElementById('loanAppsList').addEventListener('click', onLoanAppsClick);
  document.getElementById('loanAppsList').addEventListener('input', function (e) {
    const slider = e.target.closest('.app-rate-slider');
    if (!slider) return;
    const entry = slider.closest('.la-entry');
    const amount = parseFloat(entry.dataset.amount);
    const rate = parseFloat(slider.value);
    if (amount && rate) {
      const interest = amount * rate / 100;
      entry.querySelector('.la-interest').textContent = 'Annual interest: +' + fmtDollar(interest).replace(/^\$/, '');
      entry.querySelector('.rate-slider-val').textContent = rate.toFixed(2) + '%';
    }
  });
  document.getElementById('cbBorrowBtn').addEventListener('click', onCdBorrowClick);
  document.getElementById('cbRepayBtn').addEventListener('click', onCdRepayClick);

  document.getElementById('loanRateSlider').addEventListener('input', function () {
    getState().loanRate = parseFloat(this.value);
    updateUI();
    save();
  });

  document.getElementById('depositRateSlider').addEventListener('input', function () {
    getState().depositRate = parseFloat(this.value);
    updateUI();
    save();
  });

  document.getElementById('autoAcceptSlider').addEventListener('input', function () {
    getState().autoAcceptThreshold = parseFloat(this.value);
    document.getElementById('autoAcceptDisplay').textContent = getState().autoAcceptThreshold.toFixed(1) + '%';
    save();
  });

  document.getElementById('autoCbCheckbox').addEventListener('change', function () {
    getState().autoCbBorrowing = this.checked;
    save();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('tab' + this.dataset.tab.charAt(0).toUpperCase() + this.dataset.tab.slice(1)).classList.add('active');
      if (this.dataset.tab === 'accounting') updateAccountingTab();
    });
  });
}

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
      durationTicks: null,
      defaultProb: 2,
      status: 'active',
      createdAt: 0,
      repaidAtTick: null
    });
  }
  if (s.historyRR.length === 0) {
    s.historyRR.push(reserveRatio(s));
    s.historyNIM.push(computeNim(s));
    s.historyEQ.push(equity(s));
  }
  document.querySelector('.speed-btn[data-speed="' + s.speed + '"]')?.classList.add('active');
  if (s.paused) document.getElementById('pauseBtn').textContent = '▶';
  document.getElementById('autoAcceptSlider').value = s.autoAcceptThreshold;
  document.getElementById('autoCbCheckbox').checked = s.autoCbBorrowing;
  initCollapsible();
  bindEvents();
  initAdmin();
  updateAll();
  updateLoop();
}

document.addEventListener('DOMContentLoaded', init);
