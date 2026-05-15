import { getState } from './state.js';
import { addEvent } from './state.js';
import { checkReserves } from './mechanics.js';
import { fmtDollar } from './utils.js';

export function approveLoan(id) {
  const s = getState();
  const entry = s.eventLog.find(e => e.loanRequestId === id && e.type === 'loan_request');
  if (!entry || entry.approved !== undefined) return;
  s.loans += entry.loanAmount;
  s.deposits += entry.loanAmount;
  entry.approved = true;
  entry.msg += ' — APPROVED';
  entry.cls = 'event-income';
  addEvent(s, 'loan', 'Loan approved: ' + fmtDollar(entry.loanAmount), 'event-income');
  checkReserves(s);
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
  s.cbBorrowing += amount;
  s.reserves += amount;
  addEvent(s, 'cb', 'Borrowed ' + fmtDollar(amount) + ' from CB at MLF', 'event-expense');
}

export function cbRepay() {
  const s = getState();
  const input = document.getElementById('cbAmount');
  const amount = Math.min(parseFloat(input.value) || 0, s.cbBorrowing);
  if (amount <= 0) return;
  s.cbBorrowing -= amount;
  s.reserves -= amount;
  addEvent(s, 'cb', 'Repaid ' + fmtDollar(amount) + ' to CB', 'event-income');
}
