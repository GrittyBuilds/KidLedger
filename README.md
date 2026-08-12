# 🧾 KidLedger

A simple, self-hosted expense tracker for co-parents who split their children's
expenses **50/50**. Log every expense, record settlement payments, watch the
running balance, and generate a **printable monthly billing statement** for
whichever parent owes the other at month's end.

## Features

- **Track shared expenses** — date, description, category, amount, which parent
  paid, and (optionally) which child it was for. Every expense is split evenly.
- **Running balance** — always know who owes whom and how much, factoring in all
  expenses and past settlement payments.
- **Settlement payments** — record when one parent pays the other to square up.
  Overpayments correctly flip the balance the other way.
- **Monthly billing statement** — pick a month and generate an itemized
  statement that carries the prior balance forward, lists the month's expenses
  and payments, and shows the amount due. Print it or save it as a PDF straight
  from the browser.
- **Outstanding balances carried forward** — statements always reconcile against
  the balance brought forward from prior months.
- **Configurable** — set both parents' real names and add your children.

## How the math works

The balance is tracked as a single signed number: the net amount **Parent B owes
Parent A**.

- Each expense is split 50/50. Whoever paid covered the other parent's half, so
  the other parent owes them 50% of that expense.
- A settlement payment from the debtor to the creditor moves the balance back
  toward zero. Paying more than owed flips who owes whom.
- A monthly statement computes the **opening balance** from everything before the
  month, applies that month's expenses and payments, and reports the **closing
  balance**.

## Getting started

Requires Node.js 18+ (developed on Node 22).

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

To use a different port or database location:

```bash
PORT=8080 KIDLEDGER_DB=/path/to/kidledger.db npm start
```

## Running the tests

The money math lives in `finance.js` and is covered by unit tests:

```bash
npm test
```

## Project layout

| File / dir              | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `server.js`             | Express server and REST API                                    |
| `db.js`                 | SQLite schema and connection (better-sqlite3)                  |
| `finance.js`            | Pure balance & statement math (unit-tested)                    |
| `public/`               | Frontend single-page app (HTML, CSS, vanilla JS)               |
| `test/finance.test.js`  | Unit tests for the finance logic                               |
| `data/kidledger.db`     | SQLite database file (created on first run, git-ignored)       |

## API reference

| Method & path                | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `GET /api/settings`          | Get parent names                             |
| `PUT /api/settings`          | Update parent names                          |
| `GET/POST /api/children`     | List / add children                          |
| `DELETE /api/children/:id`   | Remove a child                               |
| `GET/POST /api/expenses`     | List / add expenses                          |
| `PUT/DELETE /api/expenses/:id` | Edit / delete an expense                   |
| `GET/POST /api/payments`     | List / record settlement payments            |
| `DELETE /api/payments/:id`   | Delete a payment                             |
| `GET /api/balance`           | Current net balance and summary              |
| `GET /api/statement?month=YYYY-MM` | Monthly billing statement              |
| `GET /api/months`            | Months that have activity                    |

## Notes

Data is stored locally in a SQLite file under `data/`. Because two co-parents
typically use different devices, run KidLedger on a shared host (a small VPS,
home server, or similar) so both parents point at the same instance. Keep the
`data/` directory backed up — it holds your full expense history.

## License

MIT
