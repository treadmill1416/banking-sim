import { TICKS_PER_YEAR, RESERVE_RATIO_TARGET, NPL_WINDOW, DEFAULT_WINDOW, REGIME_MULTIPLIERS, DEFAULT_ANNUAL_RATE, PROB, LOAN_EXPIRY_TICKS } from './constants.js';
import { addEvent } from './state.js';
import { fmtDollar } from './utils.js';

export function requiredReserves(s) {
  return s.deposits * RESERVE_RATIO_TARGET;
}

export function equity(s) {
  return s.reserves + s.loans + s.bonds - s.deposits - s.cbBorrowing;
}

export function totalAssets(s) {
  return s.reserves + s.loans + s.bonds;
}

export function reserveRatio(s) {
  return s.deposits > 0 ? (s.reserves / s.deposits) * 100 : 100;
}

export function computeNim(s) {
  const ea = s.loans + s.bonds + s.reserves;
  if (ea < 1) return 0;
  const annualLoan = s.loans * (s.loanRate / 100);
  const annualDepo = s.deposits * (s.depositRate / 100);
  const annualRes = s.reserves * (s.ecbDepositRate / 100);
  const annualCb = s.cbBorrowing * (s.ecbMlfRate / 100);
  const net = annualLoan + annualRes - annualDepo - annualCb;
  return (net / ea) * 100;
}

export function trailingNpl(s) {
  let total = 0;
  for (let i = s.defaultTicks.length - 1; i >= 0; i--) {
    if (s.tick - s.defaultTicks[i] <= NPL_WINDOW) total += s.defaultAmounts[i];
    else break;
  }
  return s.loans > 0 ? (total / s.loans) * 100 : 0;
}

export function accrueInterest(s) {
  const hourly = 1 / TICKS_PER_YEAR;
  const loanInt = s.loans * (s.loanRate / 100) * hourly;
  const depoInt = s.deposits * (s.depositRate / 100) * hourly;
  const resInt = s.reserves * (s.ecbDepositRate / 100) * hourly;
  const cbInt = s.cbBorrowing * (s.ecbMlfRate / 100) * hourly;
  const net = loanInt + resInt - depoInt - cbInt;
  s.reserves += net;
}

export function processDefaults(s) {
  const annualRate = DEFAULT_ANNUAL_RATE * REGIME_MULTIPLIERS[s.regime];
  const hourlyRate = annualRate / TICKS_PER_YEAR;
  const defAmount = s.loans * hourlyRate;
  if (defAmount > 1 && Math.random() < PROB.defaultHit) {
    const actual = defAmount * (0.5 + Math.random());
    s.loans = Math.max(0, s.loans - actual);
    s.cumulativeDefaults += actual;
    s.defaultTicks.push(s.tick);
    s.defaultAmounts.push(actual);
    while (s.defaultTicks.length > 0 && s.tick - s.defaultTicks[0] > DEFAULT_WINDOW) {
      s.defaultTicks.shift();
      s.defaultAmounts.shift();
    }
    addEvent(s, 'default', 'Loan default: ' + fmtDollar(actual), 'event-expense');
  }
}

export function checkReserves(s) {
  const req = requiredReserves(s);
  if (s.reserves < req) {
    if (s.autoCbBorrowing) {
      const deficit = req - s.reserves;
      s.cbBorrowing += deficit;
      s.reserves += deficit;
      addEvent(s, 'cb', 'Auto-borrowed ' + fmtDollar(deficit) + ' from CB (reserve shortfall)', 'event-expense');
    } else {
      addEvent(s, 'cb', 'Reserves below requirement! Borrow from CB desk.', 'event-warn');
    }
  }
}

export function expireOldLoans(s) {
  for (const e of s.eventLog) {
    if (e.type === 'loan_request' && e.approved === undefined && s.tick - e.tick >= LOAN_EXPIRY_TICKS) {
      e.approved = false;
      e.msg += ' — EXPIRED';
      e.cls = 'event-expense';
    }
  }
}
