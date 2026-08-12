'use strict';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CATEGORIES = [
  'Medical', 'Childcare', 'Education', 'Activities',
  'Clothing', 'Food', 'Travel', 'Other',
];

const api = {
  async get(url) { return handle(await fetch(url)); },
  async send(method, url, body) {
    return handle(await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
  },
};
async function handle(res) {
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function thisMonth() { return todayISO().slice(0, 7); }

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const state = {
  parents: { A: 'Parent A', B: 'Parent B' },
  children: [],
  expenses: [],
  payments: [],
};

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function showView(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'statement' && !$('#statementOutput').dataset.loaded) {
    $('#statementMonth').value = $('#statementMonth').value || thisMonth();
    loadStatement();
  }
}
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) { showView(nav.dataset.view); }
});

// ---------------------------------------------------------------------------
// Rendering: parent option helpers
// ---------------------------------------------------------------------------

function parentOptions(selected) {
  return `<option value="A"${selected === 'A' ? ' selected' : ''}>${esc(state.parents.A)}</option>` +
         `<option value="B"${selected === 'B' ? ' selected' : ''}>${esc(state.parents.B)}</option>`;
}
function categoryOptions(selected) {
  return CATEGORIES.map((c) => `<option${c === selected ? ' selected' : ''}>${c}</option>`).join('');
}
function childOptions(selected) {
  return `<option value="">— Any / shared —</option>` +
    state.children.map((c) => `<option value="${c.id}"${String(c.id) === String(selected) ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
}
function parentName(code) { return code === 'A' ? state.parents.A : state.parents.B; }

function refreshSelects() {
  $('#paidByQuick').innerHTML = parentOptions('A');
  $('#catQuick').innerHTML = categoryOptions('Other');
  $('#childQuick').innerHTML = childOptions('');
  $('#payFrom').innerHTML = parentOptions('B');
  $('#payTo').innerHTML = parentOptions('A');
  $('#catFull').innerHTML = categoryOptions('Other');
  $('#childFull').innerHTML = childOptions('');
  $('#paidByFull').innerHTML = parentOptions('A');
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadAll() {
  const [settings, children, expenses, payments] = await Promise.all([
    api.get('/api/settings'),
    api.get('/api/children'),
    api.get('/api/expenses'),
    api.get('/api/payments'),
  ]);
  state.parents = settings.parents;
  state.children = children;
  state.expenses = expenses;
  state.payments = payments;
  refreshSelects();
  renderSettings();
  renderChildren();
  renderExpenses();
  renderPayments();
  await renderDashboard();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

async function renderDashboard() {
  const bal = await api.get('/api/balance');
  const card = $('#balanceCard');
  const s = bal.summary;
  card.classList.toggle('settled', s.settled);
  $('#balanceText').textContent = s.settled ? "You're all settled up 🎉" : money(s.amount);
  $('#balanceSub').textContent = s.settled ? 'No outstanding balance.' : s.text;

  // Month glance
  const m = thisMonth();
  const monthExp = state.expenses.filter((e) => e.date.slice(0, 7) === m);
  const total = monthExp.reduce((sum, e) => sum + e.amount, 0);
  const byA = monthExp.filter((e) => e.paid_by === 'A').reduce((s2, e) => s2 + e.amount, 0);
  const byB = monthExp.filter((e) => e.paid_by === 'B').reduce((s2, e) => s2 + e.amount, 0);
  $('#monthGlance').innerHTML = `
    <div class="glance-row"><span>${monthLabel(m)} expenses</span><span class="g-val">${monthExp.length}</span></div>
    <div class="glance-row"><span>Total spent</span><span class="g-val">${money(total)}</span></div>
    <div class="glance-row"><span>Each parent's share</span><span class="g-val">${money(total / 2)}</span></div>
    <div class="glance-row"><span>${esc(state.parents.A)} paid</span><span class="g-val">${money(byA)}</span></div>
    <div class="glance-row"><span>${esc(state.parents.B)} paid</span><span class="g-val">${money(byB)}</span></div>`;

  // Recent activity: merge expenses + payments
  const items = [
    ...state.expenses.map((e) => ({ kind: 'expense', date: e.date, data: e })),
    ...state.payments.map((p) => ({ kind: 'payment', date: p.date, data: p })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  $('#recentList').innerHTML = items.length ? items.map((it) => {
    if (it.kind === 'expense') {
      const e = it.data;
      return `<div class="list-item">
        <span class="pill ${e.paid_by.toLowerCase()}">${esc(parentName(e.paid_by))} paid</span>
        <div class="li-main">
          <div class="li-title">${esc(e.description)}</div>
          <div class="li-sub">${fmtDate(e.date)} · ${esc(e.category)}${e.child_name ? ' · ' + esc(e.child_name) : ''}</div>
        </div>
        <div class="li-amount">${money(e.amount)}</div>
      </div>`;
    }
    const p = it.data;
    return `<div class="list-item">
      <span class="pill pay">Payment</span>
      <div class="li-main">
        <div class="li-title">${esc(parentName(p.from_parent))} → ${esc(parentName(p.to_parent))}</div>
        <div class="li-sub">${fmtDate(p.date)}${p.method ? ' · ' + esc(p.method) : ''}</div>
      </div>
      <div class="li-amount">${money(p.amount)}</div>
    </div>`;
  }).join('') : '<div class="empty">No activity yet. Add your first expense above.</div>';
}

// ---------------------------------------------------------------------------
// Expenses view
// ---------------------------------------------------------------------------

function renderExpenses() {
  const filter = $('#expenseMonthFilter').value;
  const rows = state.expenses.filter((e) => !filter || e.date.slice(0, 7) === filter);
  if (!rows.length) {
    $('#expenseTable').innerHTML = '<div class="empty">No expenses' + (filter ? ' for this month' : ' yet') + '.</div>';
    return;
  }
  $('#expenseTable').innerHTML = `
    <table>
      <thead><tr>
        <th>Date</th><th>Description</th><th>Category</th><th>Child</th>
        <th>Paid by</th><th class="num">Amount</th><th class="num">Each share</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map((e) => `<tr>
          <td>${fmtDate(e.date)}</td>
          <td>${esc(e.description)}${e.notes ? `<div class="li-sub">${esc(e.notes)}</div>` : ''}</td>
          <td>${esc(e.category)}</td>
          <td>${e.child_name ? esc(e.child_name) : '<span class="muted">—</span>'}</td>
          <td><span class="pill ${e.paid_by.toLowerCase()}">${esc(parentName(e.paid_by))}</span></td>
          <td class="num">${money(e.amount)}</td>
          <td class="num">${money(e.amount / 2)}</td>
          <td><div class="row-actions">
            <button class="mini-btn" data-edit="${e.id}">Edit</button>
            <button class="mini-btn danger" data-del-expense="${e.id}">Delete</button>
          </div></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------------------------------------------------------------------------
// Payments view
// ---------------------------------------------------------------------------

function renderPayments() {
  const list = $('#paymentList');
  if (!state.payments.length) {
    list.innerHTML = '<div class="empty">No settlement payments recorded yet.</div>';
    return;
  }
  list.innerHTML = state.payments.map((p) => `<div class="list-item">
    <span class="pill pay">Payment</span>
    <div class="li-main">
      <div class="li-title">${esc(parentName(p.from_parent))} → ${esc(parentName(p.to_parent))}</div>
      <div class="li-sub">${fmtDate(p.date)}${p.method ? ' · ' + esc(p.method) : ''}${p.notes ? ' · ' + esc(p.notes) : ''}</div>
    </div>
    <div class="li-amount">${money(p.amount)}</div>
    <button class="mini-btn danger" data-del-payment="${p.id}">Delete</button>
  </div>`).join('');
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------

function renderSettings() {
  $('#settingsForm').parent_a_name.value = state.parents.A;
  $('#settingsForm').parent_b_name.value = state.parents.B;
}
function renderChildren() {
  const el = $('#childList');
  el.innerHTML = state.children.length
    ? state.children.map((c) => `<span class="chip">${esc(c.name)}<button data-del-child="${c.id}" aria-label="Remove">✕</button></span>`).join('')
    : '<span class="muted">No children added yet.</span>';
}

// ---------------------------------------------------------------------------
// Statement view
// ---------------------------------------------------------------------------

async function loadStatement() {
  const month = $('#statementMonth').value || thisMonth();
  $('#statementMonth').value = month;
  const out = $('#statementOutput');
  try {
    const s = await api.get(`/api/statement?month=${month}`);
    out.dataset.loaded = '1';
    out.innerHTML = renderStatement(s);
  } catch (err) {
    out.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

function renderStatement(s) {
  const closing = s.closing.summary;
  const opening = s.opening.summary;
  const items = s.line_items.length ? s.line_items.map((li) => `<tr>
      <td>${fmtDate(li.date)}</td>
      <td>${esc(li.description)}${li.child ? `<div class="li-sub">${esc(li.child)}</div>` : ''}</td>
      <td>${esc(li.category)}</td>
      <td>${esc(li.paid_by_name)}</td>
      <td class="num">${money(li.amount)}</td>
      <td class="num">${money(li.each_share)}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">No expenses this month.</td></tr>`;

  const payments = s.payments.length ? `
    <div class="stmt-section-title">Settlement payments</div>
    <table><thead><tr><th>Date</th><th>From</th><th>To</th><th>Method</th><th class="num">Amount</th></tr></thead>
    <tbody>${s.payments.map((p) => `<tr>
      <td>${fmtDate(p.date)}</td><td>${esc(p.from_name)}</td><td>${esc(p.to_name)}</td>
      <td>${p.method ? esc(p.method) : '—'}</td><td class="num">${money(p.amount)}</td>
    </tr>`).join('')}</tbody></table>` : '';

  return `<div class="stmt">
    <div class="stmt-head">
      <div>
        <h2>Billing Statement</h2>
        <div class="stmt-brand">KidLedger · ${esc(s.names.A)} &amp; ${esc(s.names.B)}</div>
      </div>
      <div class="stmt-period">
        <div class="stmt-brand">Statement period</div>
        <div class="big">${monthLabel(s.month)}</div>
      </div>
    </div>

    <div class="stmt-summary">
      <div class="box"><div class="k">Balance brought forward</div>
        <div class="v">${opening.settled ? 'Settled' : money(opening.amount)}</div>
        <div class="li-sub">${opening.settled ? 'No prior balance' : esc(opening.text)}</div></div>
      <div class="box"><div class="k">Total spent this month</div>
        <div class="v">${money(s.totals.total_spent)}</div>
        <div class="li-sub">${s.totals.expense_count} expense(s) · each share ${money(s.totals.each_share)}</div></div>
    </div>

    <div class="stmt-section-title">Expenses</div>
    <table>
      <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Paid by</th><th class="num">Amount</th><th class="num">Each share</th></tr></thead>
      <tbody>${items}</tbody>
    </table>

    ${payments}

    <div class="stmt-section-title">Reconciliation</div>
    <div class="stmt-total-line"><span>${esc(s.names.A)} paid this month</span><span>${money(s.totals.paid_by_a)}</span></div>
    <div class="stmt-total-line"><span>${esc(s.names.B)} paid this month</span><span>${money(s.totals.paid_by_b)}</span></div>
    <div class="stmt-total-line"><span>Balance brought forward</span><span>${opening.settled ? money(0) : (opening.debtor === 'B' ? '+' : '−') + money(opening.amount)}</span></div>
    <div class="stmt-total-line"><span>Net change from this month's expenses</span><span>${fmtSigned(s.net_from_expenses)}</span></div>
    ${s.net_from_payments !== 0 ? `<div class="stmt-total-line"><span>Settlement payments applied</span><span>${fmtSigned(s.net_from_payments)}</span></div>` : ''}

    <div class="stmt-callout ${closing.settled ? 'settled' : ''}">
      ${closing.settled ? '✓ Balance is fully settled as of month end.' : `Amount due: ${esc(closing.text)}`}
    </div>

    <p class="muted" style="margin-top:18px">Positive figures increase what ${esc(s.names.B)} owes ${esc(s.names.A)}; negative figures move the balance the other way. Generated by KidLedger on ${fmtDate(todayISO())}.</p>
  </div>`;
}
function fmtSigned(n) {
  if (n === 0) return money(0);
  return (n > 0 ? '+' : '−') + money(Math.abs(n));
}

// ---------------------------------------------------------------------------
// Modal (expense editor)
// ---------------------------------------------------------------------------

function openExpenseModal(expense) {
  const form = $('#expenseForm');
  form.reset();
  $('#catFull').innerHTML = categoryOptions(expense ? expense.category : 'Other');
  $('#childFull').innerHTML = childOptions(expense ? expense.child_id : '');
  $('#paidByFull').innerHTML = parentOptions(expense ? expense.paid_by : 'A');
  $('#expenseModalTitle').textContent = expense ? 'Edit expense' : 'New expense';
  form.id.value = expense ? expense.id : '';
  form.date.value = expense ? expense.date : todayISO();
  form.amount.value = expense ? expense.amount : '';
  form.description.value = expense ? expense.description : '';
  form.notes.value = expense && expense.notes ? expense.notes : '';
  $('#expenseModal').hidden = false;
}
function closeExpenseModal() { $('#expenseModal').hidden = true; }

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireEvents() {
  // Quick add expense (dashboard)
  $('#quickExpenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.send('POST', '/api/expenses', {
        date: f.date.value, amount: f.amount.value, description: f.description.value,
        category: f.category.value, child_id: f.child_id.value || null, paid_by: f.paid_by.value,
      });
      f.reset();
      f.date.value = todayISO();
      await reloadData();
      toast('Expense added');
    } catch (err) { toast(err.message, true); }
  });

  // New expense button
  $('#newExpenseBtn').addEventListener('click', () => openExpenseModal(null));
  $('#closeExpenseModal').addEventListener('click', closeExpenseModal);
  $('#cancelExpenseModal').addEventListener('click', closeExpenseModal);
  $('#expenseModal').addEventListener('click', (e) => { if (e.target.id === 'expenseModal') closeExpenseModal(); });

  // Expense modal save
  $('#expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const payload = {
      date: f.date.value, amount: f.amount.value, description: f.description.value,
      category: f.category.value, child_id: f.child_id.value || null,
      paid_by: f.paid_by.value, notes: f.notes.value,
    };
    try {
      if (f.id.value) await api.send('PUT', `/api/expenses/${f.id.value}`, payload);
      else await api.send('POST', '/api/expenses', payload);
      closeExpenseModal();
      await reloadData();
      toast('Saved');
    } catch (err) { toast(err.message, true); }
  });

  // Expense table actions (delegated)
  $('#expenseTable').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del-expense]');
    if (edit) {
      const exp = state.expenses.find((x) => String(x.id) === edit.dataset.edit);
      if (exp) openExpenseModal(exp);
    } else if (del) {
      if (!confirm('Delete this expense?')) return;
      try { await api.send('DELETE', `/api/expenses/${del.dataset.delExpense}`); await reloadData(); toast('Deleted'); }
      catch (err) { toast(err.message, true); }
    }
  });
  $('#expenseMonthFilter').addEventListener('change', renderExpenses);
  $('#clearExpenseFilter').addEventListener('click', () => { $('#expenseMonthFilter').value = ''; renderExpenses(); });

  // Payments
  $('#paymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.send('POST', '/api/payments', {
        date: f.date.value, amount: f.amount.value,
        from_parent: f.from_parent.value, to_parent: f.to_parent.value,
        method: f.method.value, notes: f.notes.value,
      });
      f.reset();
      f.date.value = todayISO();
      await reloadData();
      toast('Payment recorded');
    } catch (err) { toast(err.message, true); }
  });
  $('#paymentList').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-payment]');
    if (!del) return;
    if (!confirm('Delete this payment?')) return;
    try { await api.send('DELETE', `/api/payments/${del.dataset.delPayment}`); await reloadData(); toast('Deleted'); }
    catch (err) { toast(err.message, true); }
  });

  // Settings
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const res = await api.send('PUT', '/api/settings', {
        parent_a_name: f.parent_a_name.value, parent_b_name: f.parent_b_name.value,
      });
      state.parents = res.parents;
      refreshSelects();
      await reloadData();
      toast('Names saved');
    } catch (err) { toast(err.message, true); }
  });
  $('#childForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await api.send('POST', '/api/children', { name: f.name.value }); f.reset(); await reloadData(); toast('Child added'); }
    catch (err) { toast(err.message, true); }
  });
  $('#childList').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-child]');
    if (!del) return;
    try { await api.send('DELETE', `/api/children/${del.dataset.delChild}`); await reloadData(); toast('Removed'); }
    catch (err) { toast(err.message, true); }
  });

  // Statement
  $('#loadStatementBtn').addEventListener('click', loadStatement);
  $('#statementMonth').addEventListener('change', loadStatement);
  $('#printStatementBtn').addEventListener('click', () => window.print());
}

// Reload data then re-render everything that depends on it.
async function reloadData() {
  const [children, expenses, payments] = await Promise.all([
    api.get('/api/children'),
    api.get('/api/expenses'),
    api.get('/api/payments'),
  ]);
  state.children = children;
  state.expenses = expenses;
  state.payments = payments;
  refreshSelects();
  renderChildren();
  renderExpenses();
  renderPayments();
  await renderDashboard();
  // Refresh statement if it's been loaded.
  if ($('#statementOutput').dataset.loaded) await loadStatement();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  // default dates
  $$('input[type="date"]').forEach((i) => { if (!i.value) i.value = todayISO(); });
  wireEvents();
  try {
    await loadAll();
  } catch (err) {
    toast('Failed to load: ' + err.message, true);
  }
})();
