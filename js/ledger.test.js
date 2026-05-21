import { describe, it, expect, beforeEach } from 'vitest';
import { initLedger, postJournal, getBalance, getEquity, getNetIncome, postDailyInterest, getCurrentMonthPnl, updateLedgerPnl } from './ledger.js';
import { createInitialState } from './state.js';

let s;

beforeEach(() => {
  s = createInitialState();
  s.reserves = 100000;
  s.loans = 0;
  s.deposits = 0;
  s.cbBorrowing = 0;
});

describe('initLedger', () => {
  it('initializes ledgerJournal and ledgerBalances', () => {
    initLedger(s);
    expect(Array.isArray(s.ledgerJournal)).toBe(true);
    expect(typeof s.ledgerBalances).toBe('object');
  });

  it('posts opening balances', () => {
    s.reserves = 200000;
    s.deposits = 1000000;
    s.cbBorrowing = 500000;
    initLedger(s);
    expect(getBalance(s, 'cash')).toBe(200000);
    expect(getBalance(s, 'deposits')).toBe(1000000);
    expect(getBalance(s, 'cbBorrowing')).toBe(500000);
  });

  it('computes equity correctly', () => {
    s.reserves = 500000;
    s.loans = 2000000;
    s.deposits = 2000000;
    s.cbBorrowing = 300000;
    initLedger(s);
    const eq = getEquity(s);
    expect(eq).toBe(500000 + 2000000 - 2000000 - 300000);
  });
});

describe('postJournal', () => {
  beforeEach(() => {
    initLedger(s);
  });

  it('posts a simple cash debit', () => {
    postJournal(s, [{ account: 'cash', debit: 1000 }], 'test');
    expect(getBalance(s, 'cash')).toBe(s.reserves + 1000);
  });

  it('posts a deposit credit', () => {
    postJournal(s, [
      { account: 'cash', debit: 5000 },
      { account: 'deposits', credit: 5000 },
    ], 'deposit');
    expect(getBalance(s, 'deposits')).toBe(5000);
    expect(getBalance(s, 'cash')).toBe(s.reserves + 5000);
  });

  it('creates a journal entry record', () => {
    postJournal(s, [
      { account: 'cash', debit: 100 },
      { account: 'equity', credit: 100 },
    ], 'test entry');
    const last = s.ledgerJournal[s.ledgerJournal.length - 1];
    expect(last.desc).toBe('test entry');
    expect(last.entries).toHaveLength(2);
  });

  it('auto-fixes negative deposits by zeroing them', () => {
    postJournal(s, [
      { account: 'deposits', debit: 999999 },
    ], 'drain deposits');
    expect(getBalance(s, 'deposits')).toBe(0);
  });
});

describe('getEquity', () => {
  beforeEach(() => {
    initLedger(s);
  });

  it('equals assets minus liabilities', () => {
    postJournal(s, [
      { account: 'cash', debit: 50000 },
      { account: 'deposits', credit: 50000 },
    ], 'deposit');
    postJournal(s, [
      { account: 'loansReceivable', debit: 30000 },
      { account: 'deposits', credit: 30000 },
    ], 'loan');
    const eq = getEquity(s);
    const expected = (s.reserves + 50000 + 30000) - (50000 + 30000);
    expect(eq).toBe(expected);
  });
});

describe('getNetIncome', () => {
  beforeEach(() => {
    initLedger(s);
  });

  it('starts at zero', () => {
    expect(getNetIncome(s)).toBe(0);
  });

  it('reflects interest income minus expenses', () => {
    postJournal(s, [
      { account: 'interestIncome', credit: 1000 },
    ], 'income');
    expect(getNetIncome(s)).toBe(1000);
    postJournal(s, [
      { account: 'interestExpense', debit: 300 },
    ], 'expense');
    expect(getNetIncome(s)).toBe(700);
  });
});

describe('postDailyInterest', () => {
  beforeEach(() => {
    initLedger(s);
  });

  it('posts accumulated daily interest', () => {
    s._dailyInt.depoInt = 50;
    s._dailyInt.resInt = 30;
    postDailyInterest(s);
    expect(getBalance(s, 'cash')).toBe(s.reserves - 50 + 30);
    expect(s._dailyInt.depoInt).toBe(0);
    expect(s._dailyInt.resInt).toBe(0);
  });
});

describe('getCurrentMonthPnl', () => {
  beforeEach(() => {
    initLedger(s);
  });

  it('returns null if no month start snapshot', () => {
    s.ledgerMonthStart = null;
    expect(getCurrentMonthPnl(s)).toBeNull();
  });

  it('computes month-to-date P&L deltas', () => {
    const ms = { ...s.ledgerMonthStart };
    postJournal(s, [
      { account: 'interestIncome', credit: 500 },
    ], 'income');
    const pnl = getCurrentMonthPnl(s);
    expect(pnl.interestIncome).toBe(500);
  });
});

describe('updateLedgerPnl', () => {
  beforeEach(() => {
    initLedger(s);
  });

  it('snapshots month start equity on month boundary', () => {
    s.tick = 30;
    updateLedgerPnl(s);
    expect(s.ledgerLastMonth).toBeNull();
    s.tick = 60;
    updateLedgerPnl(s);
    expect(s.debugMonthStartEquity).toBeDefined();
  });
});
