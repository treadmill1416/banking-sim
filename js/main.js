import { getState, setState, createInitialState, load, save, reset as resetState } from './state.js';
import { accrueInterest, processDefaults, checkReserves, reserveRatio, computeNim, equity } from './mechanics.js';
import { tryDepositFlow, tryLoanRequest, tryEcbChange, tryRegimeChange } from './events.js';
import { approveLoan, rejectLoan, cbBorrow, cbRepay } from './actions.js';
import { updateUI, updateEventLog, updateLoanApps } from './ui.js';
import { updateCharts } from './charts.js';
import { HISTORY_MAX } from './constants.js';

let intervalId = null;

function tick() {
  const s = getState();
  s.tick++;

  accrueInterest(s);
  processDefaults(s);
  tryDepositFlow(s);
  tryLoanRequest(s);
  tryEcbChange(s);
  tryRegimeChange(s);
  checkReserves(s);

  s.historyRR.push(reserveRatio(s));
  s.historyNIM.push(computeNim(s));
  s.historyEQ.push(equity(s));
  if (s.historyRR.length > HISTORY_MAX) { s.historyRR.shift(); s.historyNIM.shift(); s.historyEQ.shift(); }

  updateUI();
  updateCharts();
  updateEventLog();
  updateLoanApps();
  save();
}

function updateLoop() {
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
  resetState();
  const s = getState();
  s.historyRR.push(reserveRatio(s));
  s.historyNIM.push(computeNim(s));
  s.historyEQ.push(equity(s));
  document.getElementById('autoAcceptSlider').value = s.autoAcceptThreshold;
  updateAll();
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

function updateAll() {
  updateUI();
  updateCharts();
  updateEventLog();
  updateLoanApps();
  save();
}

function bindEvents() {
  document.querySelector('.header-controls').addEventListener('click', onSpeedClick);
  document.getElementById('pauseBtn').addEventListener('click', togglePause);
  document.getElementById('resetBtn').addEventListener('click', resetGame);
  document.getElementById('loanAppsList').addEventListener('click', onLoanAppsClick);
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
}

function init() {
  if (!load()) {
    setState(createInitialState());
  }
  const s = getState();
  if (s.historyRR.length === 0) {
    s.historyRR.push(reserveRatio(s));
    s.historyNIM.push(computeNim(s));
    s.historyEQ.push(equity(s));
  }
  document.querySelector('.speed-btn[data-speed="' + s.speed + '"]')?.classList.add('active');
  if (s.paused) document.getElementById('pauseBtn').textContent = '▶';
  document.getElementById('autoAcceptSlider').value = s.autoAcceptThreshold;
  bindEvents();
  updateAll();
  updateLoop();
}

document.addEventListener('DOMContentLoaded', init);
