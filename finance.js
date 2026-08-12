'use strict';

/**
 * Core money math for KidLedger.
 *
 * Convention for the signed balance:
 *   `balance` = the net amount Parent B owes Parent A.
 *     balance > 0  -> Parent B owes Parent A
 *     balance < 0  -> Parent A owes Parent B  (magnitude is the amount)
 *     balance == 0 -> settled up
 *
 * Every expense is split 50/50. Whoever paid covered the other parent's half,
 * so the other parent owes them half of the total.
 *   - Expense paid by A of amount X:  B owes A X/2  -> balance += X/2
 *   - Expense paid by B of amount X:  A owes B X/2  -> balance -= X/2
 *
 * A settlement payment moves the balance back toward zero.
 *   - Payment from B to A of Y:  B pays down what they owe A -> balance -= Y
 *   - Payment from A to B of Y:  A pays down what they owe B -> balance += Y
 */

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Contribution of a single expense to the signed balance (B-owes-A positive). */
function expenseDelta(expense) {
  const half = expense.amount / 2;
  return expense.paid_by === 'A' ? half : -half;
}

/** Contribution of a single settlement payment to the signed balance. */
function paymentDelta(payment) {
  // Payment from B to A reduces what B owes A (balance goes down).
  if (payment.from_parent === 'B' && payment.to_parent === 'A') return -payment.amount;
  if (payment.from_parent === 'A' && payment.to_parent === 'B') return payment.amount;
  return 0; // same-parent / malformed rows contribute nothing
}

/** Net signed balance across all expenses and payments (B owes A positive). */
function computeBalance(expenses, payments) {
  let balance = 0;
  for (const e of expenses) balance += expenseDelta(e);
  for (const p of payments) balance += paymentDelta(p);
  return round2(balance);
}

/**
 * Turn a signed balance into a human-friendly summary.
 * `names` = { A, B }.
 */
function describeBalance(balance, names) {
  const b = round2(balance);
  if (b === 0) {
    return { settled: true, amount: 0, debtor: null, creditor: null, text: 'All settled up' };
  }
  if (b > 0) {
    return {
      settled: false,
      amount: b,
      debtor: 'B',
      creditor: 'A',
      text: `${names.B} owes ${names.A} $${b.toFixed(2)}`,
    };
  }
  const amt = round2(-b);
  return {
    settled: false,
    amount: amt,
    debtor: 'A',
    creditor: 'B',
    text: `${names.A} owes ${names.B} $${amt.toFixed(2)}`,
  };
}

/**
 * Build a full monthly billing statement.
 *
 *   month     -> 'YYYY-MM'
 *   expenses  -> ALL expenses (function filters by month itself)
 *   payments  -> ALL payments
 *   names     -> { A, B }
 *
 * The statement carries the balance forward: it computes an opening balance
 * from everything strictly before the month, then applies this month's
 * activity to produce a closing balance.
 */
function buildStatement(month, expenses, payments, names) {
  const inMonth = (dateStr) => typeof dateStr === 'string' && dateStr.slice(0, 7) === month;
  const beforeMonth = (dateStr) => typeof dateStr === 'string' && dateStr.slice(0, 7) < month;

  const priorExpenses = expenses.filter((e) => beforeMonth(e.date));
  const priorPayments = payments.filter((p) => beforeMonth(p.date));
  const openingBalance = computeBalance(priorExpenses, priorPayments);

  const monthExpenses = expenses
    .filter((e) => inMonth(e.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const monthPayments = payments
    .filter((p) => inMonth(p.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  // Per-parent totals for the month.
  let paidByA = 0;
  let paidByB = 0;
  for (const e of monthExpenses) {
    if (e.paid_by === 'A') paidByA += e.amount;
    else paidByB += e.amount;
  }
  const totalSpent = round2(paidByA + paidByB);
  const eachShare = round2(totalSpent / 2);

  // Line items with each parent's split shown.
  const lineItems = monthExpenses.map((e) => ({
    id: e.id,
    date: e.date,
    description: e.description,
    category: e.category,
    child: e.child_name || null,
    amount: round2(e.amount),
    paid_by: e.paid_by,
    paid_by_name: e.paid_by === 'A' ? names.A : names.B,
    each_share: round2(e.amount / 2),
    notes: e.notes || null,
  }));

  const paymentItems = monthPayments.map((p) => ({
    id: p.id,
    date: p.date,
    from: p.from_parent,
    to: p.to_parent,
    from_name: p.from_parent === 'A' ? names.A : names.B,
    to_name: p.to_parent === 'A' ? names.A : names.B,
    amount: round2(p.amount),
    method: p.method || null,
    notes: p.notes || null,
  }));

  const monthExpenseDelta = round2(
    monthExpenses.reduce((sum, e) => sum + expenseDelta(e), 0)
  );
  const monthPaymentDelta = round2(
    monthPayments.reduce((sum, p) => sum + paymentDelta(p), 0)
  );
  const closingBalance = round2(openingBalance + monthExpenseDelta + monthPaymentDelta);

  return {
    month,
    names,
    opening: {
      balance: openingBalance,
      summary: describeBalance(openingBalance, names),
    },
    totals: {
      total_spent: totalSpent,
      each_share: eachShare,
      paid_by_a: round2(paidByA),
      paid_by_b: round2(paidByB),
      expense_count: monthExpenses.length,
    },
    line_items: lineItems,
    payments: paymentItems,
    net_from_expenses: monthExpenseDelta,
    net_from_payments: monthPaymentDelta,
    closing: {
      balance: closingBalance,
      summary: describeBalance(closingBalance, names),
    },
  };
}

module.exports = {
  round2,
  expenseDelta,
  paymentDelta,
  computeBalance,
  describeBalance,
  buildStatement,
};
