import { TICKS_PER_YEAR, TICKS_PER_MONTH, RESERVE_RATIO_TARGET, NPL_WINDOW, DEFAULT_WINDOW, REGIME_MULTIPLIERS, DEFAULT_ANNUAL_RATE, PROB, LOAN_EXPIRY_TICKS, LOAN_DEFAULT_DURATION, DEPO_STABILITY_PROB, DEPO_STABILITY_RATE } from './constants.js';
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
  const annualLoan = s.loans * (s.weightedLoanRate / 100);
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
  const loanInt = s.loans * (s.weightedLoanRate / 100) * hourly;
  const depoInt = s.deposits * (s.depositRate / 100) * hourly;
  const resInt = s.reserves * (s.ecbDepositRate / 100) * hourly;
  const cbInt = s.cbBorrowing * (s.ecbMlfRate / 100) * hourly;
  const net = loanInt + resInt - depoInt - cbInt;
  s.reserves += net;
}

export function updatePnl(s) {
  const hourly = 1 / TICKS_PER_YEAR;
  s.pnl.loanInterest += s.loans * (s.weightedLoanRate / 100) * hourly;
  s.pnl.depositInterest += s.deposits * (s.depositRate / 100) * hourly;
  s.pnl.reserveInterest += s.reserves * (s.ecbDepositRate / 100) * hourly;
  s.pnl.cbInterest += s.cbBorrowing * (s.ecbMlfRate / 100) * hourly;
  s.pnl.net = s.pnl.loanInterest + s.pnl.reserveInterest - s.pnl.depositInterest - s.pnl.cbInterest - s.pnl.defaults;
  if (s.tick - s.pnl.lastResetTick >= TICKS_PER_MONTH) {
    s.pnl.lastTotal = {
      loanInterest: s.pnl.loanInterest,
      depositInterest: s.pnl.depositInterest,
      reserveInterest: s.pnl.reserveInterest,
      cbInterest: s.pnl.cbInterest,
      defaults: s.pnl.defaults,
      net: s.pnl.net
    };
    s.pnl.loanInterest = 0;
    s.pnl.depositInterest = 0;
    s.pnl.reserveInterest = 0;
    s.pnl.cbInterest = 0;
    s.pnl.defaults = 0;
    s.pnl.net = 0;
    s.pnl.lastResetTick = s.tick;
  }
}

export function tryDepositStability(s) {
  const spread = s.depositRate - s.ecbMroRate;
  if (spread >= s.depositStabilityThreshold) return;
  const severity = Math.abs(spread - s.depositStabilityThreshold);
  const prob = Math.min(0.1, DEPO_STABILITY_PROB * severity * REGIME_MULTIPLIERS[s.regime]);
  if (Math.random() >= prob) return;
  const pct = Math.min(0.01, DEPO_STABILITY_RATE * severity * REGIME_MULTIPLIERS[s.regime]);
  const outflow = s.deposits * pct * (0.5 + Math.random());
  if (outflow < 1000) return;
  s.reserves = Math.max(0, s.reserves - outflow);
  s.deposits = Math.max(0, s.deposits - outflow);
  addEvent(s, 'deposit', 'Deposit outflow (rate uncompetitive): ' + fmtDollar(-outflow), 'event-expense');
}

export function customerRefuses(s, rate) {
  const spread = Math.max(0, rate - s.ecbMroRate);
  const refusalProb = Math.max(5, Math.min(95, spread * REGIME_MULTIPLIERS[s.regime] * 8));
  return Math.random() < refusalProb / 100;
}

export function processLoanApproval(s, entry, rate) {
  entry.approved = true;
  if (customerRefuses(s, rate)) {
    entry.msg += ' — CUSTOMER REFUSED';
    entry.cls = 'event-expense';
    addEvent(s, 'loan', 'Customer refused loan of ' + fmtDollar(entry.loanAmount) + ' at ' + rate.toFixed(2) + '%', 'event-expense');
    return;
  }
  const months = entry.durationMonths || 12;
  const lr = {
    id: 'loan-' + (s.nextLoanRecordId++),
    amount: entry.loanAmount,
    rate: rate,
    durationTicks: months * TICKS_PER_MONTH,
    defaultProb: entry.defaultProb || 2,
    status: 'active',
    createdAt: s.tick,
    repaidAtTick: null
  };
  s.loanRecords.push(lr);
  const oldLoans = s.loans;
  s.loans += entry.loanAmount;
  s.deposits += entry.loanAmount;
  if (oldLoans > 0) {
    s.weightedLoanRate = (oldLoans * s.weightedLoanRate + entry.loanAmount * rate) / s.loans;
  } else {
    s.weightedLoanRate = rate;
  }
  entry.msg += ' — APPROVED at ' + rate.toFixed(2) + '%';
  entry.cls = 'event-income';
  addEvent(s, 'loan', 'Loan approved: ' + fmtDollar(entry.loanAmount) + ' at ' + rate.toFixed(2) + '%', 'event-income');
  checkReserves(s);
}

export function processDefaults(s) {
  for (const lr of s.loanRecords) {
    if (lr.status !== 'active') continue;
    const annualProb = (lr.defaultProb / 100) * REGIME_MULTIPLIERS[s.regime];
    const tickProb = annualProb / TICKS_PER_YEAR;
    if (tickProb > 0 && Math.random() < tickProb) {
      const actual = lr.amount;
      s.loans = Math.max(0, s.loans - actual);
      s.cumulativeDefaults += actual;
      s.defaultTicks.push(s.tick);
      s.defaultAmounts.push(actual);
      while (s.defaultTicks.length > 0 && s.tick - s.defaultTicks[0] > DEFAULT_WINDOW) {
        s.defaultTicks.shift();
        s.defaultAmounts.shift();
      }
      s.pnl.defaults += actual;
      lr.status = 'defaulted';
      lr.repaidAtTick = s.tick;
      recomputeWeightedLoanRate(s);
      addEvent(s, 'default', 'Loan defaulted: ' + fmtDollar(actual) + ' (' + lr.id + ')', 'event-expense');
    }
  }
}

export function processLoanMaturities(s) {
  let changed = false;
  for (const lr of s.loanRecords) {
    if (lr.status === 'active' && lr.durationTicks != null && s.tick - lr.createdAt >= lr.durationTicks) {
      lr.status = 'repaid';
      lr.repaidAtTick = s.tick;
      s.loans = Math.max(0, s.loans - lr.amount);
      s.deposits = Math.max(0, s.deposits - lr.amount);
      changed = true;
      addEvent(s, 'loan', 'Loan matured: ' + fmtDollar(lr.amount) + ' repaid (' + lr.id + ')', 'event-income');
    }
  }
  if (changed) recomputeWeightedLoanRate(s);
}

export function computeDefaultRate(s) {
  const cutoff = s.tick - TICKS_PER_YEAR;
  let finished = 0;
  let defaulted = 0;
  for (const lr of s.loanRecords) {
    if (lr.repaidAtTick != null && lr.repaidAtTick >= cutoff) {
      finished++;
      if (lr.status === 'defaulted') defaulted++;
    }
  }
  return finished > 0 ? (defaulted / finished) * 100 : 0;
}

function recomputeWeightedLoanRate(s) {
  let total = 0;
  let weighted = 0;
  for (const lr of s.loanRecords) {
    if (lr.status === 'active') {
      total += lr.amount;
      weighted += lr.amount * lr.rate;
    }
  }
  s.weightedLoanRate = total > 0 ? weighted / total : s.loanRate;
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
