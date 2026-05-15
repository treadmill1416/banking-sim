import { getState } from './state.js';
import { addEvent } from './state.js';
import { checkReserves, processLoanApproval } from './mechanics.js';
import { postJournal, getBalance } from './ledger.js';
import { fmtDollar } from './utils.js';

export function approveLoan(id) {
  const s = getState();
  const entry = s.eventLog.find(e => e.loanRequestId === id && e.type === 'loan_request');
  if (!entry || entry.approved !== undefined) return;
  const rateSlider = document.querySelector(`.app-rate-slider[data-id="${id}"]`);
  const rate = rateSlider ? parseFloat(rateSlider.value) || s.loanRate : s.loanRate;
  processLoanApproval(s, entry, rate);
}

export function rejectLoan(id) {
  const s = getState();
  const entry = s.eventLog.find(e => e.loanRequestId === id && e.type === 'loan_request');
  if (!entry || entry.approved !== undefined) return;
  entry.approved = false;
  entry.msg += ' — REJECTED';
  entry.cls = 'event-expense';
}

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
