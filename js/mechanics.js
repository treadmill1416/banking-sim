import { TICKS_PER_YEAR, TICKS_PER_MONTH, RESERVE_RATIO_TARGET, NPL_WINDOW, DEFAULT_WINDOW, REGIME_MULTIPLIERS, DEFAULT_ANNUAL_RATE, PROB, LOAN_EXPIRY_TICKS, LOAN_DEFAULT_DURATION, DEPO_STABILITY_PROB, DEPO_STABILITY_RATE } from './constants.js';
import { addEvent } from './state.js';
import { fmtDollar } from './utils.js';
import { postJournal, getBalance, getEquity, getNetIncome } from './ledger.js';

export function requiredReserves(s) {
  return getBalance(s, 'deposits') * RESERVE_RATIO_TARGET;
}

export function equity(s) {
  return getEquity(s);
}

export function totalAssets(s) {
  return getBalance(s, 'cash') + getBalance(s, 'loansReceivable') + getBalance(s, 'bonds');
}

export function reserveRatio(s) {
  const d = getBalance(s, 'deposits');
  return d > 0 ? (getBalance(s, 'cash') / d) * 100 : 100;
}

export function computeNim(s) {
  const loans = getBalance(s, 'loansReceivable');
  const cash = getBalance(s, 'cash');
  const bonds = getBalance(s, 'bonds');
  const deposits = getBalance(s, 'deposits');
  const cb = getBalance(s, 'cbBorrowing');
  const ea = loans + bonds + cash;
  if (ea < 1) return 0;
  const annualLoan = loans * (s.weightedLoanRate / 100);
  const annualDepo = deposits * (s.depositRate / 100);
  const annualRes = cash * (s.ecbDepositRate / 100);
  const annualCb = cb * (s.ecbMlfRate / 100);
  const net = annualLoan + annualRes - annualDepo - annualCb;
  return (net / ea) * 100;
}

export function trailingNpl(s) {
  let total = 0;
  for (let i = s.defaultTicks.length - 1; i >= 0; i--) {
    if (s.tick - s.defaultTicks[i] <= NPL_WINDOW) total += s.defaultAmounts[i];
    else break;
  }
  const loans = getBalance(s, 'loansReceivable');
  return loans > 0 ? (total / loans) * 100 : 0;
}

export function accrueInterest(s) {
  const hourly = 1 / TICKS_PER_YEAR;
  const deposits = getBalance(s, 'deposits');
  const cash = getBalance(s, 'cash');
  const cb = getBalance(s, 'cbBorrowing');
  s._dailyInt.depoInt += deposits * (s.depositRate / 100) * hourly;
  s._dailyInt.resInt += cash * (s.ecbDepositRate / 100) * hourly;
  s._dailyInt.cbInt += cb * (s.ecbMlfRate / 100) * hourly;
}

export function tryDepositStability(s) {
  const spread = s.depositRate - s.ecbMroRate;
  if (spread >= s.depositStabilityThreshold) return;
  const severity = Math.abs(spread - s.depositStabilityThreshold);
  const prob = Math.min(0.1, DEPO_STABILITY_PROB * severity * REGIME_MULTIPLIERS[s.regime]);
  if (Math.random() >= prob) return;
  const deposits = getBalance(s, 'deposits');
  const pct = Math.min(0.01, DEPO_STABILITY_RATE * severity * REGIME_MULTIPLIERS[s.regime]);
  const outflow = deposits * pct * (0.5 + Math.random());
  if (outflow < 1000) return;
  const actual = Math.min(outflow, deposits);
  postJournal(s, [
    { account: 'deposits', debit: actual },
    { account: 'cash', credit: actual },
  ], 'Deposit flight (uncompetitive rate)');
  addEvent(s, 'deposit', 'Deposit outflow (rate uncompetitive): ' + fmtDollar(-actual), 'event-expense');
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
    durationMonths: months,
    monthlyPrincipal: entry.loanAmount / months,
    remainingBalance: entry.loanAmount,
    defaultProb: entry.defaultProb || 2,
    status: 'active',
    createdAt: s.tick,
    repaidAtTick: null,
    lastPaymentTick: s.tick,
  };
  s.loanRecords.push(lr);
  const oldLoans = getBalance(s, 'loansReceivable');
  postJournal(s, [
    { account: 'loansReceivable', debit: entry.loanAmount },
    { account: 'deposits', credit: entry.loanAmount },
  ], 'Loan approval - ' + lr.id);
  if (oldLoans > 0) {
    s.weightedLoanRate = (oldLoans * s.weightedLoanRate + entry.loanAmount * rate) / getBalance(s, 'loansReceivable');
  } else {
    s.weightedLoanRate = rate;
  }

  const monthlyRate = rate / 100 / 12;
  const intFirst = entry.loanAmount * monthlyRate;
  const prinFirst = Math.min(lr.monthlyPrincipal, entry.loanAmount);
  const totalFirst = intFirst + prinFirst;
  postJournal(s, [
    { account: 'deposits', debit: totalFirst },
    { account: 'loansReceivable', credit: prinFirst },
    { account: 'interestIncome', credit: intFirst },
  ], 'Initial payment - ' + lr.id);
  lr.remainingBalance = entry.loanAmount - prinFirst;
  if (lr.remainingBalance < 0.005) {
    lr.status = 'repaid';
    lr.repaidAtTick = s.tick;
    addEvent(s, 'loan', 'Loan fully repaid: ' + fmtDollar(lr.amount) + ' (' + lr.id + ')', 'event-income');
  }

  entry.msg += ' — APPROVED at ' + rate.toFixed(2) + '%';
  entry.cls = 'event-income';
  addEvent(s, 'loan', 'Loan approved: ' + fmtDollar(entry.loanAmount) + ' at ' + rate.toFixed(2) + '%', 'event-income');
  checkReserves(s);
}

export function processLoanPayments(s) {
  if (s.tick % TICKS_PER_MONTH !== 0) return;
  let changed = false;
  for (const lr of s.loanRecords) {
    if (lr.status !== 'active' || lr.durationMonths == null) continue;
    if (lr.lastPaymentTick >= s.tick) continue;

    const monthlyRate = lr.rate / 100 / 12;
    const interest = lr.remainingBalance * monthlyRate;
    const principal = Math.min(lr.monthlyPrincipal, lr.remainingBalance);
    const total = interest + principal;

    if (total < 0.005) {
      lr.lastPaymentTick = s.tick;
      continue;
    }

    postJournal(s, [
      { account: 'deposits', debit: total },
      { account: 'loansReceivable', credit: principal },
      { account: 'interestIncome', credit: interest },
    ], 'Monthly payment - ' + lr.id);

    lr.remainingBalance -= principal;
    lr.lastPaymentTick = s.tick;
    changed = true;

    if (lr.remainingBalance < 0.005) {
      lr.status = 'repaid';
      lr.repaidAtTick = s.tick;
      addEvent(s, 'loan', 'Loan fully repaid: ' + fmtDollar(lr.amount) + ' (' + lr.id + ')', 'event-income');
    }
  }
  if (changed) recomputeWeightedLoanRate(s);
}

export function processDefaults(s) {
  for (const lr of s.loanRecords) {
    if (lr.status !== 'active') continue;
    const annualProb = (lr.defaultProb / 100) * REGIME_MULTIPLIERS[s.regime];
    const tickProb = annualProb / TICKS_PER_YEAR;
    if (tickProb > 0 && Math.random() < tickProb) {
      const bal = lr.remainingBalance || lr.amount;
      const actual = Math.min(bal, getBalance(s, 'loansReceivable'));
      postJournal(s, [
        { account: 'defaultLosses', debit: actual },
        { account: 'loansReceivable', credit: actual },
      ], 'Loan default - ' + lr.id);
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
      recomputeWeightedLoanRate(s);
      addEvent(s, 'default', 'Loan defaulted: ' + fmtDollar(actual) + ' (' + lr.id + ')', 'event-expense');
    }
  }
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
      const bal = lr.remainingBalance || lr.amount;
      total += bal;
      weighted += bal * lr.rate;
    }
  }
  s.weightedLoanRate = total > 0 ? weighted / total : s.loanRate;
}

export function checkReserves(s) {
  const req = requiredReserves(s);
  const cash = getBalance(s, 'cash');
  if (cash < req) {
    if (s.autoCbBorrowing) {
      const deficit = req - cash;
      postJournal(s, [
        { account: 'cash', debit: deficit },
        { account: 'cbBorrowing', credit: deficit },
      ], 'Auto-borrow from CB');
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
