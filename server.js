require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'lux-internal-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// Serve login page without auth
app.use((req, res, next) => {
  const publicPaths = ['/login.html', '/api/login', '/api/me', '/css/', '/js/'];
  const isPublic = publicPaths.some(p => req.path.startsWith(p));
  if (isPublic || req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/api/me', (req, res) => res.json({ authenticated: !!req.session.authenticated }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong username or password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Products ──────────────────────────────────────────────────────────────────

app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('style')
    .order('color')
    .order('size');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/products', async (req, res) => {
  const { style, color, size, wholesale_price, online_stock, physical_stock } = req.body;
  const colorCode = { '黑': 'BLK', '白': 'WHT', '灰': 'GRY' }[color] || color.substring(0, 3).toUpperCase();
  const styleCode = style.split(' ').map(w => w[0]).join('').toUpperCase();
  const sku = `${styleCode}-${colorCode}-${size.toUpperCase().replace(' ', '')}`;
  const { data, error } = await supabase
    .from('products')
    .insert([{ sku, style, color, size, wholesale_price: Number(wholesale_price), online_stock: Number(online_stock) || 0, physical_stock: Number(physical_stock) || 0 }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/products/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('products').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/products/:id', async (req, res) => {
  const { error } = await supabase.from('products').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Sales ─────────────────────────────────────────────────────────────────────

app.get('/api/sales', async (req, res) => {
  const { start, end, limit = 50 } = req.query;
  let query = supabase
    .from('sales')
    .select('*, products(sku, style, color, size), customers(name, type)')
    .order('created_at', { ascending: false })
    .limit(Number(limit));
  if (start) query = query.gte('sale_date', start);
  if (end) query = query.lte('sale_date', end);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/sales', async (req, res) => {
  const { product_id, customer_id, quantity, channel, unit_price } = req.body;
  const qty = Number(quantity);
  const price = Number(unit_price);

  // Fetch full product details (needed for auto-invoice)
  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('online_stock, physical_stock, sku, style, color, size')
    .eq('id', product_id).single();
  if (pErr) return res.status(500).json({ error: pErr.message });

  const stockField = channel === 'online' ? 'online_stock' : 'physical_stock';
  const currentStock = product[stockField];
  if (currentStock < qty) {
    return res.status(400).json({ error: `Not enough ${channel} stock (have ${currentStock} pairs)` });
  }

  // Record sale
  const { data: sale, error: sErr } = await supabase
    .from('sales')
    .insert([{
      product_id,
      customer_id: customer_id || null,
      quantity: qty,
      channel,
      unit_price: price,
      total: qty * price,
      sale_date: new Date().toISOString().split('T')[0]
    }])
    .select().single();
  if (sErr) return res.status(500).json({ error: sErr.message });

  // Deduct stock
  await supabase.from('products').update({ [stockField]: currentStock - qty }).eq('id', product_id);

  // Auto-create invoice (type: direct_sale)
  const { count: invCount } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
  const invoiceNumber = `INV-${String((invCount || 0) + 1).padStart(4, '0')}`;
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const lineTotal = qty * price;

  const { data: invoice, error: invErr } = await supabase.from('invoices').insert([{
    invoice_number: invoiceNumber,
    customer_id: customer_id || null,
    customer_type: 'retail',
    items: [{ sku: product.sku, description: `${product.style} ${product.color} ${product.size}`, qty, unit_price: price, total: lineTotal }],
    subtotal: lineTotal,
    total: lineTotal,
    amount_paid: 0,
    balance_due: lineTotal,
    status: 'unpaid',
    source: 'direct_sale',
    payment_terms: 'Payment due upon order',
    issue_date: new Date().toISOString().split('T')[0],
    due_date: dueDate
  }]).select().single();

  if (invErr) console.error('[invoice auto-create error]', invErr.message);
  res.json({ ...sale, invoice_number: invoice?.invoice_number });
});

app.get('/api/sales/summary', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [todayData, weekData, monthData, topData] = await Promise.all([
    supabase.from('sales').select('total').gte('sale_date', today),
    supabase.from('sales').select('total').gte('sale_date', weekAgo),
    supabase.from('sales').select('total').gte('sale_date', monthAgo),
    supabase.from('sales').select('quantity, products(sku, style, color, size)').gte('sale_date', monthAgo)
  ]);

  const sum = arr => (arr || []).reduce((s, r) => s + Number(r.total), 0);

  const topMap = {};
  (topData.data || []).forEach(s => {
    if (!s.products) return;
    const key = s.products.sku;
    if (!topMap[key]) topMap[key] = { ...s.products, qty: 0 };
    topMap[key].qty += s.quantity;
  });
  const topProducts = Object.values(topMap).sort((a, b) => b.qty - a.qty).slice(0, 5);

  res.json({
    today: sum(todayData.data),
    week: sum(weekData.data),
    month: sum(monthData.data),
    topProducts
  });
});

// ── Customers ─────────────────────────────────────────────────────────────────

app.get('/api/customers', async (req, res) => {
  const { data, error } = await supabase
    .from('customers').select('*').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/customers', async (req, res) => {
  const { data, error } = await supabase
    .from('customers').insert([req.body]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/customers/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('customers').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/customers/:id', async (req, res) => {
  const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Quotes ────────────────────────────────────────────────────────────────────

app.get('/api/quotes', async (req, res) => {
  const { data, error } = await supabase
    .from('quotes').select('*, customers(name)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/quotes/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('quotes').select('*, customers(name, phone, email)').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/quotes', async (req, res) => {
  const { count } = await supabase.from('quotes').select('*', { count: 'exact', head: true });
  const quoteNumber = `LUX-${String((count || 0) + 1).padStart(4, '0')}`;
  const { data, error } = await supabase
    .from('quotes').insert([{ ...req.body, quote_number: quoteNumber }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/quotes/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('quotes').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Invoices ──────────────────────────────────────────────────────────────────

app.get('/api/invoices', async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, customers(name, type)')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/invoices/summary', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const [allInv, monthPay] = await Promise.all([
    supabase.from('invoices').select('status, balance_due, total'),
    supabase.from('payments').select('amount').gte('payment_date', monthStart)
  ]);

  const invoices = allInv.data || [];
  const outstanding = invoices.filter(i => i.status !== 'paid' && i.status !== 'overdue').reduce((s, i) => s + Number(i.balance_due), 0);
  const overdue    = invoices.filter(i => i.status === 'overdue').length;
  const collectedMonth = (monthPay.data || []).reduce((s, p) => s + Number(p.amount), 0);

  res.json({ outstanding, overdue, collectedMonth });
});

app.get('/api/invoices/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('invoices').select('*, customers(name, phone, email)').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/invoices', async (req, res) => {
  const { count } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
  const invoiceNumber = `INV-${String((count || 0) + 1).padStart(4, '0')}`;
  const body = { ...req.body, invoice_number: invoiceNumber };
  body.balance_due = Number(body.total) - Number(body.amount_paid || 0);
  const { data, error } = await supabase.from('invoices').insert([body]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/invoices/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('invoices').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Convert quote → invoice
app.post('/api/quotes/:id/convert', async (req, res) => {
  const { data: quote, error: qErr } = await supabase
    .from('quotes').select('*, customers(name)').eq('id', req.params.id).single();
  if (qErr) return res.status(500).json({ error: qErr.message });

  const { count } = await supabase.from('invoices').select('*', { count: 'exact', head: true });
  const invoiceNumber = `INV-${String((count || 0) + 1).padStart(4, '0')}`;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const { data: invoice, error: iErr } = await supabase
    .from('invoices')
    .insert([{
      invoice_number: invoiceNumber,
      quote_id: quote.id,
      customer_id: quote.customer_id,
      customer_name: quote.customer_name,
      customer_type: quote.customer_type,
      items: quote.items,
      subtotal: quote.subtotal,
      total: quote.total,
      amount_paid: 0,
      balance_due: quote.total,
      notes: quote.notes,
      payment_terms: quote.payment_terms,
      status: 'unpaid',
      source: 'quote_conversion',
      issue_date: new Date().toISOString().split('T')[0],
      due_date: dueDate.toISOString().split('T')[0]
    }])
    .select().single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  await supabase.from('quotes').update({ status: 'accepted' }).eq('id', quote.id);
  res.json(invoice);
});

// Mark overdue invoices — must be defined BEFORE /:id routes
app.post('/api/invoices/mark-overdue', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('invoices').update({ status: 'overdue' })
    .lt('due_date', today).in('status', ['unpaid', 'partial']).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ updated: data?.length || 0 });
});

// ── Payments ──────────────────────────────────────────────────────────────────

app.get('/api/invoices/:id/payments', async (req, res) => {
  const { data, error } = await supabase
    .from('payments').select('*').eq('invoice_id', req.params.id)
    .order('payment_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/invoices/:id/payments', async (req, res) => {
  const invoiceId = req.params.id;
  const { data: inv, error: iErr } = await supabase
    .from('invoices').select('total, amount_paid').eq('id', invoiceId).single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  const { data: payment, error: pErr } = await supabase
    .from('payments')
    .insert([{ invoice_id: invoiceId, ...req.body, amount: Number(req.body.amount) }])
    .select().single();
  if (pErr) return res.status(500).json({ error: pErr.message });

  const newPaid    = Number(inv.amount_paid) + Number(req.body.amount);
  const newBalance = Math.max(0, Number(inv.total) - newPaid);
  const newStatus  = newBalance <= 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

  await supabase.from('invoices').update({
    amount_paid: newPaid,
    balance_due: newBalance,
    status: newStatus
  }).eq('id', invoiceId);

  res.json(payment);
});

// ── Dashboard API ─────────────────────────────────────────────────────────────

app.get('/api/dashboard/kpis', async (req, res) => {
  const { period = 'month' } = req.query;
  const now = new Date();
  const toISO = d => d.toISOString().split('T')[0];
  const today = toISO(now);

  let start, prevStart, prevEnd;
  if (period === 'today') {
    start = today;
    const yesterday = new Date(now - 86400000);
    prevStart = prevEnd = toISO(yesterday);
  } else if (period === 'week') {
    start = toISO(new Date(now - 7 * 86400000));
    prevStart = toISO(new Date(now - 14 * 86400000));
    prevEnd = toISO(new Date(now - 7 * 86400000));
  } else if (period === 'quarter') {
    start = toISO(new Date(now - 90 * 86400000));
    prevStart = toISO(new Date(now - 180 * 86400000));
    prevEnd = toISO(new Date(now - 90 * 86400000));
  } else { // month default
    start = toISO(new Date(now - 30 * 86400000));
    prevStart = toISO(new Date(now - 60 * 86400000));
    prevEnd = toISO(new Date(now - 30 * 86400000));
  }

  const [curr, prev, todaySales, openInv] = await Promise.all([
    supabase.from('sales').select('total, quantity').gte('sale_date', start),
    supabase.from('sales').select('total').gte('sale_date', prevStart).lte('sale_date', prevEnd),
    supabase.from('sales').select('total').eq('sale_date', today),
    supabase.from('invoices').select('balance_due, status').in('status', ['unpaid', 'partial', 'overdue'])
  ]);

  const sum = arr => (arr || []).reduce((s, r) => s + Number(r.total), 0);
  const revenue = sum(curr.data);
  const prevRevenue = sum(prev.data);
  const orders = (curr.data || []).length;
  const todayRevenue = sum(todaySales.data);
  const aov = orders > 0 ? revenue / orders : 0;
  const outstanding = (openInv.data || []).reduce((s, r) => s + Number(r.balance_due), 0);
  const overdue = (openInv.data || []).filter(r => r.status === 'overdue').length;

  res.json({ revenue, prevRevenue, orders, aov, todayRevenue, outstanding, overdue });
});

app.get('/api/dashboard/trends', async (req, res) => {
  const { days = 30 } = req.query;
  const startDate = new Date(Date.now() - Number(days) * 86400000).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('sales').select('sale_date, total').gte('sale_date', startDate).order('sale_date');
  if (error) return res.status(500).json({ error: error.message });

  const map = {};
  (data || []).forEach(s => {
    if (!map[s.sale_date]) map[s.sale_date] = { date: s.sale_date, revenue: 0, orders: 0 };
    map[s.sale_date].revenue += Number(s.total);
    map[s.sale_date].orders += 1;
  });

  const result = [];
  for (let i = Number(days) - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    result.push(map[d] || { date: d, revenue: 0, orders: 0 });
  }
  res.json(result);
});

app.get('/api/dashboard/top-products', async (req, res) => {
  const { period = 'month' } = req.query;
  const days = period === 'today' ? 1 : period === 'week' ? 7 : period === 'quarter' ? 90 : 30;
  const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('sales').select('product_id, quantity, total, products(sku, style, color, size)').gte('sale_date', start);
  if (error) return res.status(500).json({ error: error.message });

  const map = {};
  (data || []).forEach(s => {
    if (!s.products) return;
    if (!map[s.product_id]) map[s.product_id] = { sku: s.products.sku, name: `${s.products.style} ${s.products.color} ${s.products.size}`, qty: 0, revenue: 0 };
    map[s.product_id].qty += s.quantity;
    map[s.product_id].revenue += Number(s.total);
  });
  res.json(Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5));
});

app.get('/api/dashboard/invoice-status', async (req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const monthStr = startOfMonth.toISOString().split('T')[0];

  const [allRes, collectedRes] = await Promise.all([
    supabase.from('invoices').select('status, source'),
    supabase.from('invoice_payments').select('amount').gte('payment_date', monthStr)
  ]);
  if (allRes.error) return res.status(500).json({ error: allRes.error.message });

  const counts = { unpaid: 0, partial: 0, paid: 0, overdue: 0 };
  const sourceMap = { direct_sale: 0, quote_conversion: 0 };
  (allRes.data || []).forEach(i => {
    if (counts[i.status] !== undefined) counts[i.status]++;
    else counts[i.status] = 1;
    if (i.source) sourceMap[i.source] = (sourceMap[i.source] || 0) + 1;
  });

  const collected = (collectedRes.data || []).reduce((s, r) => s + Number(r.amount), 0);
  const total = (allRes.data || []).length;

  res.json({
    unpaid: counts.unpaid || 0,
    partial: counts.partial || 0,
    paid: counts.paid || 0,
    overdue: counts.overdue || 0,
    total,
    collected,
    bySource: sourceMap
  });
});

// ── Members ───────────────────────────────────────────────────────────────────

app.get('/api/members', async (req, res) => {
  const { data, error } = await supabase.from('members').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/members', async (req, res) => {
  const { count } = await supabase.from('members').select('*', { count: 'exact', head: true });
  const memberId = `LUX-M${String((count || 0) + 1).padStart(3, '0')}`;
  const { data, error } = await supabase.from('members').insert([{ ...req.body, member_id: memberId }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/members/:id', async (req, res) => {
  const { data, error } = await supabase.from('members').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/members/:id/points', async (req, res) => {
  const { delta } = req.body; // positive = add, negative = deduct
  const { data: member, error: mErr } = await supabase.from('members').select('points, tier').eq('id', req.params.id).single();
  if (mErr) return res.status(500).json({ error: mErr.message });
  const newPoints = Math.max(0, Number(member.points) + Number(delta));
  const tier = newPoints >= 2000 ? 'vip' : newPoints >= 1000 ? 'gold' : newPoints >= 500 ? 'silver' : 'regular';
  const { data, error } = await supabase.from('members').update({ points: newPoints, tier }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/members/:id', async (req, res) => {
  const { error } = await supabase.from('members').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Lux Sales running at http://localhost:${PORT}`));
