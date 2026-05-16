import { getState } from './state.js';
import { applyAdminConfig } from './main.js';
import { getBalance } from './ledger.js';

/** @module admin - Admin settings panel for overriding game state. Visible only when state.debug is true. Supports save/load presets via localStorage. */

const ADMIN_PRESET_KEY = 'bankrunner-admin-preset';

/** Initialize admin panel: hide if not debug, wire button event listeners.
 *  @param {object} s - (unused, reads from getState internally) */
export function initAdmin() {
  if (!getState().debug) {
    document.getElementById('adminBtn').style.display = 'none';
    return;
  }
  document.getElementById('adminBtn').addEventListener('click', toggleAdminPanel);
  document.getElementById('adminClose').addEventListener('click', toggleAdminPanel);
  document.getElementById('adminOverlay').addEventListener('click', function (e) {
    if (e.target === this) toggleAdminPanel();
  });
  document.getElementById('adminApplyBtn').addEventListener('click', applySettings);
  document.getElementById('adminSavePresetBtn').addEventListener('click', savePreset);
  document.getElementById('adminLoadPresetBtn').addEventListener('click', loadPreset);
}

/** Toggle admin modal visibility. Populates form fields from current state when opening. */
function toggleAdminPanel() {
  const overlay = document.getElementById('adminOverlay');
  const isOpen = overlay.style.display !== 'none';
  overlay.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) populateFromState();
}

/** Fill admin form fields with current game state values. */
function populateFromState() {
  const s = getState();
  document.getElementById('adminReserves').value = getBalance(s, 'cash');
  document.getElementById('adminLoans').value = getBalance(s, 'loansReceivable');
  document.getElementById('adminDeposits').value = getBalance(s, 'deposits');
  document.getElementById('adminCbBorrowing').value = getBalance(s, 'cbBorrowing');
  document.getElementById('adminLoanRate').value = s.loanRate;
  document.getElementById('adminDepositRate').value = s.depositRate;
  document.getElementById('adminEcbDepositRate').value = s.ecbDepositRate;
  document.getElementById('adminEcbMroRate').value = s.ecbMroRate;
  document.getElementById('adminEcbMlfRate').value = s.ecbMlfRate;
  document.getElementById('adminRegime').value = s.regime;
  document.getElementById('adminAutoAccept').value = s.autoAcceptThreshold;
  document.getElementById('adminAutoReject').value = s.autoRejectThreshold;
  document.getElementById('adminDepoStabThresh').value = s.depositStabilityThreshold;
  document.getElementById('adminLoanReqMonth').value = s.loanRequestsPerMonth;
  document.getElementById('adminLoanDemandPeak').value = s.loanDemandPeakPct;
  document.getElementById('adminAutoCb').checked = s.autoCbBorrowing;
}

/** Read all admin form field values into a config object.
 *  @returns {object} */
function readAdminConfig() {
  return {
    reserves: parseFloat(document.getElementById('adminReserves').value) || 0,
    loans: parseFloat(document.getElementById('adminLoans').value) || 0,
    deposits: parseFloat(document.getElementById('adminDeposits').value) || 0,
    cbBorrowing: parseFloat(document.getElementById('adminCbBorrowing').value) || 0,
    loanRate: parseFloat(document.getElementById('adminLoanRate').value) || 0,
    depositRate: parseFloat(document.getElementById('adminDepositRate').value) || 0,
    ecbDepositRate: parseFloat(document.getElementById('adminEcbDepositRate').value) || 0,
    ecbMroRate: parseFloat(document.getElementById('adminEcbMroRate').value) || 0,
    ecbMlfRate: parseFloat(document.getElementById('adminEcbMlfRate').value) || 0,
    regime: document.getElementById('adminRegime').value,
    autoAcceptThreshold: parseFloat(document.getElementById('adminAutoAccept').value) || 0,
    autoRejectThreshold: parseFloat(document.getElementById('adminAutoReject').value) || 25,
    depositStabilityThreshold: parseFloat(document.getElementById('adminDepoStabThresh').value) || 0,
    loanRequestsPerMonth: parseInt(document.getElementById('adminLoanReqMonth').value) || 40,
    loanDemandPeakPct: parseFloat(document.getElementById('adminLoanDemandPeak').value) || 3,
    autoCbBorrowing: document.getElementById('adminAutoCb').checked
  };
}

/** Confirm and apply admin config, resetting the game with new values. */
function applySettings() {
  if (!confirm('Apply admin settings and reset game? All progress will be lost.')) return;
  const config = readAdminConfig();
  applyAdminConfig(config);
  toggleAdminPanel();
}

/** Save the current admin config as a named preset in localStorage. */
function savePreset() {
  const name = prompt('Preset name:', 'My Scenario');
  if (!name) return;
  const config = readAdminConfig();
  config._name = name;
  try {
    localStorage.setItem(ADMIN_PRESET_KEY, JSON.stringify(config));
    alert('Preset "' + name + '" saved.');
  } catch (e) {
    alert('Failed to save preset.');
  }
}

/** Load and apply a saved admin preset from localStorage. */
function loadPreset() {
  try {
    const raw = localStorage.getItem(ADMIN_PRESET_KEY);
    if (!raw) { alert('No saved preset found.'); return; }
    const config = JSON.parse(raw);
    const name = config._name || 'Preset';
    if (!confirm('Load preset "' + name + '" and reset game?')) return;
    applyAdminConfig(config);
    toggleAdminPanel();
  } catch (e) {
    alert('Failed to load preset.');
  }
}
