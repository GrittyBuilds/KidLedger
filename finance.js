/*
 * Core money math for KidLedger.
 *
 * Runs in both the browser (as a plain <script>, exposing `window.Finance`)
 * and Node (via require, for the unit tests) — no DOM or storage in here.
 *
 * Convention for the signed balance:
 *   `balance` = the net amount Parent B owes Parent A.
 *     balance > 0  -> Parent B owes Parent A
 *     balance < 0  -> Parent A owes Parent B  (magnitude is the amount)
 *     balance == 0 -> settled up
 *
 * Each expense is divided into a responsibility share for each parent (they
 * sum to the total). Whoever *paid* fronted the whole amount, so the other
 * parent owes them THAT parent's share.
 *   - Expense paid by A:  B owes A  share_B  -> balance += share_B
 *   - Expense paid by B:  A owes B  share_A  -> balance -= share_A
 *
 * Split types (how the shares are computed):
 *   - even            : 50/50
 *   - percent (value) : Parent A is responsible for `value`% ; B gets the rest
 *   - amount  (value) : Parent A is responsible for $`value` ; B gets the rest
 *   - full    ('A'/'B'): the named parent is responsible for 100%
 *
 * Disputed expenses (status === 'disputed') contribute nothing to the balance
 * until they are approved — a contested charge should not count against the
 * other parent.
 *
 * A settlement payment moves the balance back toward zero.
 *   - Payment from B to A of Y:  balance -= Y
 *   - Payment from A to B of Y:  balance += Y
 */
(function (global) {
  'use strict';

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  function clamp(n, lo, hi) { return Math.min(Math.max(n, lo), hi); }

  /** Each parent's responsibility share of an expense: { A, B } summing to amount. */
  function shares(expense) {
    const amt = Number(expense.amount) || 0;
    const type = expense.split_type || 'even';
    let a;
    switch (type) {
      case 'percent': {
        const pct = clamp(Number(expense.split_value) || 0, 0, 100);
        a = round2(amt * pct / 100);
        break;
      }
      case 'amount': {
        a = round2(clamp(Number(expense.split_value) || 0, 0, amt));
        break;
      }
      case 'full': {
        a = expense.split_value === 'A' ? amt : 0;
        break;
      }
      case 'even':
      default: {
        a = round2(amt / 2);
        break;
      }
    }
    return { A: a, B: round2(amt - a) };
  }

  /** Short human label for a split, e.g. "50/50", "70/30", "$30 / $70", "A pays all". */
  function splitLabel(expense, names) {
    const nm = names || { A: 'A', B: 'B' };
    const s = shares(expense);
    const amt = Number(expense.amount) || 0;
    switch (expense.split_type || 'even') {
      case 'percent': {
        const pctA = amt ? Math.round(s.A / amt * 100) : 0;
        return pctA + '/' + (100 - pctA);
      }
      case 'amount':
        return '$' + s.A.toFixed(2) + ' / $' + s.B.toFixed(2);
      case 'full':
        return (expense.split_value === 'A' ? nm.A : nm.B) + ' pays all';
      case 'even':
      default:
        return '50/50';
    }
  }

  /** Contribution of a single expense to the signed balance (B-owes-A positive). */
  function expenseDelta(expense) {
    if (expense.status === 'disputed') return 0;
    const s = shares(expense);
    return expense.paid_by === 'A' ? s.B : -s.A;
  }

  /** Contribution of a single settlement payment to the signed balance. */
  function paymentDelta(payment) {
    if (payment.from_parent === 'B' && payment.to_parent === 'A') return -payment.amount;
    if (payment.from_parent === 'A' && payment.to_parent === 'B') return payment.amount;
    return 0;
  }

  /** Net signed balance across all expenses and payments (B owes A positive). */
  function computeBalance(expenses, payments) {
    let balance = 0;
    for (const e of expenses) balance += expenseDelta(e);
    for (const p of payments) balance += paymentDelta(p);
    return round2(balance);
  }

  /** Turn a signed balance into a human-friendly summary. `names` = { A, B }. */
  function describeBalance(balance, names) {
    const b = round2(balance);
    if (b === 0) {
      return { settled: true, amount: 0, debtor: null, creditor: null, text: 'All settled up' };
    }
    if (b > 0) {
      return {
        settled: false, amount: b, debtor: 'B', creditor: 'A',
        text: names.B + ' owes ' + names.A + ' $' + b.toFixed(2),
      };
    }
    const amt = round2(-b);
    return {
      settled: false, amount: amt, debtor: 'A', creditor: 'B',
      text: names.A + ' owes ' + names.B + ' $' + amt.toFixed(2),
    };
  }

  /**
   * Build a full monthly billing statement.
   *   month     -> 'YYYY-MM'
   *   expenses  -> ALL expenses (function filters by month itself)
   *   payments  -> ALL payments
   *   names     -> { A, B }
   *
   * Carries the balance forward: computes an opening balance from everything
   * strictly before the month, then applies the month's activity. Disputed
   * expenses are listed separately and excluded from the totals and balance.
   */
  function buildStatement(month, expenses, payments, names) {
    const inMonth = (d) => typeof d === 'string' && d.slice(0, 7) === month;
    const beforeMonth = (d) => typeof d === 'string' && d.slice(0, 7) < month;

    const openingBalance = computeBalance(
      expenses.filter((e) => beforeMonth(e.date)),
      payments.filter((p) => beforeMonth(p.date))
    );

    const monthExpensesAll = expenses
      .filter((e) => inMonth(e.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const monthExpenses = monthExpensesAll.filter((e) => e.status !== 'disputed');
    const disputed = monthExpensesAll.filter((e) => e.status === 'disputed');
    const monthPayments = payments
      .filter((p) => inMonth(p.date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

    let paidByA = 0;
    let paidByB = 0;
    let respA = 0;
    let respB = 0;
    for (const e of monthExpenses) {
      if (e.paid_by === 'A') paidByA += e.amount;
      else paidByB += e.amount;
      const s = shares(e);
      respA += s.A;
      respB += s.B;
    }
    const totalSpent = round2(paidByA + paidByB);

    const toLine = (e) => {
      const s = shares(e);
      const owed = e.paid_by === 'A' ? s.B : s.A; // what the non-payer owes the payer
      return {
        id: e.id,
        date: e.date,
        description: e.description,
        category: e.category,
        child: e.child_name || null,
        amount: round2(e.amount),
        paid_by: e.paid_by,
        paid_by_name: e.paid_by === 'A' ? names.A : names.B,
        share_a: s.A,
        share_b: s.B,
        split_label: splitLabel(e, names),
        owed_amount: round2(owed),
        owed_to: e.paid_by, // the payer is owed
        has_receipt: !!e.receipt,
        notes: e.notes || null,
      };
    };
    const lineItems = monthExpenses.map(toLine);
    const disputedItems = disputed.map(toLine);

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

    const monthExpenseDelta = round2(monthExpenses.reduce((s, e) => s + expenseDelta(e), 0));
    const monthPaymentDelta = round2(monthPayments.reduce((s, p) => s + paymentDelta(p), 0));
    const closingBalance = round2(openingBalance + monthExpenseDelta + monthPaymentDelta);

    return {
      month,
      names,
      opening: { balance: openingBalance, summary: describeBalance(openingBalance, names) },
      totals: {
        total_spent: totalSpent,
        paid_by_a: round2(paidByA),
        paid_by_b: round2(paidByB),
        responsibility_a: round2(respA),
        responsibility_b: round2(respB),
        expense_count: monthExpenses.length,
        disputed_count: disputed.length,
        disputed_total: round2(disputed.reduce((s, e) => s + (Number(e.amount) || 0), 0)),
      },
      line_items: lineItems,
      disputed_items: disputedItems,
      payments: paymentItems,
      net_from_expenses: monthExpenseDelta,
      net_from_payments: monthPaymentDelta,
      closing: { balance: closingBalance, summary: describeBalance(closingBalance, names) },
    };
  }

  const Finance = {
    round2, clamp, shares, splitLabel, expenseDelta, paymentDelta,
    computeBalance, describeBalance, buildStatement,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Finance;
  } else {
    global.Finance = Finance;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
