const fmt = n => 'RM' + Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let quotes = [];
let customers = [];
let products = [];
let quoteItems = [];

async function init() {
  const [qRes, cRes, pRes] = await Promise.all([
    fetch('/api/quotes'),
    fetch('/api/customers'),
    fetch('/api/products')
  ]);
  quotes = await qRes.json();
  customers = await cRes.json();
  products = await pRes.json();
  renderQuotes();
  populateSelects();
}

function renderQuotes() {
  const tbody = document.getElementById('quotes-tbody');
  if (!quotes.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#9ca3af">No quotes yet. Click "New Quote" to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = quotes.map(q => `
    <tr>
      <td><strong>${q.quote_number}</strong></td>
      <td>${q.customers ? q.customers.name : (q.customer_name || 'Walk-in')}</td>
      <td><strong>${fmt(q.total)}</strong></td>
      <td><span class="badge badge-${q.status}">${q.status}</span></td>
      <td>${new Date(q.created_at).toLocaleDateString('en-MY')}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-primary" onclick="printQuote('${q.id}')">Print / PDF</button>
        <button class="btn btn-sm btn-secondary" onclick="cycleStatus('${q.id}', '${q.status}')" style="margin-left:4px">Status ›</button>
        ${q.status !== 'rejected' && q.status !== 'accepted' ? `<button class="btn btn-sm btn-secondary" onclick="convertToInvoice('${q.id}')" style="margin-left:4px">→ Invoice</button>` : ''}
      </td>
    </tr>
  `).join('');
}

function populateSelects() {
  const cSel = document.getElementById('q-customer');
  cSel.innerHTML = '<option value="">— Walk-in / No Customer —</option>' +
    customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const pSel = document.getElementById('item-product');
  pSel.innerHTML = '<option value="">Select product...</option>' +
    products.map(p => `<option value="${p.id}" data-price="${p.wholesale_price}">${p.sku} — ${p.style} ${p.color} ${p.size}</option>`).join('');
}

// ── Create Quote ──────────────────────────────────────────────────────────────

function openCreateModal() {
  quoteItems = [];
  document.getElementById('q-customer').value = '';
  document.getElementById('q-notes').value = '';
  document.getElementById('item-product').value = '';
  document.getElementById('item-qty').value = 1;
  renderItems();
  document.getElementById('quote-modal').classList.add('open');
}

function closeQuoteModal() {
  document.getElementById('quote-modal').classList.remove('open');
}

function addItem() {
  const pSel = document.getElementById('item-product');
  const opt = pSel.options[pSel.selectedIndex];
  if (!opt.value) { alert('Please select a product.'); return; }

  const qty = parseInt(document.getElementById('item-qty').value) || 1;
  const unitPrice = parseFloat(opt.dataset.price);
  const [sku, description] = opt.text.split(' — ');

  const existing = quoteItems.find(i => i.product_id === opt.value);
  if (existing) {
    existing.qty += qty;
    existing.total = existing.qty * existing.unit_price;
  } else {
    quoteItems.push({ product_id: opt.value, sku, description: description || sku, qty, unit_price: unitPrice, total: qty * unitPrice });
  }
  renderItems();
}

function removeItem(idx) {
  quoteItems.splice(idx, 1);
  renderItems();
}

function renderItems() {
  const box = document.getElementById('quote-items');
  const subtotal = quoteItems.reduce((s, i) => s + i.total, 0);

  if (!quoteItems.length) {
    box.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:16px;font-size:13px">No items added yet</p>';
  } else {
    box.innerHTML = `
      <table>
        <thead><tr><th>SKU</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th><th></th></tr></thead>
        <tbody>
          ${quoteItems.map((item, i) => `
            <tr>
              <td><strong>${item.sku}</strong></td>
              <td>${item.description}</td>
              <td>${item.qty}</td>
              <td>${fmt(item.unit_price)}</td>
              <td>${fmt(item.total)}</td>
              <td><button class="btn-ghost" onclick="removeItem(${i})">✕</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  document.getElementById('quote-subtotal').textContent = fmt(subtotal);
  document.getElementById('quote-total').textContent = fmt(subtotal);
}

async function saveQuote() {
  if (!quoteItems.length) { alert('Please add at least one item.'); return; }
  const customerId = document.getElementById('q-customer').value;
  const subtotal = quoteItems.reduce((s, i) => s + i.total, 0);

  const body = {
    customer_id: customerId || null,
    customer_name: customerId ? null : 'Walk-in',
    customer_type: 'retail',
    items: quoteItems,
    subtotal,
    total: subtotal,
    notes: document.getElementById('q-notes').value,
    payment_terms: 'Payment due upon order'
  };

  const res = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await res.json();
  if (!res.ok) { alert(result.error || 'Failed to save quote'); return; }

  closeQuoteModal();
  await init();
  printQuote(result.id);
}

// ── Print Quote ───────────────────────────────────────────────────────────────

async function printQuote(id) {
  const res = await fetch(`/api/quotes/${id}`);
  const q = await res.json();
  const customerName  = q.customers ? q.customers.name  : (q.customer_name || 'Walk-in Customer');
  const customerPhone = q.customers ? q.customers.phone : '';
  const customerEmail = q.customers ? q.customers.email : '';

  const rows = q.items.map(item => `
    <tr>
      <td>${item.sku}</td>
      <td>${item.description}</td>
      <td style="text-align:center">${item.qty}</td>
      <td style="text-align:right">${fmt(item.unit_price)}</td>
      <td style="text-align:right"><strong>${fmt(item.total)}</strong></td>
    </tr>
  `).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Quote ${q.quote_number}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;padding:52px;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px}
    .logo{font-size:38px;font-weight:900;letter-spacing:10px;color:#111}
    .logo-sub{font-size:10px;color:#999;letter-spacing:3px;text-transform:uppercase;margin-top:4px}
    .quote-title{font-size:26px;font-weight:700;letter-spacing:5px;color:#C9A227;margin-bottom:10px;text-align:right}
    .meta{font-size:12px;color:#555;margin-bottom:3px;text-align:right}
    hr{border:none;border-top:1.5px solid #eee;margin:28px 0}
    .bill-to h3{font-size:10px;letter-spacing:2px;color:#aaa;text-transform:uppercase;margin-bottom:8px}
    .bill-to p{font-size:14px;margin-bottom:3px}
    table{width:100%;border-collapse:collapse;margin:28px 0}
    th{text-align:left;font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.5px;padding:10px 12px;border-bottom:2px solid #111}
    td{padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px}
    .totals{display:flex;justify-content:flex-end;margin-bottom:32px}
    .totals-box{width:240px}
    .totals-box tr td{border:none;padding:5px 12px}
    .total-final td{font-weight:700;font-size:16px;border-top:2px solid #111;padding-top:12px}
    .footer{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding-top:24px;border-top:1px solid #eee}
    .f-label{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
    .thank-you{text-align:center;margin-top:52px;font-size:11px;color:#bbb;letter-spacing:3px;text-transform:uppercase}
  </style></head><body>
  <div class="header">
    <div><div class="logo">LUX</div><div class="logo-sub">Premium Socks</div></div>
    <div>
      <div class="quote-title">QUOTATION</div>
      <div class="meta"><strong>Quote #:</strong> ${q.quote_number}</div>
      <div class="meta"><strong>Date:</strong> ${new Date(q.created_at).toLocaleDateString('en-MY')}</div>
    </div>
  </div>
  <hr>
  <div class="bill-to">
    <h3>Bill To</h3>
    <p><strong>${customerName}</strong></p>
    ${customerPhone ? `<p>Tel: ${customerPhone}</p>` : ''}
    ${customerEmail ? `<p>Email: ${customerEmail}</p>` : ''}
  </div>
  <table>
    <thead><tr><th>SKU</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <table class="totals-box">
      <tr><td>Subtotal</td><td style="text-align:right">${fmt(q.subtotal)}</td></tr>
      <tr class="total-final"><td>Total</td><td style="text-align:right">${fmt(q.total)}</td></tr>
    </table>
  </div>
  <div class="footer">
    <div><div class="f-label">Payment Terms</div><div class="f-value">${q.payment_terms}</div></div>
    ${q.notes ? `<div><div class="f-label">Notes</div><div class="f-value">${q.notes}</div></div>` : ''}
  </div>
  <div class="thank-you">Thank you for your business</div>
  <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`);
  win.document.close();
}

// ── Status cycle ──────────────────────────────────────────────────────────────

async function cycleStatus(id, current) {
  const order = ['draft', 'sent', 'accepted', 'rejected'];
  const next = order[(order.indexOf(current) + 1) % order.length];
  if (!confirm(`Change status to "${next}"?`)) return;
  await fetch(`/api/quotes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: next })
  });
  await init();
}

async function convertToInvoice(id) {
  if (!confirm('Convert this quote to an invoice?')) return;
  const res = await fetch(`/api/quotes/${id}/convert`, { method: 'POST' });
  const result = await res.json();
  if (!res.ok) { alert(result.error || 'Failed to convert'); return; }
  alert(`Invoice ${result.invoice_number} created!`);
  window.location.href = '/invoices.html';
}

init();
