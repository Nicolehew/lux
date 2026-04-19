const fmt = n => 'RM' + Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtShort = n => {
  if (n >= 1000000) return 'RM' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return 'RM' + (n / 1000).toFixed(1) + 'K';
  return fmt(n);
};

// ── State ─────────────────────────────────────────────────────────────────────
let currentRange = 'today';
let trendChart = null;
let topChart = null;
let refreshTimer = null;
let countdown = 60;

// ── Date ──────────────────────────────────────────────────────────────────────
document.getElementById('current-date').textContent = new Date().toLocaleDateString('en-MY', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// ── Range filter ──────────────────────────────────────────────────────────────
function setRange(range) {
  currentRange = range;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.range === range);
  });
  refreshAll();
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────
function startRefreshTimer() {
  clearInterval(refreshTimer);
  countdown = 60;
  updateCountdownDisplay();
  refreshTimer = setInterval(() => {
    countdown--;
    updateCountdownDisplay();
    if (countdown <= 0) {
      countdown = 60;
      refreshAll();
    }
  }, 1000);
}

function updateCountdownDisplay() {
  const el = document.getElementById('refresh-countdown');
  if (el) el.textContent = `↻ ${countdown}s`;
}

// ── Refresh all sections ──────────────────────────────────────────────────────
function refreshAll() {
  loadKPIs();
  loadTrend();
  loadTopProducts();
  loadInvoiceStatus();
  loadLowStock();
  loadFollowUps();
  loadRecentSales();
  startRefreshTimer();
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
async function loadKPIs() {
  try {
    const res = await fetch(`/api/dashboard/kpis?period=${currentRange}`);
    if (!res.ok) throw new Error();
    const d = await res.json();

    document.getElementById('kpi-revenue').textContent = fmtShort(d.revenue ?? 0);
    document.getElementById('kpi-revenue-sub').textContent =
      currentRange === 'today' ? 'Today' :
      currentRange === 'week'  ? 'This week' :
      currentRange === 'month' ? 'This month' : 'This quarter';

    document.getElementById('kpi-orders').textContent = d.orders ?? 0;
    document.getElementById('kpi-orders-sub').textContent = 'units sold';

    const aov = d.orders > 0 ? (d.revenue / d.orders) : 0;
    document.getElementById('kpi-aov').textContent = fmtShort(aov);
    document.getElementById('kpi-aov-sub').textContent = 'per order';

    document.getElementById('kpi-outstanding').textContent = fmtShort(d.outstanding ?? 0);
    const overdueCount = d.overdue ?? 0;
    document.getElementById('kpi-outstanding-sub').textContent =
      overdueCount > 0 ? overdueCount + ' overdue ⚠️' : 'all current';
  } catch {
    ['kpi-revenue','kpi-orders','kpi-aov','kpi-outstanding'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
  }
}

// ── 30-Day Trend Chart ────────────────────────────────────────────────────────
async function loadTrend() {
  try {
    const res = await fetch('/api/dashboard/trends');
    if (!res.ok) throw new Error();
    const allRows = await res.json(); // [{ date, revenue }]

    // Trim leading zeros — only show from first day with data (or last 14 days min)
    const firstNonZero = allRows.findIndex(r => Number(r.revenue) > 0);
    const startIdx = firstNonZero >= 0 ? Math.max(0, firstNonZero - 2) : Math.max(0, allRows.length - 14);
    const rows = allRows.slice(startIdx);

    const labels = rows.map(r => {
      const d = new Date(r.date + 'T00:00:00');
      return (d.getMonth() + 1) + '/' + d.getDate();
    });
    const data = rows.map(r => Number(r.revenue));
    const hasData = data.some(v => v > 0);

    const titleEl = document.getElementById('trend-title');
    if (titleEl) titleEl.textContent = '30-Day Revenue Trend';

    const ctx = document.getElementById('trendChart').getContext('2d');
    if (trendChart) trendChart.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const tickColor = isDark ? '#55556A' : '#9CA3AF';

    trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Revenue (RM)',
          data,
          borderColor: '#C9A227',
          backgroundColor: 'rgba(201,162,39,0.08)',
          borderWidth: 2,
          pointRadius: data.map(v => v > 0 ? 4 : 1),
          pointBackgroundColor: data.map(v => v > 0 ? '#C9A227' : 'transparent'),
          pointHoverRadius: 6,
          fill: true,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } }
        },
        scales: {
          x: {
            ticks: { color: tickColor, font: { size: 10 }, maxTicksLimit: 12 },
            grid: { color: gridColor }
          },
          y: {
            ticks: { color: tickColor, font: { size: 10 }, callback: v => fmtShort(v) },
            grid: { color: gridColor },
            beginAtZero: true,
            suggestedMax: hasData ? undefined : 100
          }
        }
      }
    });
  } catch {
    // silent — chart stays blank
  }
}

// ── Top Products Chart ────────────────────────────────────────────────────────
async function loadTopProducts() {
  try {
    const res = await fetch(`/api/dashboard/top-products?period=${currentRange}`);
    if (!res.ok) throw new Error();
    const rows = await res.json(); // [{ sku, qty }]

    if (!rows.length) return;

    const ctx = document.getElementById('topChart').getContext('2d');
    if (topChart) topChart.destroy();

    const isDarkTop = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColorTop = isDarkTop ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const tickColorTop = isDarkTop ? '#55556A' : '#9CA3AF';

    topChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.sku),
        datasets: [{
          label: 'Units Sold',
          data: rows.map(r => r.qty),
          backgroundColor: rows.map((_, i) =>
            i === 0 ? '#C9A227' : i === 1 ? '#a07d1e' : i === 2 ? '#7a5e15' : '#4a3a0d'
          ),
          borderRadius: 6,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: tickColorTop, font: { size: 10 } },
            grid: { color: gridColorTop },
            beginAtZero: true
          },
          y: {
            ticks: { color: isDarkTop ? '#9090A8' : '#4B5563', font: { size: 11 } },
            grid: { display: false }
          }
        }
      }
    });
  } catch {
    // silent
  }
}

// ── Invoice Status ────────────────────────────────────────────────────────────
async function loadInvoiceStatus() {
  try {
    const res = await fetch('/api/dashboard/invoice-status');
    if (!res.ok) throw new Error();
    const d = await res.json();
    document.getElementById('inv-s-unpaid').textContent = d.unpaid ?? 0;
    document.getElementById('inv-s-partial').textContent = d.partial ?? 0;
    document.getElementById('inv-s-overdue').textContent = d.overdue ?? 0;
    document.getElementById('inv-s-paid').textContent = d.paid ?? 0;
    document.getElementById('inv-s-total').textContent = d.total ?? 0;
    document.getElementById('inv-s-collected').textContent = fmtShort(d.collected ?? 0);
  } catch {
    // silent
  }
}

// ── Low Stock ─────────────────────────────────────────────────────────────────
async function loadLowStock() {
  try {
    const res = await fetch('/api/products');
    const products = await res.json();
    const low = products.filter(p => (p.online_stock + p.physical_stock) < 10);

    if (low.length) {
      document.getElementById('low-stock-count').textContent = `(${low.length})`;
      document.getElementById('low-stock').innerHTML = `
        <table>
          <thead><tr><th>SKU</th><th>Online</th><th>Total</th></tr></thead>
          <tbody>
            ${low.map(p => {
              const total = p.online_stock + p.physical_stock;
              return `<tr>
                <td><strong>${p.sku}</strong></td>
                <td>${p.online_stock}</td>
                <td><span class="badge ${total === 0 ? 'badge-low' : 'badge-warn'}">${total} left</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    } else {
      document.getElementById('low-stock-count').textContent = '';
      document.getElementById('low-stock').innerHTML = '<div class="empty-state"><p>All stock levels OK ✓</p></div>';
    }
  } catch {
    // silent
  }
}

// ── Follow-ups ────────────────────────────────────────────────────────────────
async function loadFollowUps() {
  try {
    const res = await fetch('/api/customers');
    const customers = await res.json();
    const today = new Date();

    const needFollowUp = customers
      .map(c => {
        const days = c.last_contact
          ? Math.floor((today - new Date(c.last_contact)) / 86400000)
          : 9999;
        return { ...c, days };
      })
      .filter(c => c.days >= 7)
      .sort((a, b) => b.days - a.days);

    if (needFollowUp.length) {
      document.getElementById('followup-count').textContent = `(${needFollowUp.length})`;
      document.getElementById('followup-list').innerHTML = `
        <table>
          <thead><tr><th>Customer</th><th>Phone</th><th>Last Contact</th><th>Days Ago</th><th></th></tr></thead>
          <tbody>
            ${needFollowUp.map(c => `
              <tr>
                <td><strong>${c.name}</strong></td>
                <td>${c.phone || '—'}</td>
                <td>${c.last_contact || 'Never'}</td>
                <td class="${c.days >= 14 ? 'urgent' : 'warn-txt'}">${c.days >= 9999 ? 'Never' : c.days + 'd'}</td>
                <td><a href="/customers.html" class="btn btn-sm btn-secondary">View</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    } else {
      document.getElementById('followup-count').textContent = '';
      document.getElementById('followup-list').innerHTML = '<div class="empty-state"><p>No follow-ups needed</p></div>';
    }
  } catch {
    // silent
  }
}

// ── Recent Sales ──────────────────────────────────────────────────────────────
async function loadRecentSales() {
  try {
    const res = await fetch('/api/sales?limit=10');
    const sales = await res.json();
    if (!sales.length) {
      document.getElementById('recent-sales').innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:28px;color:#9ca3af">No sales recorded yet</td></tr>';
      return;
    }
    document.getElementById('recent-sales').innerHTML = sales.map(s => `
      <tr>
        <td>${s.sale_date}</td>
        <td><strong>${s.products ? s.products.sku : '—'}</strong></td>
        <td>${s.quantity}</td>
        <td><span class="badge badge-online">online</span></td>
        <td>${s.customers ? s.customers.name : '—'}</td>
        <td>${fmt(s.total)}</td>
      </tr>
    `).join('');
  } catch {
    document.getElementById('recent-sales').innerHTML =
      '<tr><td colspan="6" style="text-align:center;padding:28px;color:#9ca3af">Could not load sales</td></tr>';
  }
}

// ── Export PNG ────────────────────────────────────────────────────────────────
function exportPNG() {
  // Use the browser's built-in print-to-PDF / screenshot capability
  // We'll capture via a simple approach: hide sidebar and print
  const btn = document.querySelector('.export-btn');
  btn.textContent = 'Preparing…';
  btn.disabled = true;

  // Give a moment for any pending renders
  setTimeout(() => {
    window.print();
    btn.textContent = '⬇ Export PNG';
    btn.disabled = false;
  }, 300);
}

// ── Init ──────────────────────────────────────────────────────────────────────
refreshAll();
