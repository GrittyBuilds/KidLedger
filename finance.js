/*
 * Core money math for KidLedger.
 *
 * Runs in both the browser (as a plain <script>, exposing `window.Finance`)
 * and Node (via require, for the unit tests) — no DOM or storage in here.
 *
 * Signed balance convention:
 *   `balance` = the net amount Parent B owes Parent A.
 *     > 0  -> Parent B owes Parent A
 *     < 0  -> Parent A owes Parent B  (magnitude is the amount)
 *     == 0 -> settled up
 *
 * Each expense is divided into a responsibility share for each parent (they sum
 * to the total). Whoever paid fronted the whole amount, so the other parent owes
 * them THAT parent's share.  Split types: even | percent(A%) | amount($ to A) |
 * full('A'|'B').  Disputed expenses contribute nothing until approved.
 *
 * Billing model (accounts-receivable style):
 *   - A STATEMENT covers one calendar month of expenses. It is issued on the 1st
 *     of the following month and due on the 20th of the following month.
 *   - Settlement PAYMENTS and manual ADJUSTMENTS/rollover are applied to a
 *     specific statement period (statement_period = 'YYYY-MM'), or left unapplied.
 *   - A statement's outstanding = its charges + payments/adjustments applied to it.
 *     Status: paid (outstanding ~ 0), overdue (past the due date), else open.
 *
 * Settlement payment: from B to A -> balance -= amount; from A to B -> += amount.
 * Adjustment: favor 'A' (owed to A) -> += amount; favor 'B' -> -= amount.
 */
(function (global) {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var ISSUE_DAY = '01';
  var DUE_DAY = '20';

  function round2(n) { return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100; }
  function clamp(n, lo, hi) { return Math.min(Math.max(n, lo), hi); }
  function monthName(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return MONTHS[m - 1] + ' ' + y; }
  function nextMonth(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + (m < 10 ? '0' : '') + m; }

  function shares(expense) {
    var amt = Number(expense.amount) || 0;
    var type = expense.split_type || 'even';
    var a;
    switch (type) {
      case 'percent': a = round2(amt * clamp(Number(expense.split_value) || 0, 0, 100) / 100); break;
      case 'amount': a = round2(clamp(Number(expense.split_value) || 0, 0, amt)); break;
      case 'full': a = expense.split_value === 'A' ? amt : 0; break;
      default: a = round2(amt / 2); break;
    }
    return { A: a, B: round2(amt - a) };
  }

  function splitLabel(expense, names) {
    var nm = names || { A: 'A', B: 'B' };
    var s = shares(expense);
    var amt = Number(expense.amount) || 0;
    switch (expense.split_type || 'even') {
      case 'percent': var pctA = amt ? Math.round(s.A / amt * 100) : 0; return pctA + '/' + (100 - pctA);
      case 'amount': return '$' + s.A.toFixed(2) + ' / $' + s.B.toFixed(2);
      case 'full': return (expense.split_value === 'A' ? nm.A : nm.B) + ' pays all';
      default: return '50/50';
    }
  }

  function expenseDelta(expense) {
    if (expense.status === 'disputed') return 0;
    var s = shares(expense);
    return expense.paid_by === 'A' ? s.B : -s.A;
  }
  function paymentDelta(p) {
    if (p.from_parent === 'B' && p.to_parent === 'A') return -(Number(p.amount) || 0);
    if (p.from_parent === 'A' && p.to_parent === 'B') return (Number(p.amount) || 0);
    return 0;
  }
  function adjustmentDelta(a) {
    if (a.favor === 'A') return (Number(a.amount) || 0);
    if (a.favor === 'B') return -(Number(a.amount) || 0);
    return 0;
  }

  function computeBalance(expenses, payments, adjustments) {
    var b = 0, i;
    for (i = 0; i < expenses.length; i++) b += expenseDelta(expenses[i]);
    for (i = 0; i < payments.length; i++) b += paymentDelta(payments[i]);
    if (adjustments) for (i = 0; i < adjustments.length; i++) b += adjustmentDelta(adjustments[i]);
    return round2(b);
  }

  function describeBalance(balance, names) {
    var b = round2(balance);
    if (b === 0) return { settled: true, amount: 0, debtor: null, creditor: null, text: 'All settled up' };
    if (b > 0) return { settled: false, amount: b, debtor: 'B', creditor: 'A', text: names.B + ' owes ' + names.A + ' $' + b.toFixed(2) };
    var amt = round2(-b);
    return { settled: false, amount: amt, debtor: 'A', creditor: 'B', text: names.A + ' owes ' + names.B + ' $' + amt.toFixed(2) };
  }

  // ----- Reporting helpers (approved expenses only) -----------------------
  function childKeyName(e) { return e.child_name || 'Shared'; }

  function summarizeByChild(expenses, names) {
    var out = {};
    for (var i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      if (e.status === 'disputed') continue;
      var key = childKeyName(e);
      var s = shares(e);
      if (!out[key]) out[key] = { name: key, total: 0, respA: 0, respB: 0, paidA: 0, paidB: 0, count: 0 };
      out[key].total += Number(e.amount) || 0;
      out[key].respA += s.A; out[key].respB += s.B;
      if (e.paid_by === 'A') out[key].paidA += Number(e.amount) || 0; else out[key].paidB += Number(e.amount) || 0;
      out[key].count++;
    }
    return Object.keys(out).map(function (k) {
      var r = out[k];
      return { name: r.name, total: round2(r.total), respA: round2(r.respA), respB: round2(r.respB), paidA: round2(r.paidA), paidB: round2(r.paidB), count: r.count };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  function summarizeByCategory(expenses) {
    var out = {};
    for (var i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      if (e.status === 'disputed') continue;
      var s = shares(e);
      if (!out[e.category]) out[e.category] = { name: e.category, total: 0, respA: 0, respB: 0, count: 0 };
      out[e.category].total += Number(e.amount) || 0;
      out[e.category].respA += s.A; out[e.category].respB += s.B;
      out[e.category].count++;
    }
    return Object.keys(out).map(function (k) {
      var r = out[k];
      return { name: r.name, total: round2(r.total), respA: round2(r.respA), respB: round2(r.respB), count: r.count };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  // ----- Billing statements (AR model) ------------------------------------
  /** Issue (1st of next month) and due (20th of next month) dates for a period. */
  function statementDates(period) {
    var nm = nextMonth(period);
    return { issue: nm + '-' + ISSUE_DAY, due: nm + '-' + DUE_DAY };
  }
  /**
   * Classify a statement from its net balance AFTER any carried-in credit
   * (`withCarry`, signed B-owes-A positive). Positive is still owed; a negative
   * balance is an overpayment/credit that carries to the next statement.
   * Returns { status, remaining, carry }.
   */
  function classifyStatement(withCarry, due, today) {
    if (Math.abs(withCarry) < 0.005) return { status: 'paid', remaining: 0, carry: 0 };
    if (withCarry > 0) return { status: (today && today > due) ? 'overdue' : 'open', remaining: round2(withCarry), carry: 0 };
    return { status: 'settled', remaining: 0, carry: round2(withCarry) }; // credit carries forward
  }
  /** Net charge (signed, B-owes-A positive) for a month's approved expenses. */
  function periodCharge(expenses, month) {
    var c = 0;
    for (var i = 0; i < expenses.length; i++) {
      var e = expenses[i];
      if (e.status !== 'disputed' && typeof e.date === 'string' && e.date.slice(0, 7) === month) c += expenseDelta(e);
    }
    return round2(c);
  }
  /** Net delta of payments + adjustments APPLIED (allocated) to a statement. */
  function appliedTo(payments, adjustments, month) {
    var d = 0, i;
    for (i = 0; i < payments.length; i++) if (payments[i].statement_period === month) d += paymentDelta(payments[i]);
    if (adjustments) for (i = 0; i < adjustments.length; i++) if (adjustments[i].statement_period === month) d += adjustmentDelta(adjustments[i]);
    return round2(d);
  }

  /**
   * Compute every statement in chronological order, carrying each overpayment
   * forward as a credit against the next statement (cascading). `extra` forces a
   * period to be included even if it has no activity yet.
   * Returns { chain (oldest->newest), final_carry }.
   */
  function statementChain(expenses, payments, adjustments, names, today, extra) {
    adjustments = adjustments || [];
    var periods = {}, i;
    for (i = 0; i < expenses.length; i++) { var e = expenses[i]; if (e.status !== 'disputed' && typeof e.date === 'string') periods[e.date.slice(0, 7)] = true; }
    for (i = 0; i < payments.length; i++) if (payments[i].statement_period) periods[payments[i].statement_period] = true;
    for (i = 0; i < adjustments.length; i++) if (adjustments[i].statement_period) periods[adjustments[i].statement_period] = true;
    if (extra) periods[extra] = true;

    var carry = 0;
    var chain = Object.keys(periods).sort().map(function (p) {
      var charge = periodCharge(expenses, p);
      var applied = appliedTo(payments, adjustments, p);
      var subtotal = round2(charge + applied);
      var carryIn = carry;
      var withCarry = round2(subtotal + carryIn);
      var d = statementDates(p);
      var cls = classifyStatement(withCarry, d.due, today);
      carry = cls.carry;
      return {
        period: p, label: monthName(p), issue: d.issue, due: d.due,
        charge: charge, charge_summary: describeBalance(charge, names),
        applied: applied, paid_amount: round2(Math.abs(applied)),
        carry_in: round2(carryIn), carried_forward: cls.carry,
        remaining: cls.remaining, remaining_summary: describeBalance(cls.remaining, names),
        amount_due: cls.remaining, status: cls.status,
      };
    });
    return { chain: chain, final_carry: round2(carry) };
  }

  /**
   * The billing ledger (newest first) with per-statement status, plus any
   * unapplied payments/credits, a standing credit balance (overpayment beyond the
   * newest statement), and the overall outstanding.
   */
  function statementLedger(expenses, payments, adjustments, names, today) {
    adjustments = adjustments || [];
    var res = statementChain(expenses, payments, adjustments, names, today);
    var statements = res.chain.slice().reverse();
    var unapplied = 0, i;
    for (i = 0; i < payments.length; i++) if (!payments[i].statement_period) unapplied += paymentDelta(payments[i]);
    for (i = 0; i < adjustments.length; i++) if (!adjustments[i].statement_period) unapplied += adjustmentDelta(adjustments[i]);
    unapplied = round2(unapplied);
    var totalOutstanding = round2(statements.reduce(function (t, s) { return t + s.remaining; }, 0) + res.final_carry + unapplied);
    return {
      statements: statements,
      unapplied: unapplied,
      credit_carry: res.final_carry,
      open_count: statements.filter(function (s) { return s.status === 'open'; }).length,
      overdue_count: statements.filter(function (s) { return s.status === 'overdue'; }).length,
      settled_count: statements.filter(function (s) { return s.status === 'settled'; }).length,
      total_outstanding: totalOutstanding,
      total_summary: describeBalance(totalOutstanding, names),
    };
  }

  /**
   * A single printable statement (invoice) for `month`: that month's charges,
   * the payments/adjustments applied to it, the amount due, and issue/due dates.
   */
  function buildStatement(month, expenses, payments, names, adjustments, today) {
    adjustments = adjustments || [];
    var inMonth = function (d) { return typeof d === 'string' && d.slice(0, 7) === month; };

    var monthAll = expenses.filter(function (e) { return inMonth(e.date); })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.id - b.id; });
    var monthExpenses = monthAll.filter(function (e) { return e.status !== 'disputed'; });
    var disputed = monthAll.filter(function (e) { return e.status === 'disputed'; });
    var appliedPayments = payments.filter(function (p) { return p.statement_period === month; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.id - b.id; });
    var appliedAdjustments = adjustments.filter(function (a) { return a.statement_period === month; })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.id - b.id; });

    var paidByA = 0, paidByB = 0, respA = 0, respB = 0;
    for (var i = 0; i < monthExpenses.length; i++) {
      var e = monthExpenses[i], s = shares(e);
      if (e.paid_by === 'A') paidByA += e.amount; else paidByB += e.amount;
      respA += s.A; respB += s.B;
    }

    var toLine = function (e) {
      var s = shares(e);
      return {
        id: e.id, date: e.date, description: e.description, category: e.category,
        child: childKeyName(e), amount: round2(e.amount), paid_by: e.paid_by,
        paid_by_name: e.paid_by === 'A' ? names.A : names.B,
        share_a: s.A, share_b: s.B, split_label: splitLabel(e, names),
        owed_amount: round2(e.paid_by === 'A' ? s.B : s.A), has_receipt: !!e.receipt,
        tax: !!e.tax_deductible, notes: e.notes || null,
      };
    };

    var charge = round2(monthExpenses.reduce(function (t, x) { return t + expenseDelta(x); }, 0));
    var netPayments = round2(appliedPayments.reduce(function (t, x) { return t + paymentDelta(x); }, 0));
    var netAdjustments = round2(appliedAdjustments.reduce(function (t, x) { return t + adjustmentDelta(x); }, 0));
    var d = statementDates(month);

    // Fold in any credit carried from a prior overpayment (and any overpayment
    // this statement carries onward) via the cascading chain.
    var chain = statementChain(expenses, payments, adjustments, names, today, month).chain;
    var entry = null;
    for (var ci = 0; ci < chain.length; ci++) if (chain[ci].period === month) { entry = chain[ci]; break; }
    var carryIn = entry ? entry.carry_in : 0;
    var carriedForward = entry ? entry.carried_forward : 0;
    var amountDue = entry ? entry.remaining : round2(charge + netPayments + netAdjustments + carryIn);
    var status = entry ? entry.status : classifyStatement(round2(charge + netPayments + netAdjustments + carryIn), d.due, today).status;

    return {
      month: month, names: names,
      issue: d.issue, due: d.due,
      status: status,
      carry_in: round2(carryIn), carried_forward: round2(carriedForward),
      totals: {
        total_spent: round2(paidByA + paidByB),
        paid_by_a: round2(paidByA), paid_by_b: round2(paidByB),
        responsibility_a: round2(respA), responsibility_b: round2(respB),
        expense_count: monthExpenses.length,
        disputed_count: disputed.length,
        disputed_total: round2(disputed.reduce(function (t, x) { return t + (Number(x.amount) || 0); }, 0)),
      },
      line_items: monthExpenses.map(toLine),
      disputed_items: disputed.map(toLine),
      payments: appliedPayments.map(function (p) {
        return { id: p.id, date: p.date, from_name: p.from_parent === 'A' ? names.A : names.B, to_name: p.to_parent === 'A' ? names.A : names.B, amount: round2(p.amount), method: p.method || null, notes: p.notes || null };
      }),
      adjustments: appliedAdjustments.map(function (a) {
        return { id: a.id, date: a.date, label: a.label || 'Adjustment', amount: round2(a.amount), favor: a.favor, favor_name: a.favor === 'A' ? names.A : names.B, notes: a.notes || null };
      }),
      by_child: summarizeByChild(monthExpenses, names),
      by_category: summarizeByCategory(monthExpenses),
      charge: charge, charge_summary: describeBalance(charge, names),
      net_from_payments: netPayments, net_from_adjustments: netAdjustments,
      amount_due: amountDue, due_summary: describeBalance(amountDue, names),
    };
  }

  var Finance = {
    round2: round2, clamp: clamp, monthName: monthName, nextMonth: nextMonth,
    shares: shares, splitLabel: splitLabel,
    expenseDelta: expenseDelta, paymentDelta: paymentDelta, adjustmentDelta: adjustmentDelta,
    computeBalance: computeBalance, describeBalance: describeBalance,
    summarizeByChild: summarizeByChild, summarizeByCategory: summarizeByCategory,
    statementDates: statementDates, classifyStatement: classifyStatement,
    statementChain: statementChain, statementLedger: statementLedger,
    buildStatement: buildStatement,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Finance;
  else global.Finance = Finance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
