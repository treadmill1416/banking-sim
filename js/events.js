import { REGIME_LOAN_DEMAND, REGIME_ECB_BIAS, REGIME_DEFAULT_RISK, REGIME_DEPOSIT_MOD, REGIME_TRANSITIONS, REGIME_NAMES, ECB_RATE_NAMES, CB_SPREAD, RATE_MIN, RATE_MAX, PROB, TICKS_PER_MONTH } from './constants.js';
import { addEvent } from './state.js';
import { processLoanApproval } from './mechanics.js';
import { postJournal, getBalance } from './ledger.js';
import { fmtDollar } from './utils.js';

export function tryDepositFlow(s) {
  if (Math.random() >= PROB.depositFlow) return;
  const base = 50000 + Math.random() * 450000;
  const marketRate = s.ecbMroRate;
  const rateDiff = s.depositRate - marketRate;
  const flowModifier = rateDiff * 200000;
  const regimeMod = REGIME_DEPOSIT_MOD[s.regime];
  const amount = (base + flowModifier) * regimeMod;
  if (amount > 0) {
    const inflow = amount * (0.5 + Math.random() * 0.5);
    postJournal(s, [
      { account: 'cash', debit: inflow },
      { account: 'deposits', credit: inflow },
    ], 'Deposit inflow');
    addEvent(s, 'deposit', 'Deposit inflow +' + fmtDollar(inflow), 'event-income');
  } else {
    const outflow = -amount * (0.3 + Math.random() * 0.4);
    const deposits = getBalance(s, 'deposits');
    const actual = Math.min(outflow, deposits * 0.02);
    if (actual > 1000) {
      postJournal(s, [
        { account: 'deposits', debit: actual },
        { account: 'cash', credit: actual },
      ], 'Deposit outflow');
      addEvent(s, 'deposit', 'Deposit outflow ' + fmtDollar(-actual), 'event-expense');
    }
  }
}

export function tryLoanRequest(s) {
  const baseProb = (s.loanRequestsPerMonth || 40) / TICKS_PER_MONTH;
  if (Math.random() >= baseProb) return;
  const demandMult = REGIME_LOAN_DEMAND[s.regime];
  const rateElasticity = Math.max(0.1, 1 - (s.loanRate - 5) * 0.08);
  const baseAmount = 100000 + Math.random() * 1900000;
  const amount = baseAmount * demandMult * rateElasticity;
  const riskMult = REGIME_DEFAULT_RISK[s.regime];
  const defaultProb = Math.min((0.5 + Math.random() * 12) * riskMult, 35);
  const id = 'lr-' + s.nextEventId;
  const entry = addEvent(s, 'loan_request', 'Loan request: ' + fmtDollar(amount), 'event-info', {
    loanAmount: amount,
    defaultProb,
    loanRequestId: id,
    proposedRate: s.loanRate,
    durationMonths: 3 + Math.floor(Math.random() * 34)
  });
  if (s.autoAcceptThreshold > 0 && entry.defaultProb <= s.autoAcceptThreshold) {
    processLoanApproval(s, entry, s.loanRate);
  }
}

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
