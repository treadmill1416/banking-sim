import { SAVE_KEY, INITIAL, EVENT_LOG_MAX, TICKS_PER_QUARTER, TICKS_PER_YEAR } from './constants.js';
import { initLedger } from './ledger.js';

let _state = null;

export function createInitialState() {
  return JSON.parse(JSON.stringify(INITIAL));
}

export function getState() {
  return _state;
}

export function setState(s) {
  _state = s;
}

export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(_state));
  } catch (e) {}
}

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
          durationTicks: null,
          defaultProb: 2,
          status: 'active',
          createdAt: 0,
          repaidAtTick: null
        });
      }
      if (!_state.ledgerJournal || _state.ledgerJournal.length === 0) initLedger(_state);
      return true;
    }
  } catch (e) {}
  return false;
}

export function reset() {
  _state = createInitialState();
  localStorage.removeItem(SAVE_KEY);
}

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
