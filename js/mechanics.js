import { TICKS_PER_YEAR, TICKS_PER_MONTH, RESERVE_RATIO_TARGET, NPL_WINDOW, DEFAULT_WINDOW, REGIME_MULTIPLIERS, DEFAULT_ANNUAL_RATE, PROB, LOAN_EXPIRY_TICKS, LOAN_DEFAULT_DURATION, DEPO_STABILITY_PROB, DEPO_STABILITY_RATE, LOANS_PER_OFFICER, SALARY_PER_OFFICER, INSURANCE_ANNUAL_PREMIUM, RISK_WEIGHTS, TICKS_NEGATIVE_EQUITY_LIMIT, NEGATIVE_EQUITY_CB_SPREAD_PREMIUM, NEGATIVE_EQUITY_DEPO_MULTIPLIER, RESEARCH_POINTS_PER_ANALYST, ANALYST_SALARY, MARKETING_COST_PER_LEVEL, MARKETING_MAX_LEVEL, MARKETING_BOOST_PER_LEVEL, BRANCH_CAPACITY_BONUS } from './constants.js';
import { addEvent } from './state.js';
import { fmtDollar } from './utils.js';
import { postJournal, getBalance, getEquity, getNetIncome } from './ledger.js';

/** @module mechanics - Core game logic: reserve requirements, interest accrual, loan processing, defaults, deposit stability, and central bank auto-borrowing. */

/** Calculate required reserves as deposits × reserve ratio target.
 *  @param {object} s
 *  @returns {number} */
export function requiredReserves(s) {
  return getBalance(s, 'deposits') * RESERVE_RATIO_TARGET;
}

/** Wrapper around ledger's getEquity for external callers.
 *  @param {object} s
 *  @returns {number} */
export function equity(s) {
  return getEquity(s);
}

/** Total assets: cash + loans receivable.
 *  @param {object} s
 *  @returns {number} */
export function totalAssets(s) {
  return getBalance(s, 'cash') + getBalance(s, 'loansReceivable');
}

/** Actual reserve ratio as a percentage. 100% if no deposits.
 *  @param {object} s
 *  @returns {number} */
export function reserveRatio(s) {
  const d = getBalance(s, 'deposits');
  return d > 0 ? (getBalance(s, 'cash') / d) * 100 : 100;
}

/** Annualized Net Interest Margin percentage. NIM = (loan income + reserve income - deposit cost - CB cost) / earning assets.
 *  @param {object} s
 *  @returns {number} */
export function computeNim(s) {
  const loans = getBalance(s, 'loansReceivable');
  const cash = getBalance(s, 'cash');
  const deposits = getBalance(s, 'deposits');
  const cb = getBalance(s, 'cbBorrowing');
  const ea = loans + cash;
  if (ea < 1) return 0;
  const annualLoan = loans * (s.weightedLoanRate / 100);
  const annualDepo = deposits * (s.depositRate / 100);
  const annualRes = cash * (s.ecbDepositRate / 100);
  const annualCb = cb * (s.ecbMlfRate / 100);
  const net = annualLoan + annualRes - annualDepo - annualCb;
  return (net / ea) * 100;
}

/** Trailing non-performing loan ratio within NPL_WINDOW ticks. Sum of default amounts / total loans.
 *  @param {object} s
 *  @returns {number} */
export function trailingNpl(s) {
  let total = 0;
  for (let i = s.defaultTicks.length - 1; i >= 0; i--) {
    if (s.tick - s.defaultTicks[i] <= NPL_WINDOW) total += s.defaultAmounts[i];
    else break;
  }
  const loans = getBalance(s, 'loansReceivable');
  return loans > 0 ? (total / loans) * 100 : 0;
}

/** Accumulate per-tick interest on deposits, reserves, and CB borrowing into _dailyInt for later posting.
 *  @param {object} s */
export function accrueInterest(s) {
  const hourly = 1 / TICKS_PER_YEAR;
  const deposits = getBalance(s, 'deposits');
  const cash = getBalance(s, 'cash');
  const cb = getBalance(s, 'cbBorrowing');
  s._dailyInt.depoInt += deposits * (s.depositRate / 100) * hourly;
  s._dailyInt.resInt += cash * (s.ecbDepositRate / 100) * hourly;
  s._dailyInt.cbInt += cb * (s.ecbMlfRate / 100) * hourly;
}

/** Check deposit rate competitiveness. If spread is below the stability threshold, trigger deposit outflows proportional to severity and regime.
 *  Insurance coverage raises the effective threshold. Bank runs amplify probability and severity.
 *  @param {object} s */
export function tryDepositStability(s) {
  // Bank run amplification
  if (s.bankRunActive) {
    const spread = s.depositRate - s.ecbMroRate;
    const severity = Math.abs(spread - s.depositStabilityThreshold) + 2;
    const prob = Math.min(0.5, DEPO_STABILITY_PROB * severity * REGIME_MULTIPLIERS[s.regime] * 5);
    if (Math.random() >= prob) return;
    const deposits = getBalance(s, 'deposits');
    const pct = Math.min(0.1, DEPO_STABILITY_RATE * severity * REGIME_MULTIPLIERS[s.regime] * 5);
    const outflow = deposits * pct * (0.5 + Math.random());
    if (outflow < 1000) return;
    const actual = Math.min(outflow, deposits);
    postJournal(s, [
      { account: 'deposits', debit: actual },
      { account: 'cash', credit: actual },
    ], 'Deposit flight (bank run)');
    addEvent(s, 'deposit', 'Deposit flight during bank run: ' + fmtDollar(-actual), 'event-expense');
    return;
  }

  // Normal stability check
  const insuranceBuffer = (s.depositInsurancePct / 100) * 0.5;
  const effectiveThreshold = s.depositStabilityThreshold + insuranceBuffer;
  const spread = s.depositRate - s.ecbMroRate;
  if (spread >= effectiveThreshold) return;
  const severity = Math.abs(spread - effectiveThreshold);
  const equityMult = getEquity(s) < 0 ? NEGATIVE_EQUITY_DEPO_MULTIPLIER : 1.0;
  const prob = Math.min(0.1, DEPO_STABILITY_PROB * severity * REGIME_MULTIPLIERS[s.regime] * equityMult);
  if (Math.random() >= prob) return;
  const deposits = getBalance(s, 'deposits');
  const pct = Math.min(0.01, DEPO_STABILITY_RATE * severity * REGIME_MULTIPLIERS[s.regime] * equityMult);
  const outflow = deposits * pct * (0.5 + Math.random());
  if (outflow < 1000) return;
  const actual = Math.min(outflow, deposits);
  postJournal(s, [
    { account: 'deposits', debit: actual },
    { account: 'cash', credit: actual },
  ], 'Deposit flight (uncompetitive rate)');
  addEvent(s, 'deposit', 'Deposit outflow (rate uncompetitive): ' + fmtDollar(-actual), 'event-expense');
}

/** Determine if a customer refuses a proposed loan rate based on spread over MRO, modulated by regime.
 *  @param {object} s
 *  @param {number} rate - Proposed loan rate
 *  @returns {boolean} */
export function customerRefuses(s, rate, entry) {
  const riskDiscount = (entry?.defaultProb || 0) * 0.3;
  const effectiveSpread = Math.max(0, rate - s.ecbMroRate - riskDiscount);
  const refusalProb = Math.max(5, Math.min(95, effectiveSpread * REGIME_MULTIPLIERS[s.regime] * 8));
  return Math.random() < refusalProb / 100;
}

/** Maximum active loans the current workforce can handle.
 *  @param {object} s
 *  @returns {number} */
export function activeLoanCapacity(s) {
  return s.numWorkers * LOANS_PER_OFFICER + (s.branchLevel || 0) * BRANCH_CAPACITY_BONUS;
}

/** Number of active loans currently on the books.
 *  @param {object} s
 *  @returns {number} */
export function countActiveLoans(s) {
  let count = 0;
  for (const lr of s.loanRecords) {
    if (lr.status === 'active') count++;
  }
  return count;
}

/** Process monthly salary payments for loan officers and credit analysts, plus deposit insurance premium. Fires on month boundaries.
 *  @param {object} s */
export function processSalaries(s) {
  if (s.tick % TICKS_PER_MONTH !== 0) return;
  const officerCost = s.numWorkers * SALARY_PER_OFFICER;
  const analystCost = (s.creditAnalysts || 0) * ANALYST_SALARY;
  const totalSalary = officerCost + analystCost;
  if (totalSalary > 0) {
    postJournal(s, [
      { account: 'salaryExpense', debit: totalSalary },
      { account: 'cash', credit: totalSalary },
    ], 'Monthly salaries - ' + s.numWorkers + ' loan officers, ' + (s.creditAnalysts || 0) + ' analysts');
    addEvent(s, 'hr', 'Paid salaries: ' + fmtDollar(totalSalary) + ' (' + s.numWorkers + ' officer(s), ' + (s.creditAnalysts || 0) + ' analyst(s))', 'event-expense');
  }
  const mktLevel = s.marketingLevel || 0;
  if (mktLevel > 0) {
    const mktCost = mktLevel * MARKETING_COST_PER_LEVEL;
    postJournal(s, [
      { account: 'salaryExpense', debit: mktCost },
      { account: 'cash', credit: mktCost },
    ], 'Monthly marketing spend — level ' + mktLevel);
    addEvent(s, 'hr', 'Marketing spend: ' + fmtDollar(mktCost) + ' (level ' + mktLevel + ')', 'event-expense');
  }

  if (s.depositInsurancePct > 0) {
    const deposits = getBalance(s, 'deposits');
    const premium = deposits * (s.depositInsurancePct / 100) * INSURANCE_ANNUAL_PREMIUM / 12;
    if (premium > 1) {
      postJournal(s, [
        { account: 'insuranceExpense', debit: premium },
        { account: 'cash', credit: premium },
      ], 'Deposit insurance premium');
      addEvent(s, 'hr', 'Deposit insurance premium: ' + fmtDollar(premium), 'event-expense');
    }
  }
}

/** Process a loan approval: create loan record, post journal entries (credit creation — deposits created ex nihilo), collect first payment, update weighted average rate, and check reserves.
 *  Blocks approval if bank is insolvent (negative equity).
 *  @param {object} s
 *  @param {object} entry - Event log entry for this loan request
 *  @param {number} rate - Approved interest rate */
export function processLoanApproval(s, entry, rate) {
  entry.approved = true;
  if (getEquity(s) < 0) {
    entry.msg += ' — BLOCKED: BANK INSOLVENT';
    entry.cls = 'event-expense';
    addEvent(s, 'loan', 'Cannot approve loan — bank is insolvent (equity < $0). Resolve the solvency issue first.', 'event-expense');
    return;
  }
  if (customerRefuses(s, rate, entry)) {
    entry.msg += ' — CUSTOMER REFUSED';
    entry.cls = 'event-expense';
    addEvent(s, 'loan', 'Customer refused loan of ' + fmtDollar(entry.loanAmount) + ' at ' + rate.toFixed(2) + '%', 'event-expense');
    return;
  }
  if (countActiveLoans(s) >= activeLoanCapacity(s)) {
    entry.msg += ' — ALL LOAN OFFICERS OCCUPIED';
    entry.cls = 'event-expense';
    addEvent(s, 'loan', 'Cannot approve loan of ' + fmtDollar(entry.loanAmount) + ' — all loan officers are occupied. Hire more.', 'event-expense');
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
    trueDefaultProb: entry.trueDefaultProb != null ? entry.trueDefaultProb : (entry.defaultProb || 2),
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

/** Process monthly amortizing loan payments for all active loans. Fires on month boundaries (tick % TICKS_PER_MONTH === 0).
 *  @param {object} s */
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
      { account: 'cash', debit: total },
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

/** Per-tick default probability check for each active loan. Uses trueDefaultProb (not the noisy displayed value) × regime multiplier.
 *  @param {object} s */
export function processDefaults(s) {
  for (const lr of s.loanRecords) {
    if (lr.status !== 'active') continue;
    const trueRisk = (lr.trueDefaultProb != null ? lr.trueDefaultProb : lr.defaultProb) / 100;
    const annualProb = trueRisk * REGIME_MULTIPLIERS[s.regime];
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

/** Rolling annual default rate: defaulted loans / finished loans within the last TICKS_PER_YEAR.
 *  @param {object} s
 *  @returns {number} */
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

/** Look up the assigned rate for a given default risk % from the risk rate map.
 *  Returns the rate as a number (approve at that rate) or null (reject).
 *  Interpolates linearly between defined points.
 *  @param {object} s
 *  @param {number} risk - Default probability percentage (0-50)
 *  @returns {number|null} */
export function getRateForRisk(s, risk) {
  const map = s.riskRateMap;
  if (!map || map.length === 0) return s.loanRate;
  const sorted = [...map].sort((a, b) => a.risk - b.risk);
  const MAX_RATE = 20;
  function valid(r) { return r !== null && r !== undefined && r <= MAX_RATE; }

  if (risk <= sorted[0].risk) return valid(sorted[0].rate) ? sorted[0].rate : null;
  if (risk >= sorted[sorted.length - 1].risk) return valid(sorted[sorted.length - 1].rate) ? sorted[sorted.length - 1].rate : null;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i], p2 = sorted[i + 1];
    if (risk >= p1.risk && risk <= p2.risk) {
      if (!valid(p1.rate) || !valid(p2.rate)) return null;
      const t = p2.risk === p1.risk ? 0 : (risk - p1.risk) / (p2.risk - p1.risk);
      const rate = p1.rate + (p2.rate - p1.rate) * t;
      return rate > MAX_RATE ? null : rate;
    }
  }
  return s.loanRate;
}

/** Recalculate weighted average loan rate from all active loans: Σ(amount_i × rate_i) / Σ(amount_i).
 *  @param {object} s */
export function recomputeWeightedLoanRate(s) {
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

/** Auto-borrow from CB if reserves fall below requirement and auto-borrowing is enabled. Otherwise emit a warning event.
 *  @param {object} s */
export function checkReserves(s) {
  const cash = getBalance(s, 'cash');
  if (cash < 0) {
    const deficit = -cash;
    postJournal(s, [
      { account: 'cash', debit: deficit },
      { account: 'cbBorrowing', credit: deficit },
    ], 'Emergency CB borrowing (cash went negative)');
    addEvent(s, 'cb', 'Emergency auto-borrowed ' + fmtDollar(deficit) + ' from CB (cash went negative!)', 'event-expense');
  }
  const req = requiredReserves(s);
  const cash2 = getBalance(s, 'cash');
  if (cash2 < req) {
    if (s.autoCbBorrowing) {
      const buffer = getBalance(s, 'deposits') * 0.001;
      const deficit = req + buffer - cash2;
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

/** Auto-process pending loan requests based on the risk rate graph.
 *  Loans past their autoProcessAt tick get approved/rejected according to the graph.
 *  @param {object} s */
export function processAutoDecisions(s) {
  if (!s.autoLoanGraphUnlocked || s.autoLoanGraphEnabled === false) return;
  for (const e of s.eventLog) {
    if (e.type !== 'loan_request' || e.approved !== undefined) continue;
    if (s.tick < e.autoProcessAt) continue;
    if (e.suggestedRate !== null && e.suggestedRate !== undefined) {
      processLoanApproval(s, e, e.suggestedRate);
    } else {
      e.approved = false;
      e.msg += ' — AUTO-REJECTED';
      e.cls = 'event-expense';
    }
  }
}

/** Mark unapproved loan requests older than LOAN_EXPIRY_TICKS as expired.
 *  @param {object} s */
export function expireOldLoans(s) {
  for (const e of s.eventLog) {
    if (e.type === 'loan_request' && e.approved === undefined && s.tick - e.tick >= LOAN_EXPIRY_TICKS) {
      e.approved = false;
      e.msg += ' — EXPIRED';
      e.cls = 'event-expense';
    }
  }
}

/** Compute risk-weighted assets. Cash has 0% weight. Each active loan is weighted by its default risk band.
 *  @param {object} s
 *  @returns {number} */
export function computeRwa(s) {
  let rwa = 0;
  for (const lr of s.loanRecords) {
    if (lr.status !== 'active') continue;
    const dp = lr.trueDefaultProb != null ? lr.trueDefaultProb : (lr.defaultProb || 0);
    let weight = 1.0;
    for (const band of RISK_WEIGHTS) {
      if (dp <= band.maxProb) { weight = band.weight; break; }
    }
    rwa += (lr.remainingBalance || lr.amount) * weight;
  }
  return rwa;
}

/** Real-time solvency check. Called every tick. If equity < 0, increments a counter.
 *  Returns the current insolvent-tick count (>= TICKS_NEGATIVE_EQUITY_LIMIT means game over).
 *  @param {object} s
 *  @returns {number} - negative-equity tick count */
export function checkSolvency(s) {
  const eq = getEquity(s);
  if (eq < 0) {
    s.ticksNegativeEquity = (s.ticksNegativeEquity || 0) + 1;
    if (s.ticksNegativeEquity === 1) {
      addEvent(s, 'regulatory', '⚠ SOLVENCY WARNING: Equity is negative! Lending frozen. Resolve within ' + TICKS_NEGATIVE_EQUITY_LIMIT + ' ticks or regulators will seize the bank.', 'event-warn');
    }
  } else {
    if (s.ticksNegativeEquity > 0) {
      addEvent(s, 'regulatory', 'Equity restored — solvency warning lifted.', 'event-income');
    }
    s.ticksNegativeEquity = 0;
  }
  return s.ticksNegativeEquity || 0;
}

/** Accumulate research points from credit analysts. Called on month boundaries.
 *  @param {object} s */
export function processResearch(s) {
  if (s.tick % TICKS_PER_MONTH !== 0) return;
  const gained = (s.creditAnalysts || 0) * RESEARCH_POINTS_PER_ANALYST;
  if (gained > 0) {
    s.researchPoints = (s.researchPoints || 0) + gained;
  }
}

/** Severity weights per regulation (solvency removed — handled by real-time checkSolvency). */
const PENALTY_SEVERITY = { capitalAdequacy: 7, reserveRequirement: 6, liquidity: 5, nplRatio: 4, loanCapacity: 2 };
const PENALTY_DECAY_PER_MONTH = 5;

/** Compute penalty factor (0–1) for each regulation based on violation severity.
 *  Called on month boundaries. Adds to running total, decays when fully compliant.
 *  @param {object} s */
export function updatePenalty(s) {
  if (s.tick % TICKS_PER_MONTH !== 0) return;

  const RR = reserveRatio(s);
  const EQ = equity(s);
  const rwa = computeRwa(s);
  const capAdj = rwa > 0 ? EQ / rwa : 1;
  const NPL = trailingNpl(s);
  const active = countActiveLoans(s);
  const capacity = activeLoanCapacity(s);

  let monthly = 0;

  if (capAdj < 0.08) monthly += PENALTY_SEVERITY.capitalAdequacy * Math.min(1, (0.08 - capAdj) / 0.08);
  if (RR < 1) monthly += PENALTY_SEVERITY.reserveRequirement * Math.min(1, (1 - RR) / 1);
  if (RR < 5) monthly += PENALTY_SEVERITY.liquidity * Math.min(1, (5 - RR) / 5);
  if (NPL > 5) monthly += PENALTY_SEVERITY.nplRatio * Math.min(1, (NPL - 5) / 10);
  if (active > capacity) monthly += PENALTY_SEVERITY.loanCapacity * Math.min(1, (active - capacity) / Math.max(capacity, 1));

  s.penaltyPoints = Math.max(0, (s.penaltyPoints || 0) + monthly);

  if (monthly === 0) s.penaltyPoints = Math.max(0, s.penaltyPoints - PENALTY_DECAY_PER_MONTH);

  s.penaltyPoints = Math.min(100, s.penaltyPoints);
}
