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

test('rounding stays at cents', () => {
  const expenses = [{ date: '2026-01-05', amount: 33.33, paid_by: 'A' }];
  assert.equal(finance.computeBalance(expenses, []), 16.67);
});

test('monthly statement carries prior balance forward', () => {
  const expenses = [
    { id: 1, date: '2026-01-10', amount: 100, paid_by: 'A', description: 'Jan', category: 'Other' },
    { id: 2, date: '2026-02-14', amount: 50, paid_by: 'B', description: 'Feb', category: 'Other' },
  ];
  const stmt = finance.buildStatement('2026-02', expenses, [], names);
  assert.equal(stmt.opening.balance, 50);            // from January (B owes A 50)
  assert.equal(stmt.totals.total_spent, 50);         // February only
  assert.equal(stmt.net_from_expenses, -25);         // B paid in Feb -> -25
  assert.equal(stmt.closing.balance, 25);            // 50 - 25
  assert.equal(stmt.closing.summary.debtor, 'B');
  assert.equal(stmt.line_items.length, 1);
});

test('statement includes settlement payments in the month', () => {
  const expenses = [{ id: 1, date: '2026-03-01', amount: 300, paid_by: 'A', description: 'x', category: 'Other' }];
  const payments = [{ id: 1, date: '2026-03-15', from_parent: 'B', to_parent: 'A', amount: 150 }];
  const stmt = finance.buildStatement('2026-03', expenses, payments, names);
  assert.equal(stmt.opening.balance, 0);
  assert.equal(stmt.net_from_expenses, 150);   // B owes A 150
  assert.equal(stmt.net_from_payments, -150);  // paid off
  assert.equal(stmt.closing.balance, 0);
  assert.equal(stmt.closing.summary.settled, true);
});

test('empty month produces a clean zero statement', () => {
  const stmt = finance.buildStatement('2026-07', [], [], names);
  assert.equal(stmt.totals.total_spent, 0);
  assert.equal(stmt.closing.balance, 0);
  assert.equal(stmt.line_items.length, 0);
});
