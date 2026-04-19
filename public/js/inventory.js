const fmt = n => 'RM' + Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let products = [];
let editingId = null;
let saleProductId = null;
let soldCounts = {};

async function loadProducts() {
  const [pRes, sRes] = await Promise.all([
    fetch('/api/products'),
    fetch('/api/sales?limit=9999')
  ]);
  products = await pRes.json();
  const sales = await sRes.json();

  soldCounts = {};
  sales.forEach(s => {
    soldCounts[s.product_id] = (soldCounts[s.product_id] || 0) + s.quantity;
  });

  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('products-tbody');
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:#9ca3af">No products yet. Click "Add Product" to get started.</td></tr>';
    return;
  }

  tbody.innerHTML = products.map(p => {
    const stock = p.online_stock;
    const sold = soldCounts[p.id] || 0;
    const stockBadge = stock === 0 ? 'badge-low' : stock < 10 ? 'badge-warn' : 'badge-ok';
    return `<tr>
      <td><strong>${p.sku}</strong></td>
      <td>${p.style}</td>
      <td>${p.color}</td>
      <td>${p.size}</td>
      <td>${fmt(p.wholesale_price)}</td>
      <td><span class="badge ${stockBadge}">${stock} pairs</span></td>
      <td><strong>${sold}</strong> pairs</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-primary" onclick="openSaleModal('${p.id}')">Record Sale</button>
        <button class="btn btn-sm btn-secondary" onclick="openEditModal('${p.id}')" style="margin-left:4px">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteProduct('${p.id}')" style="margin-left:4px">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Add / Edit Product ────────────────────────────────────────────────────────

function openAddModal() {
  editingId = null;
  document.getElementById('product-modal-title').textContent = 'Add Product';
  document.getElementById('product-form').reset();
  document.getElementById('p-style').value = 'Angel Wings';
  document.getElementById('product-modal').classList.add('open');
}

function openEditModal(id) {
  const p = products.find(x => x.id === id);
  editingId = id;
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  document.getElementById('p-style').value = p.style;
  document.getElementById('p-color').value = p.color;
  document.getElementById('p-size').value = p.size;
  document.getElementById('p-wholesale').value = p.wholesale_price;
  document.getElementById('p-online').value = p.online_stock;
  document.getElementById('product-modal').classList.add('open');
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
}

async function saveProduct() {
  const body = {
    style: document.getElementById('p-style').value.trim(),
    color: document.getElementById('p-color').value,
    size: document.getElementById('p-size').value,
    wholesale_price: parseFloat(document.getElementById('p-wholesale').value),
    online_stock: parseInt(document.getElementById('p-online').value) || 0,
    physical_stock: 0,
  };
  if (!body.style || isNaN(body.wholesale_price)) { alert('Please fill in all required fields.'); return; }

  const url = editingId ? `/api/products/${editingId}` : '/api/products';
  const method = editingId ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) { alert(result.error || 'Failed to save product'); return; }
  closeProductModal();
  loadProducts();
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
  if (!res.ok) { const r = await res.json(); alert(r.error || 'Could not delete — it may have sales records.'); return; }
  loadProducts();
}

// ── Record Sale ───────────────────────────────────────────────────────────────

function openSaleModal(id) {
  saleProductId = id;
  const p = products.find(x => x.id === id);
  document.getElementById('sale-product-name').textContent = `${p.sku} — ${p.style} ${p.color} ${p.size}`;
  document.getElementById('sale-unit-display').textContent = fmt(p.wholesale_price);
  document.getElementById('s-quantity').value = 1;
  document.getElementById('sale-modal').classList.add('open');
  updateSaleTotal();
}

function closeSaleModal() {
  document.getElementById('sale-modal').classList.remove('open');
}

function updateSaleTotal() {
  const p = products.find(x => x.id === saleProductId);
  if (!p) return;
  const qty = parseInt(document.getElementById('s-quantity').value) || 0;
  document.getElementById('sale-unit-price-preview').textContent = fmt(p.wholesale_price);
  document.getElementById('sale-total-preview').textContent = fmt(qty * p.wholesale_price);
}

async function recordSale() {
  const p = products.find(x => x.id === saleProductId);
  const qty = parseInt(document.getElementById('s-quantity').value);
  if (!qty || qty < 1) { alert('Please enter a valid quantity.'); return; }

  const res = await fetch('/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: saleProductId, quantity: qty, channel: 'online', unit_price: p.wholesale_price })
  });
  const result = await res.json();
  if (!res.ok) { alert(result.error || 'Failed to record sale'); return; }

  closeSaleModal();
  loadProducts();

  // Show invoice confirmation
  if (result.invoice_number) {
    showSaleConfirmation(result.invoice_number, qty, p);
  }
}

function showSaleConfirmation(invoiceNumber, qty, product) {
  // Remove any existing toast
  const existing = document.getElementById('sale-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'sale-toast';
  toast.style.cssText = `
    position:fixed; bottom:28px; right:28px; z-index:9999;
    background:#141414; border:1px solid #C9A227;
    border-radius:10px; padding:16px 20px; min-width:280px;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);
    animation: slideUp 0.25s ease;
  `;
  toast.innerHTML = `
    <div style="font-size:11px;color:#C9A227;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">
      ✓ Sale Recorded
    </div>
    <div style="font-size:14px;color:#fff;margin-bottom:4px">
      <strong>${qty}× ${product.sku}</strong>
    </div>
    <div style="font-size:12px;color:#888">
      Invoice <strong style="color:#60a5fa">${invoiceNumber}</strong> created automatically
    </div>
    <div style="margin-top:10px;display:flex;gap:8px">
      <a href="/invoices.html" style="font-size:12px;color:#C9A227;text-decoration:none;border:1px solid #C9A227;padding:4px 10px;border-radius:5px">View Invoice</a>
      <button onclick="document.getElementById('sale-toast').remove()" style="font-size:12px;background:transparent;border:1px solid #333;color:#666;padding:4px 10px;border-radius:5px;cursor:pointer">Dismiss</button>
    </div>
  `;

  // Add keyframe animation
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `@keyframes slideUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  // Auto-dismiss after 6 seconds
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 6000);
}

loadProducts();
