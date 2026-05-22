import { describe, it, expect, beforeEach } from 'vitest';
import {
  requiredReserves, reserveRatio, totalAssets, computeNim,
  trailingNpl, accrueInterest, activeLoanCapacity, countActiveLoans,
  recomputeWeightedLoanRate, computeDefaultRate, getRateForRisk,
  processAutoDecisions, updatePenalty, computeRwa, checkSolvency, processResearch,
} from './mechanics.js';
import { initLedger, postJournal, getBalance } from './ledger.js';
import { createInitialState } from './state.js';

let s;

beforeEach(() => {
  s = createInitialState();
  s.reserves = 100000;
  s.loans = 0;
  s.deposits = 0;
  s.cbBorrowing = 0;
  initLedger(s);
});

describe('requiredReserves', () => {
  it('returns percentage of deposits', () => {
    postJournal(s, [
      { account: 'cash', debit: 1000000 },
      { account: 'deposits', credit: 1000000 },
    ], 'deposit');
    const req = requiredReserves(s);
    expect(req).toBe(1000000 * 0.01);
  });
});

describe('reserveRatio', () => {
  it('returns 100 when no deposits', () => {
    expect(reserveRatio(s)).toBe(100);
  });

  it('calculates cash/deposits ratio', () => {
    postJournal(s, [
      { account: 'cash', debit: 100000 },
      { account: 'deposits', credit: 1000000 },
    ], 'deposit');
    expect(reserveRatio(s)).toBeCloseTo(20, 1);
  });
});

describe('totalAssets', () => {
  it('sums cash and loans', () => {
    postJournal(s, [
      { account: 'loansReceivable', debit: 500000 },
      { account: 'cash', debit: 200000 },
    ], 'setup');
    expect(totalAssets(s)).toBe(700000 + s.reserves);
  });
});

describe('computeNim', () => {
  it('returns 0 if no earning assets', () => {
    s.reserves = 0;
    s.ledgerBalances.cash = 0;
    expect(computeNim(s)).toBe(0);
  });

  it('returns positive NIM with standard settings', () => {
    postJournal(s, [
      { account: 'cash', debit: 1000000 },
      { account: 'deposits', credit: 1000000 },
    ], 'deposit');
    postJournal(s, [
      { account: 'loansReceivable', debit: 5000000 },
      { account: 'deposits', credit: 5000000 },
    ], 'loans');
    s.weightedLoanRate = 5.5;
    s.depositRate = 1.5;
    s.ecbDepositRate = 3.75;
    s.ecbMlfRate = 4.25;
    const nim = computeNim(s);
    expect(nim).toBeGreaterThan(0);
  });
});

describe('activeLoanCapacity / countActiveLoans', () => {
  it('returns capacity based on worker count', () => {
    s.numWorkers = 3;
    expect(activeLoanCapacity(s)).toBe(30);
    expect(countActiveLoans(s)).toBe(0);
  });

  it('counts only active loans', () => {
    s.loanRecords = [
      { status: 'active' },
      { status: 'repaid' },
      { status: 'active' },
      { status: 'defaulted' },
    ];
    expect(countActiveLoans(s)).toBe(2);
  });
});

describe('trailingNpl', () => {
  it('returns 0 when no defaults', () => {
    expect(trailingNpl(s)).toBe(0);
  });
});

describe('accrueInterest', () => {
  it('accumulates daily interest on deposits and reserves', () => {
    postJournal(s, [
      { account: 'cash', debit: 1000000 },
      { account: 'deposits', credit: 1000000 },
    ], 'deposit');
    s.depositRate = 2.0;
    s.ecbDepositRate = 1.0;
    accrueInterest(s);
    expect(s._dailyInt.depoInt).toBeGreaterThan(0);
    expect(s._dailyInt.resInt).toBeGreaterThan(0);
  });
});

describe('recomputeWeightedLoanRate', () => {
  it('falls back to base loan rate when no active loans', () => {
    s.loanRecords = [];
    recomputeWeightedLoanRate(s);
    expect(s.weightedLoanRate).toBe(s.loanRate);
  });

  it('computes weighted average of active loan rates', () => {
    s.loanRecords = [
      { status: 'active', remainingBalance: 100000, rate: 5, amount: 100000 },
      { status: 'active', remainingBalance: 200000, rate: 7, amount: 200000 },
      { status: 'repaid', remainingBalance: 0, rate: 10, amount: 100000 },
    ];
    recomputeWeightedLoanRate(s);
    const expected = (100000 * 5 + 200000 * 7) / (100000 + 200000);
    expect(s.weightedLoanRate).toBeCloseTo(expected, 8);
  });
});

describe('computeDefaultRate', () => {
  it('returns 0 when no finished loans', () => {
    s.loanRecords = [];
    expect(computeDefaultRate(s)).toBe(0);
  });
});

describe('getRateForRisk', () => {
  beforeEach(() => {
    s.riskRateMap = [
      { risk: 0, rate: 5.5 },
      { risk: 10, rate: 7.0 },
      { risk: 20, rate: 20.0 },
      { risk: 30, rate: null },
      { risk: 50, rate: null },
    ];
  });

  it('returns exact rate for an exact risk match', () => {
    expect(getRateForRisk(s, 0)).toBe(5.5);
    expect(getRateForRisk(s, 10)).toBe(7.0);
    expect(getRateForRisk(s, 20)).toBe(20.0);
  });

  it('returns null for risks mapped to reject zone', () => {
    expect(getRateForRisk(s, 30)).toBeNull();
    expect(getRateForRisk(s, 50)).toBeNull();
  });

  it('returns null for any risk in a reject segment', () => {
    expect(getRateForRisk(s, 35)).toBeNull();
    expect(getRateForRisk(s, 40)).toBeNull();
    expect(getRateForRisk(s, 45)).toBeNull();
  });

  it('interpolates between two valid points', () => {
    const r = getRateForRisk(s, 5);
    expect(r).toBeCloseTo(6.25, 2);
  });

  it('returns rate for risk below lowest map entry', () => {
    expect(getRateForRisk(s, 0)).toBe(5.5);
  });

  it('returns null for risk above highest map entry when endpoint is reject', () => {
    expect(getRateForRisk(s, 55)).toBeNull();
  });

  it('falls back to loanRate when riskRateMap is empty', () => {
    s.riskRateMap = [];
    expect(getRateForRisk(s, 10)).toBe(s.loanRate);
  });

  it('falls back to loanRate when riskRateMap is missing', () => {
    delete s.riskRateMap;
    expect(getRateForRisk(s, 10)).toBe(s.loanRate);
  });
});

describe('processAutoDecisions', () => {
  it('auto-approves loan past autoProcessAt with a valid suggestedRate', () => {
    s.tick = 50;
    s.loanRecords = [];
    s.eventLog = [{
      type: 'loan_request',
      approved: undefined,
      tick: 30,
      autoProcessAt: 45,
      suggestedRate: 6.0,
      defaultProb: 5,
      loanAmount: 50000,
      loanRequestId: 'lr-1',
      durationMonths: 12,
    }];
    processAutoDecisions(s);
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-1');
    expect(entry.approved).toBe(true);
  });

  it('auto-rejects loan past autoProcessAt when suggestedRate is null', () => {
    s.tick = 50;
    s.eventLog = [{
      type: 'loan_request',
      approved: undefined,
      tick: 30,
      autoProcessAt: 45,
      suggestedRate: null,
      defaultProb: 35,
      loanAmount: 50000,
      loanRequestId: 'lr-2',
      durationMonths: 12,
    }];
    processAutoDecisions(s);
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-2');
    expect(entry.approved).toBe(false);
  });

  it('does not process loans before autoProcessAt', () => {
    s.tick = 40;
    s.eventLog = [{
      type: 'loan_request',
      approved: undefined,
      tick: 30,
      autoProcessAt: 45,
      suggestedRate: 6.0,
      defaultProb: 5,
      loanAmount: 50000,
      loanRequestId: 'lr-3',
      durationMonths: 12,
    }];
    processAutoDecisions(s);
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-3');
    expect(entry.approved).toBeUndefined();
  });

  it('skips already-processed loans', () => {
    s.tick = 50;
    s.eventLog = [{
      type: 'loan_request',
      approved: false,
      tick: 30,
      autoProcessAt: 45,
      suggestedRate: 6.0,
      defaultProb: 5,
      loanAmount: 50000,
      loanRequestId: 'lr-4',
      durationMonths: 12,
    }];
    processAutoDecisions(s);
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-4');
    expect(entry.approved).toBe(false);
  });
});

describe('computeRwa', () => {
  it('returns 0 when no active loans', () => {
    s.loanRecords = [];
    expect(computeRwa(s)).toBe(0);
  });

  it('assigns correct risk weights by default prob band', () => {
    s.loanRecords = [
      { status: 'active', remainingBalance: 100000, defaultProb: 1, trueDefaultProb: 1 },
      { status: 'active', remainingBalance: 100000, defaultProb: 5, trueDefaultProb: 5 },
      { status: 'active', remainingBalance: 100000, defaultProb: 15, trueDefaultProb: 15 },
      { status: 'active', remainingBalance: 100000, defaultProb: 30, trueDefaultProb: 30 },
    ];
    const rwa = computeRwa(s);
    // 35% + 75% + 100% + 150% of 100000 each
    expect(rwa).toBeCloseTo(100000 * 0.35 + 100000 * 0.75 + 100000 * 1.0 + 100000 * 1.5, 1);
  });

  it('uses trueDefaultProb when available, falls back to defaultProb', () => {
    s.loanRecords = [
      { status: 'active', remainingBalance: 100000, defaultProb: 5, trueDefaultProb: 1 },
    ];
    // trueDefaultProb=1 → 35% weight
    expect(computeRwa(s)).toBeCloseTo(35000, 1);
  });

  it('skips non-active loans', () => {
    s.loanRecords = [
      { status: 'active', remainingBalance: 100000, defaultProb: 1 },
      { status: 'repaid', remainingBalance: 100000, defaultProb: 30 },
      { status: 'defaulted', remainingBalance: 100000, defaultProb: 30 },
    ];
    expect(computeRwa(s)).toBeCloseTo(35000, 1);
  });
});

describe('checkSolvency', () => {
  it('increments ticksNegativeEquity when equity is negative', () => {
    postJournal(s, [
      { account: 'cash', credit: 200000 },
      { account: 'equity', debit: 200000 },
    ], 'wreck');
    checkSolvency(s);
    expect(s.ticksNegativeEquity).toBe(1);
  });

  it('resets to 0 when equity is positive', () => {
    s.ticksNegativeEquity = 5;
    checkSolvency(s);
    expect(s.ticksNegativeEquity).toBe(0);
  });

  it('does not increment when equity is zero', () => {
    s.ticksNegativeEquity = 3;
    postJournal(s, [
      { account: 'cash', credit: 200000 },
      { account: 'equity', debit: 200000 },
    ], 'wreck');
    postJournal(s, [
      { account: 'cash', debit: 200000 },
      { account: 'equity', credit: 200000 },
    ], 'fix');
    checkSolvency(s);
    expect(s.ticksNegativeEquity).toBe(0);
  });

  it('returns the current tick count', () => {
    postJournal(s, [
      { account: 'cash', credit: 200000 },
      { account: 'equity', debit: 200000 },
    ], 'wreck');
    const result = checkSolvency(s);
    expect(result).toBe(1);
  });
});

describe('processResearch', () => {
  it('adds research points on month boundaries', () => {
    s.creditAnalysts = 3;
    s.tick = 60;
    s.researchPoints = 0;
    processResearch(s);
    expect(s.researchPoints).toBe(3);
  });

  it('does nothing on non-month ticks', () => {
    s.creditAnalysts = 3;
    s.tick = 30;
    s.researchPoints = 0;
    processResearch(s);
    expect(s.researchPoints).toBe(0);
  });

  it('handles zero analysts', () => {
    s.creditAnalysts = 0;
    s.tick = 60;
    s.researchPoints = 5;
    processResearch(s);
    expect(s.researchPoints).toBe(5);
  });

  it('accumulates over multiple months', () => {
    s.creditAnalysts = 2;
    s.tick = 60;
    s.researchPoints = 0;
    processResearch(s);
    s.tick = 120;
    processResearch(s);
    expect(s.researchPoints).toBe(4);
  });
});

describe('updatePenalty', () => {
  beforeEach(() => {
    s.tick = 60;
    // Add a loan record so RWA can compute
    s.loanRecords = [{
      status: 'active',
      amount: 500000,
      remainingBalance: 500000,
      defaultProb: 2,
      trueDefaultProb: 2,
      rate: 5,
    }];
    postJournal(s, [
      { account: 'cash', debit: 400000 },
      { account: 'deposits', credit: 600000 },
      { account: 'loansReceivable', debit: 500000 },
      { account: 'equity', credit: 300000 },
    ], 'setup');
    s.penaltyPoints = 0;
  });

  it('adds no penalty when all checks pass', () => {
    updatePenalty(s);
    expect(s.penaltyPoints).toBe(0);
  });

  it('adds no penalty on non-month ticks', () => {
    postJournal(s, [{ account: 'equity', debit: 999999 }], 'wipe');
    s.tick = 1;
    updatePenalty(s);
    expect(s.penaltyPoints).toBe(0);
  });

  it('charges capital adequacy penalty when equity/RWA < 8%', () => {
    // Reduce equity to push equity/RWA below 8% (RWA = 500000*0.35 = 175000, 8% = 14000)
    postJournal(s, [
      { account: 'cash', credit: 392000 },
      { account: 'equity', debit: 392000 },
    ], 'low capital');
    s.tick = 120;
    updatePenalty(s);
    expect(s.penaltyPoints).toBeGreaterThan(0);
  });

  it('charges reserve requirement penalty when RR < 1%', () => {
    postJournal(s, [
      { account: 'cash', credit: 490000 },
      { account: 'equity', debit: 490000 },
    ], 'low reserves');
    updatePenalty(s);
    expect(s.penaltyPoints).toBeGreaterThan(0);
  });

  it('charges NPL penalty when trailing NPL > 5%', () => {
    s.defaultTicks = [60, 60];
    s.defaultAmounts = [40000, 40000];
    updatePenalty(s);
    expect(s.penaltyPoints).toBeGreaterThan(0);
  });

  it('charges loan capacity penalty when active > capacity', () => {
    s.loanRecords = [
      { status: 'active' }, { status: 'active' }, { status: 'active' },
      { status: 'active' }, { status: 'active' }, { status: 'active' },
      { status: 'active' }, { status: 'active' }, { status: 'active' },
      { status: 'active' }, { status: 'active' }, { status: 'active' },
    ];
    updatePenalty(s);
    expect(s.penaltyPoints).toBeGreaterThan(0);
  });

  it('decays by 5 points when fully compliant', () => {
    s.penaltyPoints = 30;
    updatePenalty(s);
    expect(s.penaltyPoints).toBe(25);
  });

  it('does not decay below 0', () => {
    s.penaltyPoints = 3;
    updatePenalty(s);
    expect(s.penaltyPoints).toBe(0);
  });

  it('caps at 100', () => {
    s.penaltyPoints = 99;
    // Push equity negative through capital adequacy violation
    postJournal(s, [
      { account: 'cash', credit: 400000 },
      { account: 'equity', debit: 400000 },
    ], 'wreck');
    s.tick = 60;
    updatePenalty(s);
    expect(s.penaltyPoints).toBe(100);
  });
});
