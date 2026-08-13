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
 * them THAT parent's share.
 *   - Expense paid by A:  B owes A  share_B  -> balance += share_B
 *   - Expense paid by B:  A owes B  share_A  -> balance -= share_A
 *
 * Split types: even | percent(A%) | amount($ to A) | full('A'|'B').
 * Disputed expenses contribute nothing until approved.
 *
 * Settlement payment: from B to A -> balance -= amount; from A to B -> += amount.
 * Adjustment / rollover: a manual entry crediting one parent.
 *   - favor 'A' (owed to A) -> balance += amount
 *   - favor 'B' (owed to B) -> balance -= amount
 */
(function (global) {
  'use strict';

  function round2(n) { return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100; }
  function clamp(n, lo, hi) { return Math.min(Math.max(n, lo), hi); }

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

  function buildStatement(month, expenses, payments, names, adjustments) {
    adjustments = adjustments || [];
    var inMonth = function (d) { return typeof d === 'string' && d.slice(0, 7) === month; };
    var before = function (d) { return typeof d === 'string' && d.slice(0, 7) < month; };

    var openingBalance = computeBalance(
      expenses.filter(function (e) { return before(e.date); }),
      payments.filter(function (p) { return before(p.date); }),
      adjustments.filter(function (a) { return before(a.date); })
    );

    var monthAll = expenses.filter(function (e) { return inMonth(e.date); })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.id - b.id; });
    var monthExpenses = monthAll.filter(function (e) { return e.status !== 'disputed'; });
    var disputed = monthAll.filter(function (e) { return e.status === 'disputed'; });
    var monthPayments = payments.filter(function (p) { return inMonth(p.date); })
      .sort(function (a, b) { return a.date.localeCompare(b.date) || a.id - b.id; });
    var monthAdjustments = adjustments.filter(function (a) { return inMonth(a.date); })
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

    return {
      month: month, names: names,
      opening: { balance: openingBalance, summary: describeBalance(openingBalance, names) },
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
      payments: monthPayments.map(function (p) {
        return {
          id: p.id, date: p.date, from_name: p.from_parent === 'A' ? names.A : names.B,
          to_name: p.to_parent === 'A' ? names.A : names.B, amount: round2(p.amount),
          method: p.method || null, child: p.child_name || 'Shared', notes: p.notes || null,
        };
      }),
      adjustments: monthAdjustments.map(function (a) {
        return {
          id: a.id, date: a.date, label: a.label || 'Adjustment', amount: round2(a.amount),
          favor: a.favor, favor_name: a.favor === 'A' ? names.A : names.B,
          child: a.child_name || 'Shared', notes: a.notes || null,
        };
      }),
      by_child: summarizeByChild(monthExpenses, names),
      by_category: summarizeByCategory(monthExpenses),
      net_from_expenses: round2(monthExpenses.reduce(function (t, x) { return t + expenseDelta(x); }, 0)),
      net_from_payments: round2(monthPayments.reduce(function (t, x) { return t + paymentDelta(x); }, 0)),
      net_from_adjustments: round2(monthAdjustments.reduce(function (t, x) { return t + adjustmentDelta(x); }, 0)),
      closing: (function () {
        var c = round2(openingBalance +
          monthExpenses.reduce(function (t, x) { return t + expenseDelta(x); }, 0) +
          monthPayments.reduce(function (t, x) { return t + paymentDelta(x); }, 0) +
          monthAdjustments.reduce(function (t, x) { return t + adjustmentDelta(x); }, 0));
        return { balance: c, summary: describeBalance(c, names) };
      })(),
    };
  }

  var Finance = {
    round2: round2, clamp: clamp, shares: shares, splitLabel: splitLabel,
    expenseDelta: expenseDelta, paymentDelta: paymentDelta, adjustmentDelta: adjustmentDelta,
    computeBalance: computeBalance, describeBalance: describeBalance,
    summarizeByChild: summarizeByChild, summarizeByCategory: summarizeByCategory,
    buildStatement: buildStatement,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Finance;
  else global.Finance = Finance;
})(typeof globalThis !== 'undefined' ? globalThis : this);
