const fmt = n => 'RM' + Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let invoices = [];
let currentInvoiceId = null;

fetch('/api/invoices/mark-overdue', { method: 'POST' }).catch(() => {});

async function loadSummary() {
  try {
    const res = await fetch('/api/invoices/summary');
    if (!res.ok) throw new Error('Server error');
    const d = await res.json();
    document.getElementById('inv-outstanding').textContent = fmt(d.outstanding);
    document.getElementById('inv-overdue').textContent = d.overdue + ' invoice' + (d.overdue !== 1 ? 's' : '');
    document.getElementById('inv-collected').textContent = fmt(d.collectedMonth);
  } catch {
    document.getElementById('inv-outstanding').textContent = 'Error';
    document.getElementById('inv-overdue').textContent = 'Error';
    document.getElementById('inv-collected').textContent = 'Error';
  }
}

async function loadInvoices() {
  try {
    const res = await fetch('/api/invoices');
    if (!res.ok) throw new Error('Server error');
    invoices = await res.json();
    renderTable();
  } catch {
    document.getElementById('invoices-tbody').innerHTML =
      '<tr><td colspan="9" style="text-align:center;padding:32px;color:#DC2626">⚠️ Could not load invoices. Make sure the server is running (<code>npm start</code>).</td></tr>';
  }
}

function statusBadge(s) {
  const map = { unpaid: 'badge-low', partial: 'badge-warn', paid: 'badge-ok', overdue: 'badge-low' };
  return `<span class="badge ${map[s] || 'badge-draft'}">${s}</span>`;
}

function sourceBadge(source) {
  if (source === 'direct_sale') {
    return `<span class="badge" style="background:#1e3a5f;color:#60a5fa;border:1px solid #2563eb">Direct Sale</span>`;
  }
  if (source === 'quote_conversion') {
    return `<span class="badge" style="background:#2d1f00;color:#C9A227;border:1px solid #C9A227">From Quote</span>`;
  }
  return `<span class="badge badge-draft">${source || '—'}</span>`;
}

function renderTable() {
  const tbody = document.getElementById('invoices-tbody');
  if (!invoices.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:#9ca3af">No invoices yet. Convert a quote or record a sale to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = invoices.map(inv => `
    <tr style="${inv.status === 'overdue' ? 'background:#1a0000' : ''}">
      <td><strong>${inv.invoice_number}</strong></td>
      <td>${inv.customers ? inv.customers.name : (inv.customer_name || '—')}</td>
      <td>${sourceBadge(inv.source)}</td>
      <td>${fmt(inv.total)}</td>
      <td style="color:#059669">${fmt(inv.amount_paid)}</td>
      <td style="color:${Number(inv.balance_due) > 0 ? '#DC2626' : '#059669'}">${fmt(inv.balance_due)}</td>
      <td>${statusBadge(inv.status)}</td>
      <td class="${inv.status === 'overdue' ? 'urgent' : ''}">${inv.due_date || '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-primary" onclick="openDetail('${inv.id}')">View</button>
        <button class="btn btn-sm btn-secondary" onclick="printInvoiceById('${inv.id}')" style="margin-left:4px">Print</button>
      </td>
    </tr>
  `).join('');
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

async function openDetail(id) {
  currentInvoiceId = id;
  const [invRes, payRes] = await Promise.all([
    fetch(`/api/invoices/${id}`),
    fetch(`/api/invoices/${id}/payments`)
  ]);
  const inv = await invRes.json();
  const payments = await payRes.json();

  const customerName = inv.customers ? inv.customers.name : (inv.customer_name || 'Walk-in');
  document.getElementById('detail-inv-number').textContent = inv.invoice_number;
  document.getElementById('detail-customer-name').textContent = customerName + ' · Due: ' + (inv.due_date || '—');
  document.getElementById('detail-total').textContent = fmt(inv.total);
  document.getElementById('detail-paid').textContent = fmt(inv.amount_paid);
  document.getElementById('detail-balance').textContent = fmt(inv.balance_due);

  document.getElementById('detail-items').innerHTML = (inv.items || []).map(item => `
    <tr>
      <td>${item.sku || '—'}</td>
      <td>${item.description}</td>
      <td>${item.qty}</td>
      <td>${fmt(item.unit_price)}</td>
      <td>${fmt(item.total)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="color:#9ca3af;text-align:center">No items</td></tr>';

  document.getElementById('payment-history').innerHTML = payments.length ? `
    <table>
      <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
      <tbody>
        ${payments.map(p => `
          <tr>
            <td>${p.payment_date}</td>
            <td>${p.payment_method}</td>
            <td>${p.reference_number || '—'}</td>
            <td style="color:#059669"><strong>${fmt(p.amount)}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<p style="color:#9ca3af;font-size:13px">No payments recorded yet.</p>';

  document.getElementById('payment-form-section').style.display = inv.status === 'paid' ? 'none' : 'block';
  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('pay-amount').value = Number(inv.balance_due).toFixed(2);
  document.getElementById('pay-ref').value = '';

  document.getElementById('detail-modal').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-modal').classList.remove('open');
  currentInvoiceId = null;
}

async function recordPayment() {
  const amount = parseFloat(document.getElementById('pay-amount').value);
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }

  const res = await fetch(`/api/invoices/${currentInvoiceId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      payment_method: document.getElementById('pay-method').value,
      payment_date:   document.getElementById('pay-date').value,
      reference_number: document.getElementById('pay-ref').value,
    })
  });
  if (!res.ok) { const r = await res.json(); alert(r.error || 'Failed to record payment'); return; }

  await loadInvoices();
  await loadSummary();
  await openDetail(currentInvoiceId);
}

// ── Print ─────────────────────────────────────────────────────────────────────

async function printInvoiceById(id) {
  const res = await fetch(`/api/invoices/${id}`);
  doPrint(await res.json());
}

function printInvoice() {
  const inv = invoices.find(i => i.id === currentInvoiceId);
  if (inv) doPrint(inv);
}

function doPrint(inv) {
  const customerName  = inv.customers ? inv.customers.name  : (inv.customer_name  || 'Walk-in Customer');
  const customerPhone = inv.customers ? inv.customers.phone : '';
  const customerEmail = inv.customers ? inv.customers.email : '';
  const statusColour  = { unpaid: '#DC2626', partial: '#D97706', paid: '#059669', overdue: '#DC2626' }[inv.status] || '#374151';

  const rows = (inv.items || []).map(item => `
    <tr>
      <td>${item.sku || '—'}</td>
      <td>${item.description}</td>
      <td style="text-align:center">${item.qty}</td>
      <td style="text-align:right">${fmt(item.unit_price)}</td>
      <td style="text-align:right"><strong>${fmt(item.total)}</strong></td>
    </tr>
  `).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Invoice ${inv.invoice_number}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;padding:52px;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px}
    .logo{font-size:38px;font-weight:900;letter-spacing:10px;color:#111}
    .logo-sub{font-size:10px;color:#999;letter-spacing:3px;text-transform:uppercase;margin-top:4px}
    .inv-title{font-size:26px;font-weight:700;letter-spacing:5px;color:#C9A227;margin-bottom:10px;text-align:right}
    .meta{font-size:12px;color:#555;margin-bottom:3px;text-align:right}
    .status-badge{display:inline-block;border:1.5px solid ${statusColour};color:${statusColour};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-left:6px;text-transform:uppercase}
    hr{border:none;border-top:1.5px solid #eee;margin:28px 0}
    .bill-to h3{font-size:10px;letter-spacing:2px;color:#aaa;text-transform:uppercase;margin-bottom:8px}
    .bill-to p{font-size:14px;margin-bottom:3px}
    table{width:100%;border-collapse:collapse;margin:28px 0}
    th{text-align:left;font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.5px;padding:10px 12px;border-bottom:2px solid #111}
    td{padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:13px}
    .totals{display:flex;justify-content:flex-end;margin-bottom:24px}
    .totals-box{width:260px}
    .totals-box tr td{border:none;padding:5px 12px}
    .total-final td{font-weight:700;font-size:16px;border-top:2px solid #111;padding-top:12px}
    .payment-row td{color:#059669;font-weight:600;border-top:1px solid #eee;padding-top:8px}
    .balance-row td{color:#DC2626;font-weight:700;font-size:15px}
    .footer{display:grid;grid-template-columns:1fr 1fr;gap:32px;padding-top:24px;border-top:1px solid #eee}
    .f-label{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
    .thank-you{text-align:center;margin-top:52px;font-size:11px;color:#bbb;letter-spacing:3px;text-transform:uppercase}
  </style></head><body>
  <div class="header">
    <div><div class="logo">LUX</div><div class="logo-sub">Premium Socks</div></div>
    <div>
      <div class="inv-title">INVOICE</div>
      <div class="meta"><strong>Invoice #:</strong> ${inv.invoice_number}</div>
      <div class="meta"><strong>Date:</strong> ${inv.issue_date || new Date().toLocaleDateString('en-MY')}</div>
      <div class="meta"><strong>Due:</strong> ${inv.due_date || '—'}</div>
      <div class="meta"><strong>Status:</strong> <span class="status-badge">${inv.status}</span></div>
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
      <tr><td>Subtotal</td><td style="text-align:right">${fmt(inv.subtotal)}</td></tr>
      <tr class="total-final"><td>Grand Total</td><td style="text-align:right">${fmt(inv.total)}</td></tr>
      <tr class="payment-row"><td>Amount Paid</td><td style="text-align:right">(${fmt(inv.amount_paid)})</td></tr>
      <tr class="balance-row"><td>Balance Due</td><td style="text-align:right">${fmt(inv.balance_due)}</td></tr>
    </table>
  </div>
  <div class="footer">
    <div><div class="f-label">Payment Terms</div><div>${inv.payment_terms || 'Payment due upon order'}</div></div>
    ${inv.notes ? `<div><div class="f-label">Notes</div><div>${inv.notes}</div></div>` : ''}
  </div>
  <div class="thank-you">Thank you for your business</div>
  <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`);
  win.document.close();
}

loadSummary();
loadInvoices();
