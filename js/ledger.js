/** @module ledger - Double-entry accounting system. Manages chart of accounts, journal entries (debit/credit balancing), daily interest posting, and month-to-month P&L tracking. */

import { TICKS_PER_MONTH } from './constants.js';

/** Account type classification. Determines whether a balance increases on debit (asset, expense) or credit (liability, equity, income). */
export const ACCOUNT_TYPES = {
  cash: 'asset',
  loansReceivable: 'asset',
  deposits: 'liability',
  cbBorrowing: 'liability',
  equity: 'equity',
  retainedEarnings: 'equity',
  interestIncome: 'income',
  reserveInterestIncome: 'income',
  interestExpense: 'expense',
  cbInterestExpense: 'expense',
  defaultLosses: 'expense',
  salaryExpense: 'expense',
  insuranceExpense: 'expense',
};

/** Initialize the ledger: reset journal, balances, and post opening entries from the flat state fields.
 *  @param {object} s - State object */
export function initLedger(s) {
  s.ledgerJournal = [];
  s.ledgerBalances = {};
  s.ledgerNextId = 1;
  s._dailyInt = { depoInt: 0, resInt: 0, cbInt: 0 };
  s.ledgerMonthStart = null;
  s.ledgerLastMonth = null;

  const eq = (s.reserves || 0) + (s.loans || 0)
           - (s.deposits || 0) - (s.cbBorrowing || 0);
  postJournal(s, [
    { account: 'cash', debit: s.reserves || 0 },
    { account: 'loansReceivable', debit: s.loans || 0 },
    { account: 'deposits', credit: s.deposits || 0 },
    { account: 'cbBorrowing', credit: s.cbBorrowing || 0 },
    { account: 'equity', credit: eq },
  ], 'Opening balances');

  s.ledgerMonthStart = snapshotIncomeAccounts(s);
}

/** Snapshot all income/expense account balances at the current tick for later P&L delta computation.
 *  @param {object} s
 *  @returns {object} */
function snapshotIncomeAccounts(s) {
  const b = s.ledgerBalances;
  return {
    interestIncome: b.interestIncome || 0,
    reserveInterestIncome: b.reserveInterestIncome || 0,
    interestExpense: b.interestExpense || 0,
    cbInterestExpense: b.cbInterestExpense || 0,
    defaultLosses: b.defaultLosses || 0,
    salaryExpense: b.salaryExpense || 0,
    insuranceExpense: b.insuranceExpense || 0,
    tick: s.tick,
  };
}

/** Post a journal entry with multiple lines. Validates debit = credit. Debits increase asset/expense accounts; credits increase liability/equity/income accounts.
 *  @param {object} s - State object
 *  @param {Array<{account: string, debit?: number, credit?: number}>} entries - Journal lines
 *  @param {string} desc - Human-readable description */
export function postJournal(s, entries, desc) {
  let totalDebit = 0, totalCredit = 0;
  for (const e of entries) {
    const type = ACCOUNT_TYPES[e.account];
    if (!type) continue;
    s.ledgerBalances[e.account] = s.ledgerBalances[e.account] || 0;
    if (e.debit) {
      totalDebit += e.debit;
      if (type === 'asset' || type === 'expense') {
        s.ledgerBalances[e.account] += e.debit;
      } else {
        s.ledgerBalances[e.account] -= e.debit;
      }
    }
    if (e.credit) {
      totalCredit += e.credit;
      if (type === 'liability' || type === 'equity' || type === 'income') {
        s.ledgerBalances[e.account] += e.credit;
      } else {
        s.ledgerBalances[e.account] -= e.credit;
      }
    }
  }
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    console.warn('Unbalanced JE:', desc, totalDebit, totalCredit);
  }
  s.ledgerJournal.push({
    id: 'je-' + (s.ledgerNextId++),
    day: Math.floor(s.tick / 2),
    tick: s.tick,
    entries: entries.map(e => ({ ...e })),
    desc,
  });

  const bal = s.ledgerBalances;
  if ((bal.deposits || 0) < 0) {
    const excess = -(bal.deposits || 0);
    bal.deposits = 0;
    bal.cash = (bal.cash || 0) + excess;
  }
  if ((bal.cash || 0) < 0) {
    const deficit = -(bal.cash || 0);
    bal.cash = 0;
    bal.cbBorrowing = (bal.cbBorrowing || 0) + deficit;
  }
}

/** Get the current balance of any account.
 *  @param {object} s
 *  @param {string} account
 *  @returns {number} */
export function getBalance(s, account) {
  return s.ledgerBalances[account] || 0;
}

/** Compute equity as total assets minus total liabilities.
 *  @param {object} s
 *  @returns {number} */
export function getEquity(s) {
  const b = s.ledgerBalances;
  const assets = (b.cash || 0) + (b.loansReceivable || 0);
  const liabilities = (b.deposits || 0) + (b.cbBorrowing || 0);
  return assets - liabilities;
}

/** Compute net income as total income minus total expenses.
 *  @param {object} s
 *  @returns {number} */
export function getNetIncome(s) {
  const b = s.ledgerBalances;
  const income = (b.interestIncome || 0) + (b.reserveInterestIncome || 0);
  const expenses = (b.interestExpense || 0) + (b.cbInterestExpense || 0) + (b.defaultLosses || 0);
  return income - expenses;
}

/** Post accumulated daily interest as journal entries. Resets the daily interest accumulator.
 *  Called every 24 ticks in the game loop.
 *  @param {object} s */
export function postDailyInterest(s) {
  const d = s._dailyInt;
  const entries = [];
  if (Math.abs(d.depoInt) >= 0.0005) {
    entries.push({ account: 'interestExpense', debit: d.depoInt });
    entries.push({ account: 'cash', credit: d.depoInt });
  }
  if (Math.abs(d.resInt) >= 0.0005) {
    entries.push({ account: 'cash', debit: d.resInt });
    entries.push({ account: 'reserveInterestIncome', credit: d.resInt });
  }
  if (Math.abs(d.cbInt) >= 0.0005) {
    entries.push({ account: 'cbInterestExpense', debit: d.cbInt });
    entries.push({ account: 'cash', credit: d.cbInt });
  }
  if (entries.length > 0) {
    postJournal(s, entries, 'Daily interest');
  }
  s._dailyInt = { depoInt: 0, resInt: 0, cbInt: 0 };
}

/** Get month-to-date P&L as deltas from the month-start snapshot.
 *  @param {object} s
 *  @returns {object|null} */
export function getCurrentMonthPnl(s) {
  const b = s.ledgerBalances;
  const ms = s.ledgerMonthStart;
  if (!ms) return null;
  return {
    interestIncome: (b.interestIncome || 0) - ms.interestIncome,
    reserveInterestIncome: (b.reserveInterestIncome || 0) - ms.reserveInterestIncome,
    interestExpense: (b.interestExpense || 0) - ms.interestExpense,
    cbInterestExpense: (b.cbInterestExpense || 0) - ms.cbInterestExpense,
    defaultLosses: (b.defaultLosses || 0) - ms.defaultLosses,
    salaryExpense: (b.salaryExpense || 0) - ms.salaryExpense,
    insuranceExpense: (b.insuranceExpense || 0) - ms.insuranceExpense,
  };
}

/** Snapshot income accounts and store completed month P&L if a month boundary has been crossed.
 *  @param {object} s */
export function updateLedgerPnl(s) {
  const current = snapshotIncomeAccounts(s);
  if (s.tick - (s.ledgerMonthStart?.tick || 0) >= TICKS_PER_MONTH) {
    s.debugMonthStartEquity = getEquity(s);
    s.ledgerLastMonth = {
      interestIncome: current.interestIncome - s.ledgerMonthStart.interestIncome,
      reserveInterestIncome: current.reserveInterestIncome - s.ledgerMonthStart.reserveInterestIncome,
      interestExpense: current.interestExpense - s.ledgerMonthStart.interestExpense,
      cbInterestExpense: current.cbInterestExpense - s.ledgerMonthStart.cbInterestExpense,
      defaultLosses: current.defaultLosses - s.ledgerMonthStart.defaultLosses,
      salaryExpense: current.salaryExpense - s.ledgerMonthStart.salaryExpense,
      insuranceExpense: current.insuranceExpense - s.ledgerMonthStart.insuranceExpense,
    };
    s.ledgerMonthStart = current;
  }
}
