/* GreenLeaf single-page client. Plain JS + fetch() against the Express API (/api/...).
   Sections: helpers | modal + form builder | cart | views | boot */
'use strict';

/* ================================ helpers ================================ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = s => (s ? String(s).slice(0, 10) : '');
const fmtDateTime = s => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
const today = () => new Date().toISOString().slice(0, 10);
const qs = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null && v !== false)).toString();
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const pill = text => `<span class="pill ${esc(String(text).replace(/\s/g, ''))}">${esc(text)}</span>`;

// fetch wrapper: returns parsed JSON or throws Error(message from API)
async function api(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach the server. Is it running (npm start)?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.details = data && data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 7000 : 3500);
}
// run an async action, toast any error
async function safe(fn) {
  try { return await fn(); } catch (e) { toast(e.message, 'error'); }
}

function table(columns, rows, { rowClass, empty = 'Nothing to show.' } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const head = columns.map(c => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr class="${rowClass ? rowClass(r) : ''}">` +
    columns.map(c => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('') + '</tr>').join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function fillSelect(sel, items, value, label, first, keep = true) {
  const old = keep ? sel.value : '';
  sel.innerHTML = (first != null ? `<option value="">${esc(first)}</option>` : '') +
    items.map(i => `<option value="${esc(i[value])}">${esc(typeof label === 'function' ? label(i) : i[label])}</option>`).join('');
  if (old && [...sel.options].some(o => o.value === old)) sel.value = old;
}

// delegate clicks on [data-act] inside a container
function onAct(container, handlers) {
  container.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !container.contains(b)) return;
    const h = handlers[b.dataset.act];
    if (h) safe(() => h(b.dataset.id, b));
  });
}

/* ========================= modal + form builder ========================= */
const modal = $('#modal');
function openModal(title, html, wide = false) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  modal.classList.toggle('wide', wide);
  if (!modal.open) modal.showModal();
}
const closeModal = () => { if (modal.open) modal.close(); };
$('#modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// client-side validation mirrors the server rules (server re-checks everything)
function validateField(f, v) {
  const s = String(v ?? '').trim();
  if (!s) return f.required ? `${f.label} is required` : '';
  if (f.max && s.length > f.max) return `${f.label} must be at most ${f.max} characters`;
  if (f.type === 'email' && !EMAIL_RE.test(s)) return `${f.label} must be a valid email`;
  if (f.type === 'number') {
    const n = Number(s);
    if (!Number.isFinite(n)) return `${f.label} must be a number`;
    if (f.int && !Number.isInteger(n)) return `${f.label} must be a whole number`;
    if (f.gt !== undefined && !(n > f.gt)) return `${f.label} must be greater than ${f.gt}`;
    if (f.min !== undefined && n < f.min) return `${f.label} must be at least ${f.min}`;
  }
  return '';
}

function fieldHtml(f, val) {
  const v = val ?? f.default ?? '';
  const id = `f_${f.name}`;
  const hint = f.hint ? ` <span class="hint">${esc(f.hint)}</span>` : '';
  const label = `${esc(f.label)}${f.required ? ' *' : ''}${hint}`;
  const cls = f.full ? 'full' : '';
  if (f.type === 'select') {
    const opts = f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
    return `<label class="${cls}" data-field="${f.name}">${label}<select id="${id}" name="${f.name}">${f.blank ? `<option value="">${esc(f.blank)}</option>` : ''}${opts}</select></label>`;
  }
  if (f.type === 'textarea') {
    return `<label class="${cls}" data-field="${f.name}">${label}<textarea id="${id}" name="${f.name}" rows="2">${esc(v)}</textarea></label>`;
  }
  if (f.type === 'suppliers') {
    const chosen = new Map((val || []).map(s => [String(s.supplier_id), s.unit_cost]));
    const rows = f.suppliers.map(s => {
      const on = chosen.has(String(s.supplier_id));
      return `<div class="row"><label><input type="checkbox" data-sup="${s.supplier_id}" ${on ? 'checked' : ''}> ${esc(s.name)}</label>` +
        `<input type="number" min="0" step="0.01" placeholder="unit cost" data-cost="${s.supplier_id}" value="${on ? esc(chosen.get(String(s.supplier_id))) : ''}"></div>`;
    }).join('');
    return `<div class="full" data-field="suppliers"><label>${label}</label><div class="supplier-links">${rows || '<span class="muted">No suppliers yet.</span>'}</div></div>`;
  }
  const attrs = f.type === 'number' ? `step="${f.step || 1}" ${f.min !== undefined ? `min="${f.min}"` : ''}` : '';
  return `<label class="${cls}" data-field="${f.name}">${label}<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${attrs} ${f.max ? `maxlength="${f.max}"` : ''}></label>`;
}

/**
 * formModal({title, fields, values, submitLabel, onSubmit(values) -> promise})
 * Validates in the browser, shows every error, and shows API errors inline.
 */
function formModal({ title, fields, values = {}, submitLabel = 'Save', onSubmit, wide = false }) {
  const html = `<form class="form" novalidate>
      ${fields.map(f => fieldHtml(f, values[f.name])).join('')}
      <div class="alert error full hidden" role="alert"></div>
      <div class="form-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">${esc(submitLabel)}</button></div>
    </form>`;
  openModal(title, html, wide);
  const form = $('#modal-body form');
  const errBox = $('.alert', form);
  $('[data-cancel]', form).addEventListener('click', closeModal);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const out = {};
    const errors = [];
    $$('.field-error', form).forEach(x => x.classList.remove('field-error'));
    for (const f of fields) {
      if (f.type === 'suppliers') {
        out.suppliers = [];
        for (const cb of $$('[data-sup]:checked', form)) {
          const cost = $(`[data-cost="${cb.dataset.sup}"]`, form).value;
          const msg = validateField({ label: 'Supplier unit cost', type: 'number', required: true, min: 0 }, cost);
          if (msg) errors.push(msg);
          out.suppliers.push({ supplier_id: Number(cb.dataset.sup), unit_cost: cost });
        }
        continue;
      }
      const el = form.elements[f.name];
      out[f.name] = el.value;
      const msg = validateField(f, el.value);
      if (msg) { errors.push(msg); $(`[data-field="${f.name}"]`, form).classList.add('field-error'); }
    }
    if (errors.length) { errBox.textContent = errors.join(' • '); errBox.classList.remove('hidden'); return; }
    errBox.classList.add('hidden');
    const btn = $('.btn.primary', form);
    btn.disabled = true;
    try {
      await onSubmit(out);
      closeModal();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ================================== cart ================================= */
const cart = { lines: [], customer_id: '', employee_id: '' }; // lines: {product_id, sku, name, price, stock, qty}
function saveCart() { try { localStorage.setItem('gl-cart', JSON.stringify(cart.lines)); } catch (e) { /* storage blocked */ } updateBadge(); }
function loadCart() { try { cart.lines = JSON.parse(localStorage.getItem('gl-cart') || '[]'); } catch (e) { cart.lines = []; } updateBadge(); }
function updateBadge() { $('#cart-badge').textContent = cart.lines.reduce((s, l) => s + l.qty, 0); }

function addToCart(p, qty) {
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty < 1) return toast('Enter a quantity of 1 or more', 'error');
  const line = cart.lines.find(l => l.product_id === p.product_id);
  const want = (line ? line.qty : 0) + qty;
  if (want > p.stock_qty) return toast(`Only ${p.stock_qty} of ${p.name} in stock`, 'error');
  if (line) { line.qty = want; line.stock = p.stock_qty; line.price = p.price; }
  else cart.lines.push({ product_id: p.product_id, sku: p.sku, name: p.name, price: p.price, stock: p.stock_qty, qty });
  saveCart();
  toast(`Added ${qty} x ${p.name} to cart`);
}

/* ================================== views ================================ */
const views = {};
let current = 'shop';

function showView(name) {
  if (!views[name]) name = 'shop';
  current = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  safe(() => views[name]());
}

/* ---- Shop ---- */
let shopProducts = [];
async function loadShop() {
  const query = qs({
    q: $('#shop-q').value, category_id: $('#shop-cat').value, min_price: $('#shop-min').value,
    max_price: $('#shop-max').value, in_stock: $('#shop-instock').checked, sort: $('#shop-sort').value,
  });
  shopProducts = await api('GET', '/products?' + query);
  $('#shop-count').textContent = `${shopProducts.length} product${shopProducts.length === 1 ? '' : 's'}`;
  $('#shop-grid').innerHTML = shopProducts.map(p => {
    const out = p.stock_qty === 0;
    const stock = out ? '<span class="pill Out">Out of stock</span>'
      : p.is_low_stock ? `<span class="pill Low">Only ${p.stock_qty} left</span>` : `<span class="pill OK">${p.stock_qty} in stock</span>`;
    return `<div class="card product">
      <span class="cat">${esc(p.category_name)}</span>
      <span class="name">${esc(p.name)}</span>
      <span class="muted">${esc(p.sku)}</span>
      <span class="price">${money(p.price)}</span>
      <div>${stock}</div>
      <div class="buy"><input class="qty" type="number" min="1" max="${p.stock_qty}" value="1" ${out ? 'disabled' : ''} aria-label="Quantity">
        <button class="btn primary small" data-act="add" data-id="${p.product_id}" ${out ? 'disabled' : ''}>Add to cart</button></div>
    </div>`;
  }).join('') || '<div class="empty card">No products match your filters.</div>';
}
onAct($('#shop-grid'), {
  add: (id, btn) => addToCart(shopProducts.find(p => p.product_id === Number(id)), $('.qty', btn.parentElement).value),
});
views.shop = async () => {
  if ($('#shop-cat').options.length === 1) {
    fillSelect($('#shop-cat'), await api('GET', '/categories'), 'category_id', 'name', 'All categories');
  }
  await loadShop();
};
['#shop-cat', '#shop-instock', '#shop-sort'].forEach(s => $(s).addEventListener('change', () => safe(loadShop)));
['#shop-q', '#shop-min', '#shop-max'].forEach(s => $(s).addEventListener('input', debounce(() => safe(loadShop))));

/* ---- Cart / checkout ---- */
function renderCartLines() {
  const lines = cart.lines;
  $('#cart-lines').innerHTML = lines.length
    ? `<div class="table-wrap">${table([
      { label: 'Product', render: l => `<b>${esc(l.name)}</b><br><span class="muted">${esc(l.sku)}</span>` },
      { label: 'Price', cls: 'num', render: l => money(l.price) },
      { label: 'Qty', cls: 'num', render: l => `<input class="qty" type="number" min="1" max="${l.stock}" value="${l.qty}" data-qty="${l.product_id}" aria-label="Quantity">` },
      { label: 'Subtotal', cls: 'num', render: l => money(l.price * l.qty) },
      { label: '', cls: 'actions', render: l => `<button class="btn small danger" data-act="remove" data-id="${l.product_id}">Remove</button>` },
    ], lines)}</div>`
    : '<div class="empty">Your cart is empty. Browse the Shop to add plants and supplies.</div>';
  $('#cart-total').textContent = money(lines.reduce((s, l) => s + l.price * l.qty, 0));
  $('#cart-place').disabled = !lines.length;
}
$('#cart-lines').addEventListener('change', e => {
  const id = e.target.dataset.qty;
  if (!id) return;
  const line = cart.lines.find(l => l.product_id === Number(id));
  const n = Number(e.target.value);
  if (!Number.isInteger(n) || n < 1) { toast('Quantity must be a whole number of 1 or more', 'error'); }
  else if (n > line.stock) { toast(`Only ${line.stock} of ${line.name} in stock`, 'error'); }
  else line.qty = n;
  saveCart();
  renderCartLines();
});
onAct($('#cart-lines'), {
  remove: id => { cart.lines = cart.lines.filter(l => l.product_id !== Number(id)); saveCart(); renderCartLines(); },
});

async function loadCheckoutRefs(selectCustomer) {
  const [customers, employees] = await Promise.all([api('GET', '/customers'), api('GET', '/employees')]);
  fillSelect($('#cart-customer'), customers, 'customer_id', c => `${c.last_name}, ${c.first_name} (${c.email})`, 'Choose a customer...');
  fillSelect($('#cart-employee'), employees, 'employee_id', e => `${e.first_name} ${e.last_name} (${e.role})`, null);
  if (selectCustomer) $('#cart-customer').value = selectCustomer;
}
views.cart = async () => {
  $('#cart-error').classList.add('hidden');
  // refresh stock/price from the server so stale carts are corrected
  if (cart.lines.length) {
    const fresh = new Map((await api('GET', '/products')).map(p => [p.product_id, p]));
    cart.lines = cart.lines.filter(l => fresh.has(l.product_id) && fresh.get(l.product_id).stock_qty > 0).map(l => {
      const p = fresh.get(l.product_id);
      return { ...l, price: p.price, stock: p.stock_qty, qty: Math.min(l.qty, p.stock_qty) };
    });
    saveCart();
  }
  renderCartLines();
  await loadCheckoutRefs();
};
$('#cart-new-customer').addEventListener('click', () => customerForm(null, async c => { await loadCheckoutRefs(c.customer_id); }));
$('#cart-place').addEventListener('click', () => safe(async () => {
  const box = $('#cart-error');
  box.classList.add('hidden');
  if (!$('#cart-customer').value) { box.textContent = 'Please choose (or create) a customer.'; return box.classList.remove('hidden'); }
  if (!$('#cart-employee').value) { box.textContent = 'Please choose the employee processing the order.'; return box.classList.remove('hidden'); }
  $('#cart-place').disabled = true;
  try {
    const order = await api('POST', '/orders', {
      customer_id: Number($('#cart-customer').value),
      employee_id: Number($('#cart-employee').value),
      items: cart.lines.map(l => ({ product_id: l.product_id, quantity: l.qty })),
    });
    cart.lines = []; saveCart();
    toast(`Order #${order.order_id} placed - total ${money(order.total_amount)}`);
    showView('orders');
    orderDetail(order.order_id);
  } catch (e) {
    box.textContent = e.message; // e.g. "Order not placed - insufficient stock: ..."
    box.classList.remove('hidden');
    await views.cart(); // refresh stock numbers
  } finally {
    $('#cart-place').disabled = !cart.lines.length;
  }
}));

/* ---- Orders ---- */
const NEXT = { Pending: ['Processing', 'Completed', 'Cancelled'], Processing: ['Pending', 'Completed', 'Cancelled'], Completed: [], Cancelled: [] };
views.orders = async () => {
  if ($('#ord-customer').options.length === 1) {
    fillSelect($('#ord-customer'), await api('GET', '/customers'), 'customer_id', c => `${c.last_name}, ${c.first_name}`, 'All customers');
  }
  const rows = await api('GET', '/orders?' + qs({
    status: $('#ord-status').value, from: $('#ord-from').value, to: $('#ord-to').value, customer_id: $('#ord-customer').value,
  }));
  $('#ord-table').innerHTML = table([
    { label: '#', render: o => `<b>${o.order_id}</b>` },
    { label: 'Date', render: o => fmtDateTime(o.order_date) },
    { label: 'Customer', render: o => esc(o.customer_name) },
    { label: 'Processed by', render: o => esc(o.employee_name) },
    { label: 'Items', cls: 'num', render: o => o.item_count },
    { label: 'Total', cls: 'num', render: o => money(o.total_amount) },
    { label: 'Status', render: o => pill(o.status) },
    { label: '', cls: 'actions', render: o => `<button class="btn small" data-act="view" data-id="${o.order_id}">Details</button>` },
  ], rows, { empty: 'No orders match these filters.' });
};
['#ord-status', '#ord-from', '#ord-to', '#ord-customer'].forEach(s => $(s).addEventListener('change', () => safe(views.orders)));
$('#ord-clear').addEventListener('click', () => { ['#ord-status', '#ord-from', '#ord-to', '#ord-customer'].forEach(s => { $(s).value = ''; }); safe(views.orders); });
onAct($('#ord-table'), { view: id => orderDetail(id) });

async function orderDetail(id) {
  const o = await api('GET', `/orders/${id}`);
  const actions = NEXT[o.status].map(s =>
    `<button class="btn ${s === 'Cancelled' ? 'danger' : 'primary'}" data-st="${s}">${s === 'Cancelled' ? 'Cancel order (restock)' : 'Mark ' + s}</button>`).join('');
  openModal(`Order #${o.order_id}`, `
    <div class="detail-head">
      <div><span>Status</span>${pill(o.status)}</div>
      <div><span>Date</span>${fmtDateTime(o.order_date)}</div>
      <div><span>Customer</span>${esc(o.customer_name)}</div>
      <div><span>Processed by</span>${esc(o.employee_name)}</div>
      <div><span>Total</span><b>${money(o.total_amount)}</b></div>
    </div>
    <div class="table-wrap">${table([
      { label: 'SKU', render: i => esc(i.sku) },
      { label: 'Product', render: i => esc(i.product_name) },
      { label: 'Qty', cls: 'num', render: i => i.quantity },
      { label: 'Unit price', cls: 'num', render: i => money(i.unit_price) },
      { label: 'Line total', cls: 'num', render: i => money(i.line_total) },
    ], o.items)}</div>
    <div class="btn-row">${actions}<span class="spacer"></span>
      ${o.status !== 'Completed' ? '<button class="btn danger" data-del>Delete order</button>' : ''}</div>
    <p class="muted">Cancelling or deleting an open order puts its items back into inventory. Completed and Cancelled are final.</p>`, true);
  const body = $('#modal-body');
  $$('[data-st]', body).forEach(b => b.addEventListener('click', () => safe(async () => {
    await api('PATCH', `/orders/${id}/status`, { status: b.dataset.st });
    toast(`Order #${id} is now ${b.dataset.st}`);
    await orderDetail(id);
    if (current === 'orders') views.orders();
  })));
  const del = $('[data-del]', body);
  if (del) del.addEventListener('click', () => safe(async () => {
    if (!confirm(`Delete order #${id}?`)) return;
    await api('DELETE', `/orders/${id}`);
    toast(`Order #${id} deleted`);
    closeModal();
    if (current === 'orders') views.orders();
  }));
}

/* ---- Generic CRUD view (categories, suppliers, customers, employees) ---- */
function crudView(cfg) {
  const load = async () => {
    const q = cfg.search ? $(cfg.search).value : '';
    const rows = await api('GET', `${cfg.path}?${qs({ q })}`);
    $(cfg.table).innerHTML = table([...cfg.columns,
      { label: '', cls: 'actions', render: r => `<button class="btn small" data-act="edit" data-id="${r[cfg.pk]}">Edit</button> <button class="btn small danger" data-act="del" data-id="${r[cfg.pk]}">Delete</button>` },
    ], rows, { empty: `No ${cfg.plural} found.` });
    cfg.rows = rows;
  };
  const open = async row => formModal({
    title: row ? `Edit ${cfg.name}` : `New ${cfg.name}`,
    fields: cfg.fields, values: row || {}, submitLabel: row ? 'Save changes' : `Create ${cfg.name}`,
    onSubmit: async vals => {
      const saved = await api(row ? 'PUT' : 'POST', row ? `${cfg.path}/${row[cfg.pk]}` : cfg.path, vals);
      toast(`${cfg.name[0].toUpperCase() + cfg.name.slice(1)} ${row ? 'updated' : 'created'}`);
      await load();
      if (cfg.onSaved) cfg.onSaved(saved);
    },
  });
  $(cfg.addBtn).addEventListener('click', () => open(null));
  if (cfg.search) $(cfg.search).addEventListener('input', debounce(() => safe(load)));
  onAct($(cfg.table), {
    edit: id => open(cfg.rows.find(r => r[cfg.pk] === Number(id))),
    del: async id => {
      const r = cfg.rows.find(x => x[cfg.pk] === Number(id));
      if (!confirm(`Delete ${cfg.name} "${cfg.label(r)}"?`)) return;
      await api('DELETE', `${cfg.path}/${id}`);
      toast(`${cfg.name[0].toUpperCase() + cfg.name.slice(1)} deleted`);
      await load();
    },
  });
  return load;
}

// customer form is reused by the cart ("+ New customer")
const customerFields = [
  { name: 'first_name', label: 'First name', required: true, max: 50 },
  { name: 'last_name', label: 'Last name', required: true, max: 50 },
  { name: 'email', label: 'Email', type: 'email', required: true, max: 120, full: true },
  { name: 'phone', label: 'Phone', max: 25 },
  { name: 'address', label: 'Address', max: 200 },
];
function customerForm(row, after) {
  formModal({
    title: row ? 'Edit customer' : 'New customer', fields: customerFields, values: row || {},
    submitLabel: row ? 'Save changes' : 'Create customer',
    onSubmit: async vals => {
      const c = await api(row ? 'PUT' : 'POST', row ? `/customers/${row.customer_id}` : '/customers', vals);
      toast(`Customer ${row ? 'updated' : 'created'}`);
      if (after) await after(c);
    },
  });
}

views.customers = crudView({
  name: 'customer', plural: 'customers', path: '/customers', pk: 'customer_id', table: '#cus-table', addBtn: '#cus-add', search: '#cus-q',
  label: r => `${r.first_name} ${r.last_name}`, fields: customerFields,
  columns: [
    { label: 'Name', render: r => `<b>${esc(r.first_name)} ${esc(r.last_name)}</b>` },
    { label: 'Email', render: r => esc(r.email) },
    { label: 'Phone', render: r => esc(r.phone) },
    { label: 'Address', render: r => esc(r.address) },
    { label: 'Orders', cls: 'num', render: r => r.order_count },
  ],
});

views.categories = crudView({
  name: 'category', plural: 'categories', path: '/categories', pk: 'category_id', table: '#cat-table', addBtn: '#cat-add', search: '#cat-q',
  label: r => r.name,
  fields: [
    { name: 'name', label: 'Name', required: true, max: 60, full: true },
    { name: 'description', label: 'Description', type: 'textarea', max: 255, full: true },
  ],
  columns: [
    { label: 'Name', render: r => `<b>${esc(r.name)}</b>` },
    { label: 'Description', render: r => esc(r.description) },
    { label: 'Products', cls: 'num', render: r => r.product_count },
  ],
});

views.suppliers = crudView({
  name: 'supplier', plural: 'suppliers', path: '/suppliers', pk: 'supplier_id', table: '#sup-table', addBtn: '#sup-add', search: '#sup-q',
  label: r => r.name,
  fields: [
    { name: 'name', label: 'Company name', required: true, max: 100, full: true },
    { name: 'contact_name', label: 'Contact', max: 100 },
    { name: 'email', label: 'Email', type: 'email', max: 120 },
    { name: 'phone', label: 'Phone', max: 25 },
    { name: 'address', label: 'Address', max: 200 },
  ],
  columns: [
    { label: 'Supplier', render: r => `<b>${esc(r.name)}</b>` },
    { label: 'Contact', render: r => esc(r.contact_name) },
    { label: 'Email', render: r => esc(r.email) },
    { label: 'Phone', render: r => esc(r.phone) },
    { label: 'Products', cls: 'num', render: r => r.product_count },
    { label: 'Purchases', cls: 'num', render: r => r.purchase_count },
  ],
});

views.employees = crudView({
  name: 'employee', plural: 'employees', path: '/employees', pk: 'employee_id', table: '#emp-table', addBtn: '#emp-add', search: '#emp-q',
  label: r => `${r.first_name} ${r.last_name}`,
  fields: [
    { name: 'first_name', label: 'First name', required: true, max: 50 },
    { name: 'last_name', label: 'Last name', required: true, max: 50 },
    { name: 'email', label: 'Email', type: 'email', required: true, max: 120 },
    { name: 'role', label: 'Role', type: 'select', options: [{ value: 'Employee', label: 'Employee' }, { value: 'Manager', label: 'Manager' }] },
    { name: 'hire_date', label: 'Hire date', type: 'date', required: true, default: today() },
  ],
  columns: [
    { label: 'Name', render: r => `<b>${esc(r.first_name)} ${esc(r.last_name)}</b>` },
    { label: 'Email', render: r => esc(r.email) },
    { label: 'Role', render: r => pill(r.role) },
    { label: 'Hired', render: r => fmtDate(r.hire_date) },
    { label: 'Orders', cls: 'num', render: r => r.orders_processed },
  ],
});

/* ---- Products (admin) ---- */
let productRows = [];
views.products = async () => {
  if ($('#prod-cat').options.length === 1) {
    fillSelect($('#prod-cat'), await api('GET', '/categories'), 'category_id', 'name', 'All categories');
  }
  productRows = await api('GET', '/products?' + qs({
    q: $('#prod-q').value, category_id: $('#prod-cat').value, low_stock: $('#prod-low').checked, sort: 'category',
  }));
  $('#prod-table').innerHTML = table([
    { label: 'SKU', render: p => esc(p.sku) },
    { label: 'Product', render: p => `<b>${esc(p.name)}</b>` },
    { label: 'Category', render: p => esc(p.category_name) },
    { label: 'Price', cls: 'num', render: p => money(p.price) },
    { label: 'Cost', cls: 'num', render: p => money(p.cost) },
    { label: 'Stock', cls: 'num', render: p => p.stock_qty },
    { label: 'Reorder at', cls: 'num', render: p => p.reorder_level },
    { label: '', cls: 'actions', render: p => `<button class="btn small" data-act="edit" data-id="${p.product_id}">Edit</button> <button class="btn small danger" data-act="del" data-id="${p.product_id}">Delete</button>` },
  ], productRows, { rowClass: p => (p.stock_qty === 0 ? 'out' : p.is_low_stock ? 'low' : ''), empty: 'No products found.' });
};
['#prod-cat', '#prod-low'].forEach(s => $(s).addEventListener('change', () => safe(views.products)));
$('#prod-q').addEventListener('input', debounce(() => safe(views.products)));

async function productForm(row) {
  const [cats, sups] = await Promise.all([api('GET', '/categories'), api('GET', '/suppliers')]);
  const full = row ? await api('GET', `/products/${row.product_id}`) : { stock_qty: 0, reorder_level: 10, suppliers: [] };
  formModal({
    title: row ? 'Edit product' : 'New product', wide: true,
    submitLabel: row ? 'Save changes' : 'Create product',
    values: full,
    fields: [
      { name: 'sku', label: 'SKU', required: true, max: 20 },
      { name: 'name', label: 'Name', required: true, max: 120 },
      { name: 'category_id', label: 'Category', type: 'select', required: true, blank: 'Choose...', options: cats.map(c => ({ value: c.category_id, label: c.name })) },
      { name: 'price', label: 'Price ($)', type: 'number', step: '0.01', gt: 0, required: true, hint: 'must be > 0' },
      { name: 'cost', label: 'Cost ($)', type: 'number', step: '0.01', min: 0, required: true },
      { name: 'stock_qty', label: 'Stock on hand', type: 'number', int: true, min: 0, required: true, hint: 'normally changed by orders/purchases' },
      { name: 'reorder_level', label: 'Reorder level', type: 'number', int: true, min: 0, required: true },
      { name: 'description', label: 'Description', type: 'textarea', max: 255, full: true },
      { name: 'suppliers', label: 'Suppliers who sell this product (with their unit cost)', type: 'suppliers', suppliers: sups },
    ],
    onSubmit: async vals => {
      await api(row ? 'PUT' : 'POST', row ? `/products/${row.product_id}` : '/products', vals);
      toast(`Product ${row ? 'updated' : 'created'}`);
      if (current === 'products') views.products();
    },
  });
}
$('#prod-add').addEventListener('click', () => safe(() => productForm(null)));
onAct($('#prod-table'), {
  edit: id => productForm(productRows.find(p => p.product_id === Number(id))),
  del: async id => {
    const p = productRows.find(x => x.product_id === Number(id));
    if (!confirm(`Delete product "${p.name}"?`)) return;
    await api('DELETE', `/products/${id}`);
    toast('Product deleted');
    views.products();
  },
});

/* ---- Purchases (receiving stock) ---- */
views.purchases = async () => {
  if ($('#pur-supplier').options.length === 1) {
    fillSelect($('#pur-supplier'), await api('GET', '/suppliers'), 'supplier_id', 'name', 'All suppliers');
  }
  const rows = await api('GET', '/purchases?' + qs({ status: $('#pur-status').value, supplier_id: $('#pur-supplier').value }));
  $('#pur-table').innerHTML = table([
    { label: '#', render: p => `<b>${p.purchase_id}</b>` },
    { label: 'Ordered', render: p => fmtDate(p.purchase_date) },
    { label: 'Received', render: p => fmtDate(p.received_date) || '<span class="muted">-</span>' },
    { label: 'Supplier', render: p => esc(p.supplier_name) },
    { label: 'By', render: p => esc(p.employee_name) },
    { label: 'Units', cls: 'num', render: p => p.unit_count },
    { label: 'Total cost', cls: 'num', render: p => money(p.total_cost) },
    { label: 'Status', render: p => pill(p.status) },
    { label: '', cls: 'actions', render: p => `<button class="btn small" data-act="view" data-id="${p.purchase_id}">Details</button>` },
  ], rows, { empty: 'No purchases found.' });
};
['#pur-status', '#pur-supplier'].forEach(s => $(s).addEventListener('change', () => safe(views.purchases)));
onAct($('#pur-table'), { view: id => purchaseDetail(id) });
$('#pur-add').addEventListener('click', () => safe(() => purchaseForm(null)));

async function purchaseDetail(id) {
  const p = await api('GET', `/purchases/${id}`);
  const open = p.status === 'Ordered';
  openModal(`Purchase #${p.purchase_id}`, `
    <div class="detail-head">
      <div><span>Status</span>${pill(p.status)}</div>
      <div><span>Supplier</span>${esc(p.supplier_name)}</div>
      <div><span>Ordered</span>${fmtDate(p.purchase_date)}</div>
      <div><span>Received</span>${fmtDate(p.received_date) || '-'}</div>
      <div><span>By</span>${esc(p.employee_name)}</div>
      <div><span>Total</span><b>${money(p.total_cost)}</b></div>
    </div>
    <div class="table-wrap">${table([
      { label: 'SKU', render: i => esc(i.sku) },
      { label: 'Product', render: i => esc(i.product_name) },
      { label: 'Qty', cls: 'num', render: i => i.quantity },
      { label: 'Unit cost', cls: 'num', render: i => money(i.unit_cost) },
      { label: 'Line total', cls: 'num', render: i => money(i.line_total) },
    ], p.items)}</div>
    <div class="btn-row">
      ${open ? '<button class="btn primary" data-recv>Mark received (add to inventory)</button><button class="btn" data-edit>Edit</button><button class="btn" data-cancel-po>Cancel purchase</button>' : ''}
      ${p.status !== 'Received' ? '<button class="btn danger" data-del>Delete</button>' : ''}
    </div>
    <p class="muted">Inventory only increases when a purchase is received. Received purchases are permanent records.</p>`, true);
  const body = $('#modal-body');
  const refresh = () => { if (current === 'purchases') views.purchases(); if (current === 'inventory') views.inventory(); };
  const bind = (sel, fn) => { const b = $(sel, body); if (b) b.addEventListener('click', () => safe(fn)); };
  bind('[data-recv]', async () => {
    await api('POST', `/purchases/${id}/receive`);
    toast(`Purchase #${id} received - inventory updated`);
    await purchaseDetail(id); refresh();
  });
  bind('[data-cancel-po]', async () => {
    await api('POST', `/purchases/${id}/cancel`);
    toast(`Purchase #${id} cancelled`);
    await purchaseDetail(id); refresh();
  });
  bind('[data-edit]', () => purchaseForm(p));
  bind('[data-del]', async () => {
    if (!confirm(`Delete purchase #${id}?`)) return;
    await api('DELETE', `/purchases/${id}`);
    toast('Purchase deleted'); closeModal(); refresh();
  });
}

// create / edit a purchase with dynamic line items
async function purchaseForm(existing) {
  const [suppliers, employees] = await Promise.all([api('GET', '/suppliers'), api('GET', '/employees')]);
  let supplierProducts = [];
  openModal(existing ? `Edit purchase #${existing.purchase_id}` : 'New supplier purchase', `
    <form class="form" novalidate>
      <label>Supplier *<select name="supplier_id"><option value="">Choose...</option>${suppliers.map(s => `<option value="${s.supplier_id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>Ordered by *<select name="employee_id">${employees.map(e => `<option value="${e.employee_id}">${esc(e.first_name + ' ' + e.last_name)}</option>`).join('')}</select></label>
      <label>Purchase date<input type="date" name="purchase_date" value="${esc(existing ? fmtDate(existing.purchase_date) : today())}"></label>
      ${existing ? '' : '<label class="check" style="align-self:end"><input type="checkbox" name="receive_now"> Goods already received (add to inventory now)</label>'}
      <div class="full"><b>Line items</b> <span class="muted">(only products the supplier sells)</span>
        <div class="lines" id="po-lines"></div>
        <button type="button" class="btn small" id="po-addline">+ Add line</button>
        <div class="total-row" style="margin-top:10px"><span>Total cost</span><strong id="po-total">$0.00</strong></div>
      </div>
      <div class="alert error full hidden" role="alert"></div>
      <div class="form-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">${existing ? 'Save changes' : 'Create purchase'}</button></div>
    </form>`, true);
  const form = $('#modal-body form');
  const linesEl = $('#po-lines');
  const errBox = $('.alert', form);
  $('[data-cancel]', form).addEventListener('click', closeModal);

  const recalc = () => {
    const total = $$('.po-line', linesEl).reduce((s, r) => s + (Number($('[name=qty]', r).value) || 0) * (Number($('[name=cost]', r).value) || 0), 0);
    $('#po-total').textContent = money(total);
  };
  const addLine = (line = {}) => {
    const row = document.createElement('div');
    row.className = 'po-line';
    row.style.cssText = 'display:grid;grid-template-columns:3fr 90px 110px auto;gap:8px;margin:8px 0';
    row.innerHTML = `<select name="product"><option value="">Product...</option>${supplierProducts.map(p => `<option value="${p.product_id}" data-cost="${p.unit_cost}" ${String(p.product_id) === String(line.product_id) ? 'selected' : ''}>${esc(p.name)} (stock ${p.stock_qty})</option>`).join('')}</select>
      <input name="qty" type="number" min="1" step="1" placeholder="Qty" value="${esc(line.quantity ?? '')}">
      <input name="cost" type="number" min="0" step="0.01" placeholder="Unit cost" value="${esc(line.unit_cost ?? '')}">
      <button type="button" class="btn small danger" aria-label="Remove line">&times;</button>`;
    $('select', row).addEventListener('change', e => {
      const opt = e.target.selectedOptions[0];
      if (opt && opt.dataset.cost) $('[name=cost]', row).value = opt.dataset.cost;
      recalc();
    });
    $('button', row).addEventListener('click', () => { row.remove(); recalc(); });
    row.addEventListener('input', recalc);
    linesEl.appendChild(row);
  };
  const loadSupplier = async (id, keepLines) => {
    supplierProducts = id ? await api('GET', `/suppliers/${id}/products`) : [];
    linesEl.innerHTML = '';
    if (keepLines && keepLines.length) keepLines.forEach(addLine); else addLine();
    recalc();
  };
  form.elements.supplier_id.addEventListener('change', e => safe(() => loadSupplier(e.target.value)));
  $('#po-addline').addEventListener('click', () => {
    if (!form.elements.supplier_id.value) return toast('Choose a supplier first', 'error');
    addLine();
  });
  if (existing) {
    form.elements.supplier_id.value = existing.supplier_id;
    form.elements.employee_id.value = existing.employee_id;
    await loadSupplier(existing.supplier_id, existing.items);
  } else addLine();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const errors = [];
    if (!form.elements.supplier_id.value) errors.push('Supplier is required');
    const items = [];
    const seen = new Set();
    $$('.po-line', linesEl).forEach((r, i) => {
      const pid = $('[name=product]', r).value, qty = $('[name=qty]', r).value, cost = $('[name=cost]', r).value;
      if (!pid && !qty && !cost) return; // ignore untouched rows
      if (!pid) return errors.push(`Line ${i + 1}: choose a product`);
      if (seen.has(pid)) errors.push(`Line ${i + 1}: product is already on this purchase`);
      seen.add(pid);
      const qm = validateField({ label: `Line ${i + 1} quantity`, type: 'number', int: true, min: 1, required: true }, qty);
      const cm = validateField({ label: `Line ${i + 1} unit cost`, type: 'number', min: 0, required: true }, cost);
      if (qm) errors.push(qm);
      if (cm) errors.push(cm);
      items.push({ product_id: Number(pid), quantity: qty, unit_cost: cost });
    });
    if (!items.length && !errors.length) errors.push('Add at least one line item');
    if (errors.length) { errBox.textContent = errors.join(' • '); return errBox.classList.remove('hidden'); }
    errBox.classList.add('hidden');
    const body = {
      supplier_id: Number(form.elements.supplier_id.value), employee_id: Number(form.elements.employee_id.value),
      purchase_date: form.elements.purchase_date.value || undefined, items,
      receive_now: form.elements.receive_now ? form.elements.receive_now.checked : false,
    };
    try {
      const saved = await api(existing ? 'PUT' : 'POST', existing ? `/purchases/${existing.purchase_id}` : '/purchases', body);
      toast(`Purchase #${saved.purchase_id} ${existing ? 'updated' : 'created'}${saved.status === 'Received' ? ' and received into inventory' : ''}`);
      closeModal();
      if (current === 'purchases') views.purchases();
    } catch (err) { errBox.textContent = err.message; errBox.classList.remove('hidden'); }
  });
}

/* ---- Inventory ---- */
views.inventory = async () => {
  if ($('#inv-cat').options.length === 1) {
    fillSelect($('#inv-cat'), await api('GET', '/categories'), 'category_id', 'name', 'All categories');
  }
  const { summary, items } = await api('GET', '/inventory?' + qs({
    q: $('#inv-q').value, category_id: $('#inv-cat').value, low_stock: $('#inv-low').checked ? '1' : '',
  }));
  $('#inv-summary').innerHTML = `
    <div class="stat"><b>${summary.products}</b><span>Products</span></div>
    <div class="stat"><b>${summary.total_units.toLocaleString()}</b><span>Units on hand</span></div>
    <div class="stat"><b>${money(summary.stock_value)}</b><span>Stock value (at cost)</span></div>
    <div class="stat ${summary.low_stock ? 'warn' : ''}"><b>${summary.low_stock}</b><span>Low / out of stock</span></div>`;
  $('#inv-table').innerHTML = table([
    { label: 'SKU', render: i => esc(i.sku) },
    { label: 'Product', render: i => `<b>${esc(i.name)}</b>` },
    { label: 'Category', render: i => esc(i.category_name) },
    { label: 'On hand', cls: 'num', render: i => `<b>${i.stock_qty}</b>` },
    { label: 'Reorder level', cls: 'num', render: i => i.reorder_level },
    { label: 'On order', cls: 'num', render: i => i.on_order || '-' },
    { label: 'Value', cls: 'num', render: i => money(i.stock_value) },
    { label: 'Status', render: i => pill(i.stock_status) },
  ], items, { rowClass: i => (i.stock_status === 'Out of stock' ? 'out' : i.stock_status === 'Low' ? 'low' : ''), empty: 'No products match.' });
};
['#inv-cat', '#inv-low'].forEach(s => $(s).addEventListener('change', () => safe(views.inventory)));
$('#inv-q').addEventListener('input', debounce(() => safe(views.inventory)));

/* ---- Reports ---- */
const MONEY_COLS = new Set(['revenue', 'gross_profit', 'avg_order_value', 'total_spend', 'avg_unit_cost', 'avg_purchase_value', 'supplier_unit_cost']);
views.reports = async () => {
  const reports = await api('GET', '/reports');
  $('#rep-list').innerHTML = reports.map(r => {
    const cols = r.rows.length ? Object.keys(r.rows[0]) : [];
    const grid = table(cols.map(c => ({
      label: c.replace(/_/g, ' '),
      cls: r.rows.length && typeof r.rows[0][c] === 'number' ? 'num' : '',
      render: row => (MONEY_COLS.has(c) ? money(row[c]) : esc(row[c])),
    })), r.rows, { empty: 'No rows.' });
    return `<div class="card report report-card"><div class="cols">
      <div class="side"><h2>Report ${r.id}: ${esc(r.title)}</h2>
        <p class="q">${esc(r.question)}</p><p>${esc(r.explanation)}</p>
        <details><summary>Show SQL</summary><pre>${esc(r.sql)}</pre></details></div>
      <div class="data">${grid}</div></div></div>`;
  }).join('');
};

/* ================================== boot ================================= */
$$('#nav button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

// "Viewing as" role: hides nav items the role would not use (demo only, not security)
function applyRole(role) {
  $$('#nav button').forEach(b => b.classList.toggle('hidden', !b.dataset.roles.split(' ').includes(role)));
  try { localStorage.setItem('gl-role', role); } catch (e) { /* ignore */ }
  const active = $('#nav button.active');
  if (!active || active.classList.contains('hidden')) showView('shop');
}
$('#role').addEventListener('change', e => applyRole(e.target.value));

loadCart();
let savedRole = 'manager';
try { savedRole = localStorage.getItem('gl-role') || 'manager'; } catch (e) { /* ignore */ }
$('#role').value = savedRole;
const start = location.hash.slice(1);
showView(views[start] ? start : 'shop');
applyRole(savedRole);
