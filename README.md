# 🧾 KidLedger

A **browser-only, installable** expense tracker for co-parents who split their
children's expenses. Log every expense, record settlement payments, watch the
running balance, and generate a **printable monthly billing statement** for
whichever parent owes the other.

Runs as an installable app (PWA) on **desktop, iPhone, and Android** from one
codebase, works **offline**, and can **sync across your devices through your own
Google Drive**. No server, no accounts, no data sent to anyone but your Drive.

## Two ways to run it

**1. Quick / local:** open **`index.html`** in any browser (keep `finance.js` and
`sync.js` in the same folder). Everything works except cross-device sync and
install-to-home-screen, which need a hosted `https://` address.

**2. Installed app with cloud sync (recommended):** host the folder as a static
site (see **Deploying** below), then open that URL on each device and choose
"Install"/"Add to Home Screen". Connect Google Drive once per device and your
data follows you.

## Installing on your devices (once it's hosted)

- **Desktop (Chrome/Edge):** click the install icon in the address bar.
- **Android (Chrome):** menu → *Install app* / *Add to Home screen*.
- **iPhone/iPad (Safari):** Share → *Add to Home Screen*.

It then opens full-screen like a native app and works offline.

## Deploying (free, via GitHub Pages)

This repo includes a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`)
that publishes the app automatically:

1. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main` (or run the workflow manually). Your app goes live at
   `https://<your-user>.github.io/<repo>/`.

Any static host works too (Netlify, Cloudflare Pages, Vercel) — just serve the
files at the repo root.

## Syncing across devices with Google Drive

KidLedger stores one private file, `kidledger.json`, in your Google Drive using
the `drive.file` scope — meaning **the app can only ever see the file it
created**, never the rest of your Drive. Auth is entirely client-side; there is
no server and no stored secret.

**One-time setup (get a free Google Client ID):**

1. Open <https://console.cloud.google.com> and create a project.
2. **APIs & Services → Enable APIs** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → **External**; add your app name,
   your email, and yourself as a **Test user**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   **Web application**.
5. Under **Authorized JavaScript origins**, add your hosted address
   (e.g. `https://<your-user>.github.io`).
6. Copy the **Client ID**, open KidLedger → **Settings → Sync**, paste it, and
   click **Connect Google Drive**.

Then on any other device, install the app, paste the same Client ID, and connect —
it finds your `kidledger.json` and syncs.

**How sync behaves:** it pulls the latest when you open the app and pushes shortly
after each change. If the same data changed on two devices since the last sync, it
asks which version to keep (and keeps a backup of the replaced side in the
browser). The same Client ID and Google account are used on every device.

## Features

- **Track shared expenses** — date, description, category, amount, which parent
  paid, and (optionally) which child it was for.
- **Child or shared assignment** — every expense is assigned to a specific child
  or marked **Shared** (never left blank).
- **Flexible splits** — split each expense evenly (50/50), by a custom
  **percentage**, by a fixed **dollar amount**, or **100% to one parent**. Quick-add
  uses 50/50; the full editor exposes every option with a live preview.
- **Editable categories** — add or remove expense categories in Settings.
- **Monthly billing cycle** — each month's expenses become a **statement**,
  issued on the **1st** of the next month and **due on the 20th**. A billing
  overview lists every statement with its charges, payments, outstanding, due
  date, and status (**Open / Overdue / Paid**).
- **Payments & rollover applied to statements** — record settlement payments and
  manual **adjustments / rollover** (opening balances, agreed credits,
  corrections) and **apply each to a specific open statement** (or leave it
  unapplied). This drives the Open/Paid/Overdue status per statement.
- **Credits applied oldest-first** — any credit (an overpaid statement, a month
  that nets in the other parent's favor, or an unapplied payment) is automatically
  applied to the **oldest outstanding statement first**, so a credit never
  produces a reverse "the other parent owes you" bill while a balance is owed.
  The credited statement is marked **Settled**; leftover credit becomes a standing
  **credit balance**.
- **Running balance on every statement** — each printable statement shows the
  overall **account balance** and a full **breakdown of how it's calculated**
  (total charges − payments ± adjustments), plus an **aging table** of all
  statements so the numbers are fully transparent.
- **Receipt attachments** — attach a photo or PDF to any expense as proof. Images
  are automatically downscaled to keep storage small; view receipts in-app.
- **Dispute / approve status** — flag a contested charge as *disputed* and it's
  excluded from the balance and statements until you approve it.
- **Per-child & per-category reporting** — Reports tab breaks spending down by
  child and by category (with each parent's responsibility share) over a chosen
  range, exportable to CSV.
- **Professional billing statement** — a clean, invoice-style monthly statement
  with summary tiles, itemized expenses, payments/adjustments, a by-child and
  by-category breakdown, reconciliation, and a clear amount due.
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
- **Installable & offline** — install to your home screen / desktop and keep
  using it with no connection.
- **Google Drive sync** — keep phone and desktop in sync through a private file
  in your own Drive.
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

Each device keeps its own copy in the browser's `localStorage` under the key
`kidledger.v1`. If you connect Google Drive, that copy is also mirrored to a
private `kidledger.json` in your Drive and synced between your devices.

- **It's private** — data goes only to your own Google Drive (or nowhere, if you
  don't connect sync).
- **Without sync it's per-browser** — data saved in Chrome won't show up in
  Safari, and clearing browsing data can erase it.

Either way you can **export a backup** anytime (Settings → Export backup).

## Project layout

| File                        | Purpose                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `index.html`                | The entire app — UI, styles, and logic                     |
| `finance.js`                | Pure balance & statement math, shared with the tests       |
| `sync.js`                   | Google Drive sync (pure decision logic + Drive API calls)  |
| `sw.js`                     | Service worker for offline use                             |
| `manifest.webmanifest`      | PWA manifest (installability)                              |
| `icons/`                    | App icons                                                  |
| `.github/workflows/`        | GitHub Pages deploy workflow                               |
| `test/*.test.js`            | Unit tests for the finance and sync logic (run with Node)  |

## Running the tests

The money math lives in `finance.js` and is covered by unit tests using Node's
built-in test runner (no dependencies to install):

```bash
npm test
```

## License

MIT
