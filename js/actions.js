import { getState } from './state.js';
import { addEvent } from './state.js';
import { checkReserves, processLoanApproval } from './mechanics.js';
import { postJournal, getBalance } from './ledger.js';
import { fmtDollar } from './utils.js';

/** @module actions - Player-initiated actions. Thin wrappers that read UI state and delegate to mechanics/ledger. */

/** Approve a pending loan request. Reads the rate from the per-loan slider in the UI.
 *  @param {string|number} id - loanRequestId */
export function approveLoan(id) {
  const s = getState();
  const entry = s.eventLog.find(e => e.loanRequestId === id && e.type === 'loan_request');
  if (!entry || entry.approved !== undefined) return;
  const rateSlider = document.querySelector(`.app-rate-slider[data-id="${id}"]`);
  const rate = rateSlider ? parseFloat(rateSlider.value) || s.loanRate : s.loanRate;
  processLoanApproval(s, entry, rate);
}

/** Reject a pending loan request.
 *  @param {string|number} id - loanRequestId */
export function rejectLoan(id) {
  const s = getState();
  const entry = s.eventLog.find(e => e.loanRequestId === id && e.type === 'loan_request');
  if (!entry || entry.approved !== undefined) return;
  entry.approved = false;
  entry.msg += ' — REJECTED';
  entry.cls = 'event-expense';
}

/** Borrow from the central bank at the marginal lending facility rate. Amount from UI input.
 *  Posts journal entry: cash Dr, cbBorrowing Cr. */
export function cbBorrow() {
  const s = getState();
  const input = document.getElementById('cbAmount');
  const amount = parseFloat(input.value) || 0;
  if (amount <= 0) return;
  postJournal(s, [
    { account: 'cash', debit: amount },
    { account: 'cbBorrowing', credit: amount },
  ], 'Manual CB borrowing');
  addEvent(s, 'cb', 'Borrowed ' + fmtDollar(amount) + ' from CB at MLF', 'event-expense');
}

/** Repay central bank borrowing (capped at current cbBorrowing balance). Amount from UI input.
 *  Posts journal entry: cbBorrowing Dr, cash Cr. */
export function cbRepay() {
  const s = getState();
  const input = document.getElementById('cbAmount');
  const amount = Math.min(parseFloat(input.value) || 0, getBalance(s, 'cbBorrowing'));
  if (amount <= 0) return;
  postJournal(s, [
    { account: 'cbBorrowing', debit: amount },
    { account: 'cash', credit: amount },
  ], 'Manual CB repayment');
  addEvent(s, 'cb', 'Repaid ' + fmtDollar(amount) + ' to CB', 'event-income');
}
