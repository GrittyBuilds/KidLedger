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
  paid, and (optionally) which child it was for. Every expense is split evenly.
- **Running balance** — always know who owes whom, factoring in all expenses and
  past settlement payments.
- **Settlement payments** — record when one parent pays the other to square up.
  Overpayments correctly flip the balance the other way.
- **Monthly billing statement** — pick a month and generate an itemized
  statement that carries the prior balance forward, lists the month's expenses
  and payments, and shows the amount due. Print it or save it as a PDF straight
  from the browser.
- **Outstanding balances carried forward** — statements always reconcile against
  the balance brought forward from prior months.
- **Backup & restore** — export your whole ledger to a `.json` file and import it
  later (or on another device). Import merges IDs safely so nothing collides.
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
