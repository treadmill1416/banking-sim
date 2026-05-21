import { REGIME_ECB_BIAS, REGIME_DEFAULT_RISK, REGIME_DEPOSIT_MOD, REGIME_TRANSITIONS, REGIME_NAMES, ECB_RATE_NAMES, CB_SPREAD, RATE_MIN, RATE_MAX, PROB, TICKS_PER_MONTH, APPLICATIONS_PER_OFFICER, REGIME_LOAN_DEMAND } from './constants.js';
import { addEvent } from './state.js';
import { getRateForRisk, totalAssets } from './mechanics.js';
import { postJournal, getBalance } from './ledger.js';
import { fmtDollar } from './utils.js';

/** @module events - Stochastic event generators that drive the game's random dynamics. Each function is called per tick and fires with a configurable probability. */

/** Random deposit inflow/outflow. Amount depends on rate competitiveness vs MRO and current regime modifier.
 *  Bank runs force outflows and block inflows during the panic period.
 *  @param {object} s */
export function tryDepositFlow(s) {
  if (Math.random() >= PROB.depositFlow) return;
  const deposits = getBalance(s, 'deposits');

  // Bank run overrides normal flow
  if (s.bankRunActive) {
    const elapsed = s.tick - s.bankRunStartTick;
    if (elapsed >= 30) {
      s.bankRunActive = false;
      addEvent(s, 'deposit', 'Bank run subsides — depositor confidence returning', 'event-info');
      return;
    }
    const decayFactor = 1 - elapsed / 30;
    const outflow = deposits * decayFactor * 0.03;
    if (outflow > 1000) {
      const actual = Math.min(outflow, deposits);
      postJournal(s, [
        { account: 'deposits', debit: actual },
        { account: 'cash', credit: actual },
      ], 'Bank run outflow');
      addEvent(s, 'deposit', 'Bank run outflow ' + fmtDollar(-actual), 'event-expense');
    }
    return;
  }

  const base = 20000 + Math.random() * 80000;
  const marketRate = s.ecbMroRate;
  const rateDiff = s.depositRate - marketRate;
  const flowModifier = rateDiff * 200000;
  const insuranceBoost = 1 + (s.depositInsurancePct / 100) * 0.3;
  const regimeMod = REGIME_DEPOSIT_MOD[s.regime];
  const amount = (base + flowModifier) * regimeMod * insuranceBoost;
  if (amount > 0) {
    const inflow = amount * (0.2 + Math.random() * 0.3);
    if (inflow > 1000) {
      postJournal(s, [
        { account: 'cash', debit: inflow },
        { account: 'deposits', credit: inflow },
      ], 'Deposit inflow');
      addEvent(s, 'deposit', 'Deposit inflow +' + fmtDollar(inflow), 'event-income');
    }
  } else {
    const outflow = -amount * (0.5 + Math.random() * 0.5);
    const actual = Math.min(outflow, deposits * 0.05);
    if (actual > 1000) {
      postJournal(s, [
        { account: 'deposits', debit: actual },
        { account: 'cash', credit: actual },
      ], 'Deposit outflow');
      addEvent(s, 'deposit', 'Deposit outflow ' + fmtDollar(-actual), 'event-expense');
    }
  }
}

/** Generate a loan request using a Pareto power-law distribution (α=2). Most requests cluster around `loanDemandPeakPct` of total assets; a heavy tail produces occasional very large requests.
 *  Monthly application volume is proportional to loan officers and scaled by regime demand.
 *  Auto-approves if default probability is below the auto-accept threshold.
 *  @param {object} s */
export function tryLoanRequest(s) {
  const appsPerMonth = s.numWorkers * APPLICATIONS_PER_OFFICER * REGIME_LOAN_DEMAND[s.regime];
  const baseProb = appsPerMonth / TICKS_PER_MONTH;
  if (Math.random() >= baseProb) return;
  const ta = totalAssets(s);
  if (ta < 100) return;
  const peakPct = (s.loanDemandPeakPct || 3) / 100;
  const modeTarget = ta * peakPct;
  const alpha = 2;
  const raw = modeTarget / Math.pow(Math.random(), 1 / alpha);
  const maxLoan = ta * 0.9;
  const amount = Math.min(raw, maxLoan);
  const riskMult = REGIME_DEFAULT_RISK[s.regime];
  const defaultProb = Math.min((1 + Math.random() * 35) * riskMult, 50);
  const suggestedRate = getRateForRisk(s, defaultProb);
  const id = 'lr-' + s.nextEventId;
  addEvent(s, 'loan_request', 'Loan request: ' + fmtDollar(amount), 'event-info', {
    loanAmount: amount,
    defaultProb,
    loanRequestId: id,
    proposedRate: s.loanRate,
    suggestedRate,
    autoProcessAt: s.tick + 15,
    durationMonths: 3 + Math.floor(Math.random() * 34)
  });
}

/** Randomly adjust one of the three ECB policy rates by ±25bp. Direction is biased by economic regime. Enforces corridor ordering: Depo ≤ MRO − 25bp ≤ MLF − 25bp.
 *  @param {object} s */
export function tryEcbChange(s) {
  if (Math.random() >= PROB.ecbChange) return;
  const bias = REGIME_ECB_BIAS[s.regime];
  const actualDir = Math.random() < bias ? 1 : -1;
  const rateIdx = Math.floor(Math.random() * 3);
  const rates = [s.ecbDepositRate, s.ecbMroRate, s.ecbMlfRate];
  const newVal = Math.max(RATE_MIN, Math.min(rates[rateIdx] + actualDir * CB_SPREAD, RATE_MAX));
  let rateName;
  if (rateIdx === 0) {
    s.ecbDepositRate = newVal;
    rateName = ECB_RATE_NAMES[0];
    if (s.ecbMroRate < newVal + CB_SPREAD) s.ecbMroRate = newVal + CB_SPREAD;
    if (s.ecbMlfRate < s.ecbMroRate + CB_SPREAD) s.ecbMlfRate = s.ecbMroRate + CB_SPREAD;
  } else if (rateIdx === 1) {
    s.ecbMroRate = newVal;
    rateName = ECB_RATE_NAMES[1];
    if (s.ecbMlfRate < newVal + CB_SPREAD) s.ecbMlfRate = newVal + CB_SPREAD;
    if (s.ecbDepositRate > newVal - CB_SPREAD) s.ecbDepositRate = newVal - CB_SPREAD;
  } else {
    s.ecbMlfRate = newVal;
    rateName = ECB_RATE_NAMES[2];
    if (s.ecbMroRate > newVal - CB_SPREAD) s.ecbMroRate = newVal - CB_SPREAD;
    if (s.ecbDepositRate > s.ecbMroRate - CB_SPREAD) s.ecbDepositRate = s.ecbMroRate - CB_SPREAD;
  }
  const dirText = actualDir > 0 ? 'raises' : 'lowers';
  addEvent(s, 'ecb', 'ECB ' + dirText + ' ' + rateName + ' to ' + newVal.toFixed(2) + '%', 'event-warn');
}

/** Markov chain regime transition (boom/normal/recession). Transition probabilities are defined in REGIME_TRANSITIONS.
 *  @param {object} s */
export function tryRegimeChange(s) {
  if (Math.random() >= PROB.regimeChange) return;
  const probs = REGIME_TRANSITIONS[s.regime];
  const r = Math.random();
  let cumulative = 0;
  let newRegime = s.regime;
  for (let i = 0; i < 3; i++) {
    cumulative += probs[i];
    if (r < cumulative) { newRegime = REGIME_NAMES[i]; break; }
  }
  if (newRegime !== s.regime) {
    s.regime = newRegime;
    addEvent(s, 'regime', 'Economy enters ' + newRegime + ' regime', 'event-warn');
  }
}
