'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');
const finance = require('./finance');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getParentNames() {
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('parent_a_name', 'parent_b_name')")
    .all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { A: map.parent_a_name || 'Parent A', B: map.parent_b_name || 'Parent B' };
}

function allExpenses() {
  return db
    .prepare(
      `SELECT e.*, c.name AS child_name
         FROM expenses e
         LEFT JOIN children c ON c.id = e.child_id
        ORDER BY e.date DESC, e.id DESC`
    )
    .all();
}

function allPayments() {
  return db.prepare('SELECT * FROM payments ORDER BY date DESC, id DESC').all();
}

const VALID_PARENT = (p) => p === 'A' || p === 'B';

// Wrap sync route handlers so thrown errors become 500s instead of crashes.
function wrap(handler) {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  };
}

// ---------------------------------------------------------------------------
// Settings (parent names)
// ---------------------------------------------------------------------------

app.get('/api/settings', wrap((req, res) => {
  res.json({ parents: getParentNames() });
}));

app.put('/api/settings', wrap((req, res) => {
  const { parent_a_name, parent_b_name } = req.body || {};
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  if (typeof parent_a_name === 'string' && parent_a_name.trim()) {
    upsert.run('parent_a_name', parent_a_name.trim());
  }
  if (typeof parent_b_name === 'string' && parent_b_name.trim()) {
    upsert.run('parent_b_name', parent_b_name.trim());
  }
  res.json({ parents: getParentNames() });
}));

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

app.get('/api/children', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM children ORDER BY name').all());
}));

app.post('/api/children', wrap((req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare('INSERT INTO children (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM children WHERE id = ?').get(info.lastInsertRowid));
}));

app.delete('/api/children/:id', wrap((req, res) => {
  db.prepare('DELETE FROM children WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

function validateExpense(body) {
  const errors = [];
  const date = (body.date || '').trim();
  const description = (body.description || '').trim();
  const amount = Number(body.amount);
  const paid_by = body.paid_by;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date must be YYYY-MM-DD');
  if (!description) errors.push('description is required');
  if (!Number.isFinite(amount) || amount <= 0) errors.push('amount must be a positive number');
  if (!VALID_PARENT(paid_by)) errors.push("paid_by must be 'A' or 'B'");
  return { errors, value: { date, description, amount, paid_by } };
}

app.get('/api/expenses', wrap((req, res) => {
  res.json(allExpenses());
}));

app.post('/api/expenses', wrap((req, res) => {
  const body = req.body || {};
  const { errors, value } = validateExpense(body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const info = db
    .prepare(
      `INSERT INTO expenses (date, description, category, amount, paid_by, child_id, notes)
       VALUES (@date, @description, @category, @amount, @paid_by, @child_id, @notes)`
    )
    .run({
      ...value,
      category: (body.category || 'Other').trim() || 'Other',
      child_id: body.child_id ? Number(body.child_id) : null,
      notes: (body.notes || '').trim() || null,
    });
  res.status(201).json(
    db.prepare(
      `SELECT e.*, c.name AS child_name FROM expenses e
         LEFT JOIN children c ON c.id = e.child_id WHERE e.id = ?`
    ).get(info.lastInsertRowid)
  );
}));

app.put('/api/expenses/:id', wrap((req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Expense not found' });

  const body = req.body || {};
  const { errors, value } = validateExpense(body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  db.prepare(
    `UPDATE expenses SET date=@date, description=@description, category=@category,
       amount=@amount, paid_by=@paid_by, child_id=@child_id, notes=@notes WHERE id=@id`
  ).run({
    ...value,
    category: (body.category || 'Other').trim() || 'Other',
    child_id: body.child_id ? Number(body.child_id) : null,
    notes: (body.notes || '').trim() || null,
    id: Number(req.params.id),
  });
  res.json(
    db.prepare(
      `SELECT e.*, c.name AS child_name FROM expenses e
         LEFT JOIN children c ON c.id = e.child_id WHERE e.id = ?`
    ).get(req.params.id)
  );
}));

app.delete('/api/expenses/:id', wrap((req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Payments (settlements between parents)
// ---------------------------------------------------------------------------

app.get('/api/payments', wrap((req, res) => {
  res.json(allPayments());
}));

app.post('/api/payments', wrap((req, res) => {
  const body = req.body || {};
  const date = (body.date || '').trim();
  const amount = Number(body.amount);
  const from_parent = body.from_parent;
  const to_parent = body.to_parent;

  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date must be YYYY-MM-DD');
  if (!Number.isFinite(amount) || amount <= 0) errors.push('amount must be a positive number');
  if (!VALID_PARENT(from_parent)) errors.push("from_parent must be 'A' or 'B'");
  if (!VALID_PARENT(to_parent)) errors.push("to_parent must be 'A' or 'B'");
  if (from_parent === to_parent) errors.push('from_parent and to_parent must differ');
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const info = db
    .prepare(
      `INSERT INTO payments (date, from_parent, to_parent, amount, method, notes)
       VALUES (@date, @from_parent, @to_parent, @amount, @method, @notes)`
    )
    .run({
      date,
      from_parent,
      to_parent,
      amount,
      method: (body.method || '').trim() || null,
      notes: (body.notes || '').trim() || null,
    });
  res.status(201).json(db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid));
}));

app.delete('/api/payments/:id', wrap((req, res) => {
  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Balance + statements
// ---------------------------------------------------------------------------

app.get('/api/balance', wrap((req, res) => {
  const names = getParentNames();
  const balance = finance.computeBalance(allExpenses(), allPayments());
  res.json({ balance, summary: finance.describeBalance(balance, names), names });
}));

app.get('/api/statement', wrap((req, res) => {
  const month = (req.query.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month query param must be YYYY-MM' });
  }
  const names = getParentNames();
  const statement = finance.buildStatement(month, allExpenses(), allPayments(), names);
  res.json(statement);
}));

// List of months that have any activity, newest first (for the statement picker).
app.get('/api/months', wrap((req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT substr(date, 1, 7) AS month FROM (
         SELECT date FROM expenses UNION ALL SELECT date FROM payments
       ) ORDER BY month DESC`
    )
    .all();
  res.json(rows.map((r) => r.month).filter(Boolean));
}));

// Fallback to the SPA for any non-API route.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`KidLedger running at http://localhost:${PORT}`);
  });
}

module.exports = app;
