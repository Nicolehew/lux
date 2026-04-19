let members = [];
let filtered = [];
let editingId = null;
let pointsMemberId = null;
let cardMemberId = null;

const TIER = {
  vip:     { label: 'VIP',     bg: '#C9A227', color: '#111' },
  gold:    { label: 'Gold',    bg: '#b8901f', color: '#fff' },
  silver:  { label: 'Silver',  bg: '#6b7280', color: '#fff' },
  regular: { label: 'Regular', bg: '#374151', color: '#fff' },
};

async function loadMembers() {
  try {
    const res = await fetch('/api/members');
    members = await res.json();
    filtered = members;
    renderStats();
    renderTable();
  } catch {
    document.getElementById('members-tbody').innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:32px;color:#DC2626">Could not connect to server. Is it running?</td></tr>';
  }
}

function renderStats() {
  document.getElementById('stat-total').textContent  = members.length;
  document.getElementById('stat-vip').textContent    = members.filter(m => m.tier === 'vip').length;
  document.getElementById('stat-gold').textContent   = members.filter(m => m.tier === 'gold').length;
  document.getElementById('stat-silver').textContent = members.filter(m => m.tier === 'silver').length;
}

function tierBadge(tier) {
  const t = TIER[tier] || TIER.regular;
  return `<span class="badge" style="background:${t.bg};color:${t.color}">${t.label}</span>`;
}

function renderTable() {
  const tbody = document.getElementById('members-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:#9ca3af">No members yet.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(m => `
    <tr>
      <td><strong>${m.member_id}</strong></td>
      <td>${m.name}</td>
      <td>${m.phone || '—'}</td>
      <td>${m.email || '—'}</td>
      <td>${tierBadge(m.tier)}</td>
      <td><strong style="color:#C9A227">${m.points}</strong> pts</td>
      <td>${m.join_date || '—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm btn-primary" onclick="openCard('${m.id}')">Card</button>
        <button class="btn btn-sm btn-secondary" onclick="openPts('${m.id}')" style="margin-left:4px">Points</button>
        <button class="btn btn-sm btn-secondary" onclick="openEdit('${m.id}')" style="margin-left:4px">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteMember('${m.id}')" style="margin-left:4px">✕</button>
      </td>
    </tr>
  `).join('');
}

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('search-box').addEventListener('input', function () {
  const q = this.value.toLowerCase();
  filtered = q ? members.filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.member_id.toLowerCase().includes(q) ||
    (m.phone || '').includes(q) ||
    (m.email || '').toLowerCase().includes(q)
  ) : members;
  renderTable();
});

// ── Add / Edit ────────────────────────────────────────────────────────────────

function openAdd() {
  editingId = null;
  document.getElementById('m-modal-title').textContent = 'Add Member';
  document.getElementById('m-form').reset();
  document.getElementById('m-modal').classList.add('open');
}

function openEdit(id) {
  const m = members.find(x => x.id === id);
  editingId = id;
  document.getElementById('m-modal-title').textContent = 'Edit Member';
  document.getElementById('m-name').value  = m.name;
  document.getElementById('m-phone').value = m.phone || '';
  document.getElementById('m-email').value = m.email || '';
  document.getElementById('m-notes').value = m.notes || '';
  document.getElementById('m-modal').classList.add('open');
}

function closeModal() { document.getElementById('m-modal').classList.remove('open'); }

async function saveMember() {
  const body = {
    name:  document.getElementById('m-name').value.trim(),
    phone: document.getElementById('m-phone').value.trim(),
    email: document.getElementById('m-email').value.trim(),
    notes: document.getElementById('m-notes').value.trim(),
  };
  if (!body.name) { alert('Name is required.'); return; }

  const url    = editingId ? `/api/members/${editingId}` : '/api/members';
  const method = editingId ? 'PATCH' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const r = await res.json(); alert(r.error || 'Failed to save'); return; }
  closeModal();
  loadMembers();
}

async function deleteMember(id) {
  if (!confirm('Remove this member?')) return;
  await fetch(`/api/members/${id}`, { method: 'DELETE' });
  loadMembers();
}

// ── Points ────────────────────────────────────────────────────────────────────

function openPts(id) {
  const m = members.find(x => x.id === id);
  pointsMemberId = id;
  document.getElementById('pts-member-name').textContent = `${m.name} · ${m.member_id}`;
  document.getElementById('pts-current').textContent = m.points;
  document.getElementById('pts-input').value = 10;
  document.getElementById('pts-modal').classList.add('open');
}

function closePts() { document.getElementById('pts-modal').classList.remove('open'); }

function stepPts(delta) {
  const inp = document.getElementById('pts-input');
  inp.value = Math.max(1, (parseInt(inp.value) || 0) + Math.abs(delta));
}

async function applyPoints(sign) {
  const amount = parseInt(document.getElementById('pts-input').value) || 0;
  if (!amount) { alert('Enter a points amount.'); return; }
  const res = await fetch(`/api/members/${pointsMemberId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: sign * amount })
  });
  if (!res.ok) { const r = await res.json(); alert(r.error || 'Failed'); return; }
  closePts();
  loadMembers();
}

// ── Member Card ───────────────────────────────────────────────────────────────

function openCard(id) {
  const m = members.find(x => x.id === id);
  cardMemberId = id;
  const t = TIER[m.tier] || TIER.regular;
  document.getElementById('card-name').textContent    = m.name;
  document.getElementById('card-id').textContent      = m.member_id;
  document.getElementById('card-points').textContent  = m.points + ' pts';
  document.getElementById('card-joined').textContent  = m.join_date || '—';
  const badge = document.getElementById('card-tier-badge');
  badge.textContent = t.label;
  badge.style.background = t.bg;
  badge.style.color = t.color;
  document.getElementById('card-modal').classList.add('open');
}

function closeCard() { document.getElementById('card-modal').classList.remove('open'); }

function printCard() {
  const m = members.find(x => x.id === cardMemberId);
  const t = TIER[m.tier] || TIER.regular;
  const win = window.open('', '_blank', 'width=440,height=280');
  win.document.write(`<!DOCTYPE html><html><head><title>Member Card</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#111;border-radius:16px;padding:28px 32px;width:380px;color:#fff}
    .logo{font-size:22px;font-weight:900;letter-spacing:6px;color:#C9A227}
    .tier{font-size:11px;font-weight:700;letter-spacing:1px;padding:3px 10px;border-radius:20px;text-transform:uppercase;background:${t.bg};color:${t.color}}
    .name{font-size:20px;font-weight:700;margin:20px 0 4px}
    .mid{font-size:12px;color:#888;margin-bottom:20px}
    .pts-label{font-size:10px;color:#666;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px}
    .pts{font-size:28px;font-weight:700;color:#C9A227}
    .since{font-size:12px;color:#888;text-align:right}
  </style></head><body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <div class="logo">LUX</div><div class="tier">${t.label}</div>
    </div>
    <div class="name">${m.name}</div>
    <div class="mid">${m.member_id}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><div class="pts-label">Points Balance</div><div class="pts">${m.points} pts</div></div>
      <div><div class="pts-label" style="text-align:right">Member Since</div><div class="since">${m.join_date || '—'}</div></div>
    </div>
  </div>
  <script>window.onload=()=>{window.print()}<\/script></body></html>`);
  win.document.close();
}

loadMembers();
