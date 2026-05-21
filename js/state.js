import { SAVE_KEY, INITIAL, EVENT_LOG_MAX, TICKS_PER_QUARTER, TICKS_PER_YEAR } from './constants.js';
import { initLedger } from './ledger.js';

/** @module state - Singleton game state management. Handles initialization, serialization to/from localStorage, and event log. */

let _state = null;

/** Deep-clone the INITIAL constant to create a pristine state object.
 *  @returns {object} */
export function createInitialState() {
  return JSON.parse(JSON.stringify(INITIAL));
}

/** Get the current singleton state object.
 *  @returns {object} */
export function getState() {
  return _state;
}

/** Replace the singleton state object.
 *  @param {object} s */
export function setState(s) {
  _state = s;
}

/** Serialize current state to localStorage. Silently catches quota errors. */
export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(_state));
  } catch (e) {}
}

/** Deserialize state from localStorage, with migrations for loanRecords and ledgerJournal.
 *  @returns {boolean} true if state was loaded, false if no saved state exists */
export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      _state = Object.assign(createInitialState(), JSON.parse(raw));
      if (_state.loanRecords.length === 0 && _state.loans > 0) {
        _state.loanRecords.push({
          id: 'loan-0',
          amount: _state.loans,
          rate: _state.weightedLoanRate || _state.loanRate,
          durationMonths: null,
          monthlyPrincipal: 0,
          remainingBalance: _state.loans,
          defaultProb: 2,
          status: 'active',
          createdAt: 0,
          repaidAtTick: null,
          lastPaymentTick: 0,
        });
      }
      if (!_state.ledgerJournal || _state.ledgerJournal.length === 0) initLedger(_state);
      // Migration: old autoAcceptThreshold/autoRejectThreshold -> riskRateMap
      if (_state.autoAcceptThreshold !== undefined && !_state.riskRateMap) {
        delete _state.autoAcceptThreshold;
        delete _state.autoRejectThreshold;
      }
      return true;
    }
  } catch (e) {}
  return false;
}

/** Reset state to initial defaults and clear localStorage. */
export function reset() {
  _state = createInitialState();
  localStorage.removeItem(SAVE_KEY);
}

/** Create a new event log entry with auto-generated tick/quarter/year metadata, prepended to the log.
 *  @param {object} s - State object
 *  @param {string} type - Event category (deposit, loan, ecb, regime, cb, default)
 *  @param {string} msg - Human-readable description
 *  @param {string} [cls] - CSS class for styling (event-income, event-expense, event-info, event-warn)
 *  @param {object} [extra] - Additional properties to merge into the entry
 *  @returns {object} The created event entry */
export function addEvent(s, type, msg, cls, extra) {
  const q = Math.floor(s.tick / TICKS_PER_QUARTER) % 4 + 1;
  const y = 2026 + Math.floor(s.tick / TICKS_PER_YEAR);
  const entry = {
    id: s.nextEventId++,
    tick: s.tick,
    quarter: 'Q' + q + ' ' + y,
    type,
    msg,
    cls: cls || 'event-info'
  };
  if (extra) Object.assign(entry, extra);
  s.eventLog.unshift(entry);
  if (s.eventLog.length > EVENT_LOG_MAX) s.eventLog.pop();
  return entry;
}
