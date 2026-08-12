'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.KIDLEDGER_DB || path.join(__dirname, 'data', 'kidledger.db');

// Ensure the data directory exists.
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS children (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,               -- YYYY-MM-DD
    description TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Other',
    amount      REAL NOT NULL,               -- total amount, split 50/50
    paid_by     TEXT NOT NULL,               -- 'A' or 'B' (which parent paid)
    child_id    INTEGER,                     -- optional
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,                -- YYYY-MM-DD
    from_parent TEXT NOT NULL,               -- 'A' or 'B'
    to_parent   TEXT NOT NULL,               -- 'A' or 'B'
    amount     REAL NOT NULL,
    method     TEXT,                         -- e.g. Venmo, check, cash
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
`);

// Seed default parent names on first run.
const seed = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
seed.run('parent_a_name', 'Parent A');
seed.run('parent_b_name', 'Parent B');

module.exports = db;
