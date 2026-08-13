# 🧾 KidLedger

A single-user, **browser-only** expense tracker for co-parents who split their
children's expenses **50/50**. One person keeps the ledger: log every expense,
record settlement payments, watch the running balance, and generate a
**printable monthly billing statement** for whichever parent owes the other.

No server, no database, no accounts. Everything runs in a single HTML file and
saves to your browser's `localStorage`.

## Use it

Just open **`index.html`** in any modern browser (double-click it, or drag it
into a browser tab). That's it — nothing to install or run.

> Keep `finance.js` in the same folder as `index.html`; the page loads it for
> the money math.

## Features

- **Track shared expenses** — date, description, category, amount, which parent
  paid, and (optionally) which child it was for.
- **Flexible splits** — split each expense evenly (50/50), by a custom
  **percentage**, by a fixed **dollar amount**, or **100% to one parent**. Quick-add
  uses 50/50; the full editor exposes every option with a live preview.
- **Receipt attachments** — attach a photo or PDF to any expense as proof. Images
  are automatically downscaled to keep storage small; view receipts in-app.
- **Dispute / approve status** — flag a contested charge as *disputed* and it's
  excluded from the balance and statements until you approve it.
- **Running balance** — always know who owes whom, factoring in all expenses and
  past settlement payments.
- **Settlement payments** — record when one parent pays the other to square up.
  Overpayments correctly flip the balance the other way.
- **Search, filters & breakdowns** — filter expenses by month, category, child,
  who paid, and status; search descriptions/notes; see totals by category and by
  child. Export the filtered set to **CSV**.
- **Monthly billing statement** — pick a month and generate an itemized
  statement that carries the prior balance forward, lists the month's expenses
  (with each split shown) and payments, notes any excluded disputed items, and
  shows the amount due. Print it or save it as a PDF from the browser.
- **Finalize (lock) a month** — once a month is settled, finalize it to make its
  expenses and payments read-only — an immutable record until you unlock it.
- **Recurring expenses** — set up monthly costs (daycare, tuition) once, and
  KidLedger adds each month's entry automatically when you open the app. Pause,
  resume, or delete templates; deleting keeps entries already created.
- **Spending charts** — a Reports tab with a monthly-spending trend and a
  by-category breakdown.
- **Tax-relevant summary** — flag medical/childcare expenses as tax-relevant and
  get a per-year summary (with each parent's responsibility share) for FSA claims
  or tax time. Export it to CSV.
- **Backup & restore** — export your whole ledger to a `.json` file and import it
  later (or on another device). Import merges IDs safely so nothing collides.
- **Configurable** — set both parents' real names and add your children.

## How the math works

The balance is tracked as a single signed number: the net amount **Parent B owes
Parent A**.

- Each expense is divided into a **responsibility share** for each parent (the two
  shares always sum to the total): 50/50 by default, or a custom percentage, a
  fixed dollar amount, or 100% to one parent. Whoever paid covered the other
  parent's share, so the other parent owes them **that** amount.
- **Disputed** expenses contribute nothing to the balance until approved.
- A settlement payment from the debtor to the creditor moves the balance back
  toward zero. Paying more than owed flips who owes whom.
- A monthly statement computes the **opening balance** from everything before the
  month, applies that month's expenses and payments, and reports the **closing
  balance**.

## Where your data lives

All data is stored in your browser's `localStorage` under the key
`kidledger.v1` — it never leaves your device. That means:

- **It's private** — nothing is uploaded anywhere.
- **It's per-browser** — data saved in Chrome won't show up in Safari, and
  clearing your browsing data can erase it.

Because of that, **export a backup regularly** (Settings → Export backup). To
move your ledger to another computer or browser, export on one and import on the
other.

## Project layout

| File                   | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `index.html`           | The entire app — UI, styles, and logic (uses localStorage)  |
| `finance.js`           | Pure balance & statement math, shared with the tests        |
| `test/finance.test.js` | Unit tests for the finance logic (run with Node)            |

## Running the tests

The money math lives in `finance.js` and is covered by unit tests using Node's
built-in test runner (no dependencies to install):

```bash
npm test
```

## License

MIT
