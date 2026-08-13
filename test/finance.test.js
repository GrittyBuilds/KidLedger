'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const finance = require('../finance');

const names = { A: 'Alex', B: 'Blake' };

test('single expense: payer is owed half', () => {
  const expenses = [{ date: '2026-01-05', amount: 100, paid_by: 'A' }];
  const balance = finance.computeBalance(expenses, []);
  assert.equal(balance, 50); // B owes A 50
  const d = finance.describeBalance(balance, names);
  assert.equal(d.debtor, 'B');
  assert.equal(d.creditor, 'A');
  assert.equal(d.amount, 50);
});

test('expenses by both parents net out', () => {
  const expenses = [
    { date: '2026-01-01', amount: 100, paid_by: 'A' }, // +50
    { date: '2026-01-02', amount: 60, paid_by: 'B' },  // -30
  ];
  assert.equal(finance.computeBalance(expenses, []), 20); // B owes A 20
});

test('equal spending settles to zero', () => {
  const expenses = [
    { date: '2026-01-01', amount: 80, paid_by: 'A' },
    { date: '2026-01-02', amount: 80, paid_by: 'B' },
  ];
  assert.equal(finance.computeBalance(expenses, []), 0);
  assert.equal(finance.describeBalance(0, names).settled, true);
});

test('settlement payment reduces the balance', () => {
  const expenses = [{ date: '2026-01-05', amount: 200, paid_by: 'A' }]; // B owes A 100
  const payments = [{ date: '2026-01-20', from_parent: 'B', to_parent: 'A', amount: 100 }];
  assert.equal(finance.computeBalance(expenses, payments), 0);
});

test('overpayment flips who owes whom', () => {
  const expenses = [{ date: '2026-01-05', amount: 100, paid_by: 'A' }]; // B owes A 50
  const payments = [{ date: '2026-01-20', from_parent: 'B', to_parent: 'A', amount: 80 }];
  const balance = finance.computeBalance(expenses, payments);
  assert.equal(balance, -30); // A now owes B 30
  assert.equal(finance.describeBalance(balance, names).debtor, 'A');
});

test('even split of odd cents sums exactly to the total', () => {
  const s = finance.shares({ amount: 33.33, split_type: 'even' });
  assert.equal(s.A, 16.67);
  assert.equal(s.B, 16.66);
  assert.equal(finance.round2(s.A + s.B), 33.33);
});

// --- Custom splits ---------------------------------------------------------

test('percent split: A responsible for 70%', () => {
  const e = { date: '2026-02-01', amount: 100, paid_by: 'A', split_type: 'percent', split_value: 70 };
  const s = finance.shares(e);
  assert.equal(s.A, 70);
  assert.equal(s.B, 30);
  // A paid, so B owes A B's share (30).
  assert.equal(finance.computeBalance([e], []), 30);
});

test('dollar-amount split: A responsible for $30 of $100', () => {
  const e = { date: '2026-02-02', amount: 100, paid_by: 'B', split_type: 'amount', split_value: 30 };
  const s = finance.shares(e);
  assert.equal(s.A, 30);
  assert.equal(s.B, 70);
  // B paid, so A owes B A's share (30) -> balance -30.
  assert.equal(finance.computeBalance([e], []), -30);
});

test('full split: one parent responsible for 100%', () => {
  const e = { date: '2026-02-03', amount: 120, paid_by: 'A', split_type: 'full', split_value: 'B' };
  const s = finance.shares(e);
  assert.equal(s.A, 0);
  assert.equal(s.B, 120);
  // A paid but B owes all of it.
  assert.equal(finance.computeBalance([e], []), 120);
});

test('dollar-amount split is clamped to the expense total', () => {
  const s = finance.shares({ amount: 50, split_type: 'amount', split_value: 999 });
  assert.equal(s.A, 50);
  assert.equal(s.B, 0);
});

test('splitLabel renders each split type', () => {
  assert.equal(finance.splitLabel({ amount: 100, split_type: 'even' }, names), '50/50');
  assert.equal(finance.splitLabel({ amount: 100, split_type: 'percent', split_value: 70 }, names), '70/30');
  assert.equal(finance.splitLabel({ amount: 100, split_type: 'amount', split_value: 30 }, names), '$30.00 / $70.00');
  assert.equal(finance.splitLabel({ amount: 100, split_type: 'full', split_value: 'A' }, names), 'Alex pays all');
});

// --- Disputed items --------------------------------------------------------

test('disputed expenses are excluded from the balance', () => {
  const expenses = [
    { date: '2026-03-01', amount: 100, paid_by: 'A' },                       // +50
    { date: '2026-03-02', amount: 400, paid_by: 'A', status: 'disputed' },   // excluded
  ];
  assert.equal(finance.computeBalance(expenses, []), 50);
});

// --- Statement -------------------------------------------------------------

test('monthly statement carries prior balance forward', () => {
  const expenses = [
    { id: 1, date: '2026-01-10', amount: 100, paid_by: 'A', description: 'Jan', category: 'Other' },
    { id: 2, date: '2026-02-14', amount: 50, paid_by: 'B', description: 'Feb', category: 'Other' },
  ];
  const stmt = finance.buildStatement('2026-02', expenses, [], names);
  assert.equal(stmt.opening.balance, 50);
  assert.equal(stmt.totals.total_spent, 50);
  assert.equal(stmt.net_from_expenses, -25);
  assert.equal(stmt.closing.balance, 25);
  assert.equal(stmt.closing.summary.debtor, 'B');
  assert.equal(stmt.line_items.length, 1);
});

test('statement includes settlement payments in the month', () => {
  const expenses = [{ id: 1, date: '2026-03-01', amount: 300, paid_by: 'A', description: 'x', category: 'Other' }];
  const payments = [{ id: 1, date: '2026-03-15', from_parent: 'B', to_parent: 'A', amount: 150 }];
  const stmt = finance.buildStatement('2026-03', expenses, payments, names);
  assert.equal(stmt.opening.balance, 0);
  assert.equal(stmt.net_from_expenses, 150);
  assert.equal(stmt.net_from_payments, -150);
  assert.equal(stmt.closing.balance, 0);
  assert.equal(stmt.closing.summary.settled, true);
});

test('statement separates disputed items and excludes them from totals', () => {
  const expenses = [
    { id: 1, date: '2026-04-01', amount: 100, paid_by: 'A', description: 'ok', category: 'Other' },
    { id: 2, date: '2026-04-02', amount: 500, paid_by: 'A', description: 'contested', category: 'Other', status: 'disputed' },
  ];
  const stmt = finance.buildStatement('2026-04', expenses, [], names);
  assert.equal(stmt.line_items.length, 1);
  assert.equal(stmt.disputed_items.length, 1);
  assert.equal(stmt.totals.total_spent, 100);        // disputed not counted
  assert.equal(stmt.totals.disputed_total, 500);
  assert.equal(stmt.closing.balance, 50);            // only the $100 counts
});

test('statement reports per-parent responsibility with a custom split', () => {
  const expenses = [
    { id: 1, date: '2026-05-01', amount: 200, paid_by: 'A', description: 'daycare', category: 'Childcare', split_type: 'percent', split_value: 75 },
  ];
  const stmt = finance.buildStatement('2026-05', expenses, [], names);
  assert.equal(stmt.totals.responsibility_a, 150);
  assert.equal(stmt.totals.responsibility_b, 50);
  assert.equal(stmt.line_items[0].owed_amount, 50); // A paid; B owes B's 50 share
});

test('empty month produces a clean zero statement', () => {
  const stmt = finance.buildStatement('2026-07', [], [], names);
  assert.equal(stmt.totals.total_spent, 0);
  assert.equal(stmt.closing.balance, 0);
  assert.equal(stmt.line_items.length, 0);
});

// --- Adjustments / rollover ------------------------------------------------

test('adjustment in favor of A increases what B owes A', () => {
  const adj = [{ date: '2026-01-01', favor: 'A', amount: 100 }];
  assert.equal(finance.computeBalance([], [], adj), 100);
});

test('adjustment in favor of B moves the balance the other way', () => {
  const adj = [{ date: '2026-01-01', favor: 'B', amount: 40 }];
  assert.equal(finance.computeBalance([], [], adj), -40);
});

test('rollover opening balance flows into the statement', () => {
  const adj = [{ id: 1, date: '2025-12-31', favor: 'A', amount: 200, label: 'Opening balance' }];
  const stmt = finance.buildStatement('2026-01', [], [], names, adj);
  assert.equal(stmt.opening.balance, 200);          // prior rollover carried forward
  assert.equal(stmt.closing.balance, 200);
});

test('adjustment within the month appears and affects closing', () => {
  const adj = [{ id: 1, date: '2026-03-10', favor: 'B', amount: 50, label: 'Credit' }];
  const stmt = finance.buildStatement('2026-03', [], [], names, adj);
  assert.equal(stmt.adjustments.length, 1);
  assert.equal(stmt.net_from_adjustments, -50);
  assert.equal(stmt.closing.balance, -50);
});

// --- Reporting -------------------------------------------------------------

test('summarizeByChild groups by child and splits responsibility', () => {
  const expenses = [
    { child_name: 'Sam', amount: 100, paid_by: 'A', category: 'Medical' },
    { child_name: 'Sam', amount: 50, paid_by: 'B', category: 'Food' },
    { child_name: null, amount: 80, paid_by: 'A', category: 'Other' }, // Shared
  ];
  const rows = finance.summarizeByChild(expenses, names);
  const sam = rows.find((r) => r.name === 'Sam');
  const shared = rows.find((r) => r.name === 'Shared');
  assert.equal(sam.total, 150);
  assert.equal(sam.respA, 75);
  assert.equal(sam.respB, 75);
  assert.equal(shared.total, 80);
  assert.equal(shared.respA, 40);
});

test('summarizeByCategory groups and sorts by total', () => {
  const expenses = [
    { category: 'Medical', amount: 300, paid_by: 'A' },
    { category: 'Food', amount: 100, paid_by: 'B' },
    { category: 'Medical', amount: 100, paid_by: 'A' },
  ];
  const rows = finance.summarizeByCategory(expenses);
  assert.equal(rows[0].name, 'Medical');
  assert.equal(rows[0].total, 400);
  assert.equal(rows[1].name, 'Food');
});

test('disputed expenses are excluded from reports', () => {
  const expenses = [
    { child_name: 'Sam', amount: 100, paid_by: 'A', category: 'Medical' },
    { child_name: 'Sam', amount: 999, paid_by: 'A', category: 'Medical', status: 'disputed' },
  ];
  assert.equal(finance.summarizeByChild(expenses, names)[0].total, 100);
  assert.equal(finance.summarizeByCategory(expenses)[0].total, 100);
});
