let customers = [];
let editingId = null;

async function loadCustomers() {
  const res = await fetch('/api/customers');
  customers = await res.json();
  renderTable();
}

function daysSince(dateStr) {
  if (!dateStr) return 9999;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

function followUpLabel(days) {
  if (days >= 9999) return { text: 'Never contacted', cls: 'urgent' };
  if (days >= 14)   return { text: `${days}d ago`, cls: 'urgent' };
  if (days >= 7)    return { text: `${days}d ago`, cls: 'warn-txt' };
  return              { text: `${days}d ago`, cls: 'ok-txt' };
}

function renderTable() {
  const tbody = document.getElementById('customers-tbody');
  if (!customers.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#9ca3af">No customers yet. Click "Add Customer" to get started.</td></tr>';
    return;
  }

  const sorted = [...customers].sort((a, b) => daysSince(a.last_contact) - daysSince(b.last_contact)).reverse();

  tbody.innerHTML = sorted.map(c => {
    const days = daysSince(c.last_contact);
    const { text, cls } = followUpLabel(days);
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td>${c.phone || '—'}</td>
      <td>${c.email || '—'}</td>
      <td>${c.last_contact || '—'}</td>
      <td class="${cls}">${text}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.notes || ''}">${c.notes || '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-primary" onclick="markContacted('${c.id}')">✓ Contacted</button>
        <button class="btn btn-sm btn-secondary" onclick="openEdit('${c.id}')" style="margin-left:4px">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCustomer('${c.id}')" style="margin-left:4px">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function openAdd() {
  editingId = null;
  document.getElementById('c-modal-title').textContent = 'Add Customer';
  document.getElementById('c-form').reset();
  document.getElementById('c-modal').classList.add('open');
}

function openEdit(id) {
  const c = customers.find(x => x.id === id);
  editingId = id;
  document.getElementById('c-modal-title').textContent = 'Edit Customer';
  document.getElementById('c-name').value  = c.name;
  document.getElementById('c-phone').value = c.phone || '';
  document.getElementById('c-email').value = c.email || '';
  document.getElementById('c-notes').value = c.notes || '';
  document.getElementById('c-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('c-modal').classList.remove('open');
}

async function saveCustomer() {
  const body = {
    name:  document.getElementById('c-name').value.trim(),
    type:  'retail',
    phone: document.getElementById('c-phone').value.trim(),
    email: document.getElementById('c-email').value.trim(),
    notes: document.getElementById('c-notes').value.trim(),
  };
  if (!body.name) { alert('Name is required.'); return; }

  const url    = editingId ? `/api/customers/${editingId}` : '/api/customers';
  const method = editingId ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const r = await res.json(); alert(r.error || 'Failed to save'); return; }
  closeModal();
  loadCustomers();
}

async function markContacted(id) {
  await fetch(`/api/customers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_contact: new Date().toISOString().split('T')[0] })
  });
  loadCustomers();
}

async function deleteCustomer(id) {
  if (!confirm('Delete this customer?')) return;
  const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
  if (!res.ok) { const r = await res.json(); alert(r.error || 'Could not delete'); return; }
  loadCustomers();
}

loadCustomers();
