import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { approveLoan, rejectLoan, cbBorrow, cbRepay } from './actions.js';
import { getState, setState, createInitialState } from './state.js';
import { initLedger, postJournal, getBalance } from './ledger.js';

let s;

beforeEach(() => {
  s = createInitialState();
  s.reserves = 100000;
  s.loans = 0;
  s.deposits = 0;
  s.cbBorrowing = 0;
  s.numWorkers = 2;
  initLedger(s);
  setState(s);
  // Seed deposits so loans can be approved
  postJournal(s, [
    { account: 'cash', debit: 500000 },
    { account: 'deposits', credit: 500000 },
  ], 'seed');
  // Mock DOM for cbBorrow/cbRepay that read from an input element
  vi.stubGlobal('document', {
    getElementById: vi.fn((id) => {
      if (id === 'cbAmount') return { value: '50000' };
      return null;
    }),
    querySelector: vi.fn(() => null),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('approveLoan', () => {
  function addLoanRequest() {
    const entry = {
      type: 'loan_request',
      approved: undefined,
      loanAmount: 100000,
      defaultProb: 5,
      trueDefaultProb: 5,
      loanRequestId: 'lr-1',
      durationMonths: 12,
      msg: 'Loan request',
      cls: 'event-info',
    };
    s.eventLog.push(entry);
    return entry;
  }

  it('approves a pending loan request', () => {
    addLoanRequest();
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    approveLoan('lr-1');
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-1');
    expect(entry.approved).toBe(true);
  });

  it('does nothing for already-processed loan', () => {
    addLoanRequest();
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    approveLoan('lr-1');
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-1');
    expect(entry.approved).toBe(true);
    // Second call should do nothing
    approveLoan('lr-1');
    expect(entry.approved).toBe(true);
  });

  it('does nothing for non-existent loan request', () => {
    expect(() => approveLoan('nonexistent')).not.toThrow();
  });

  it('uses rate from slider when available', () => {
    addLoanRequest();
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    // Mock the rate slider and term button
    const mockSlider = { value: '9.5' };
    const mockTermBtn = { dataset: { term: '24' } };
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => null),
      querySelector: vi.fn((sel) => {
        if (sel === '.app-rate-slider[data-id="lr-1"]') return mockSlider;
        if (sel === '.term-btn.active[data-id="lr-1"]') return mockTermBtn;
        return null;
      }),
    });
    approveLoan('lr-1');
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-1');
    expect(entry.approved).toBe(true);
    expect(entry.durationMonths).toBe(24);
  });

  it('handles missing rate slider gracefully', () => {
    addLoanRequest();
    vi.spyOn(Math, 'random').mockReturnValue(1.0);
    // document.querySelector still returns null (from base mock)
    approveLoan('lr-1');
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-1');
    expect(entry.approved).toBe(true);
  });
});

describe('rejectLoan', () => {
  it('marks a pending loan as rejected', () => {
    s.eventLog = [
      { type: 'loan_request', approved: undefined, loanRequestId: 'lr-1', msg: 'Loan request', cls: 'event-info' },
    ];
    rejectLoan('lr-1');
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-1');
    expect(entry.approved).toBe(false);
    expect(entry.msg).toContain('REJECTED');
  });

  it('does nothing for already-processed loans', () => {
    s.eventLog = [
      { type: 'loan_request', approved: true, loanRequestId: 'lr-1', msg: 'Loan', cls: 'event-info' },
    ];
    rejectLoan('lr-1');
    const entry = s.eventLog.find(e => e.loanRequestId === 'lr-1');
    expect(entry.approved).toBe(true);
  });

  it('does nothing for non-existent loan request', () => {
    s.eventLog = [];
    expect(() => rejectLoan('nonexistent')).not.toThrow();
  });
});

describe('cbBorrow', () => {
  it('borrows the specified amount from central bank', () => {
    const cashBefore = getBalance(s, 'cash');
    const cbBefore = getBalance(s, 'cbBorrowing');
    cbBorrow();
    expect(getBalance(s, 'cash')).toBeGreaterThan(cashBefore);
    expect(getBalance(s, 'cbBorrowing')).toBeGreaterThan(cbBefore);
  });

  it('does nothing for zero amount', () => {
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'cbAmount') return { value: '0' };
        return null;
      }),
      querySelector: vi.fn(() => null),
    });
    const cashBefore = getBalance(s, 'cash');
    cbBorrow();
    expect(getBalance(s, 'cash')).toBe(cashBefore);
  });

  it('does nothing for negative amount', () => {
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'cbAmount') return { value: '-5000' };
        return null;
      }),
      querySelector: vi.fn(() => null),
    });
    const cashBefore = getBalance(s, 'cash');
    cbBorrow();
    expect(getBalance(s, 'cash')).toBe(cashBefore);
  });

  it('does nothing when input is NaN', () => {
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'cbAmount') return { value: 'not-a-number' };
        return null;
      }),
      querySelector: vi.fn(() => null),
    });
    const cashBefore = getBalance(s, 'cash');
    cbBorrow();
    expect(getBalance(s, 'cash')).toBe(cashBefore);
  });
});

describe('cbRepay', () => {
  it('repays central bank borrowing up to the balance', () => {
    postJournal(s, [
      { account: 'cash', debit: 200000 },
      { account: 'cbBorrowing', credit: 200000 },
    ], 'borrow');
    expect(getBalance(s, 'cbBorrowing')).toBe(200000);
    const cashBefore = getBalance(s, 'cash');
    cbRepay();
    expect(getBalance(s, 'cbBorrowing')).toBe(150000); // repaid 50k of 200k
    expect(getBalance(s, 'cash')).toBe(cashBefore - 50000);
  });

  it('repays full balance when input exceeds owed', () => {
    postJournal(s, [
      { account: 'cash', debit: 10000 },
      { account: 'cbBorrowing', credit: 10000 },
    ], 'borrow');
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'cbAmount') return { value: '999999' };
        return null;
      }),
      querySelector: vi.fn(() => null),
    });
    cbRepay();
    expect(getBalance(s, 'cbBorrowing')).toBe(0);
  });

  it('does nothing when no CB debt exists', () => {
    const cashBefore = getBalance(s, 'cash');
    cbRepay();
    expect(getBalance(s, 'cbBorrowing')).toBe(0);
    expect(getBalance(s, 'cash')).toBe(cashBefore);
  });

  it('does nothing for zero input', () => {
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'cbAmount') return { value: '0' };
        return null;
      }),
      querySelector: vi.fn(() => null),
    });
    cbRepay();
    expect(getBalance(s, 'cbBorrowing')).toBe(0);
  });
});

describe('rejectLoan edge cases', () => {
  it('rejects multiple pending loans independently', () => {
    s.eventLog = [
      { type: 'loan_request', approved: undefined, loanRequestId: 'lr-1', msg: 'First', cls: 'event-info' },
      { type: 'loan_request', approved: undefined, loanRequestId: 'lr-2', msg: 'Second', cls: 'event-info' },
    ];
    rejectLoan('lr-1');
    expect(s.eventLog.find(e => e.loanRequestId === 'lr-1').approved).toBe(false);
    expect(s.eventLog.find(e => e.loanRequestId === 'lr-2').approved).toBeUndefined();
  });

  it('handles request ID that does not start with lr-', () => {
    s.eventLog = [
      { type: 'loan_request', approved: undefined, loanRequestId: 'custom-1', msg: 'Loan', cls: 'event-info' },
    ];
    rejectLoan('custom-1');
    expect(s.eventLog[0].approved).toBe(false);
  });
});
