-- Run this entire file in your Supabase SQL Editor
-- Project: Lux Sales Tool

-- ── Products ──────────────────────────────────────────────────────────────────
create table if not exists products (
  id               uuid default gen_random_uuid() primary key,
  sku              text unique not null,
  style            text not null,
  color            text not null,
  size             text not null,
  wholesale_price  numeric(10,2) not null check (wholesale_price >= 0),
  online_stock     integer not null default 0 check (online_stock >= 0),
  physical_stock   integer not null default 0 check (physical_stock >= 0),
  created_at       timestamptz default now()
);

-- ── Customers ─────────────────────────────────────────────────────────────────
create table if not exists customers (
  id           uuid default gen_random_uuid() primary key,
  name         text not null,
  phone        text,
  email        text,
  type         text not null default 'retail' check (type in ('wholesale', 'retail')),
  last_contact date,
  notes        text,
  created_at   timestamptz default now()
);

-- ── Sales ─────────────────────────────────────────────────────────────────────
create table if not exists sales (
  id          uuid default gen_random_uuid() primary key,
  product_id  uuid references products(id) on delete restrict,
  customer_id uuid references customers(id) on delete set null,
  quantity    integer not null check (quantity > 0),
  channel     text not null check (channel in ('online', 'physical')),
  unit_price  numeric(10,2) not null,
  total       numeric(10,2) not null,
  sale_date   date not null default current_date,
  created_at  timestamptz default now()
);

-- ── Quotes ────────────────────────────────────────────────────────────────────
create table if not exists quotes (
  id             uuid default gen_random_uuid() primary key,
  quote_number   text unique not null,
  customer_id    uuid references customers(id) on delete set null,
  customer_name  text,
  customer_type  text not null default 'retail' check (customer_type in ('wholesale', 'retail')),
  items          jsonb not null default '[]',
  subtotal       numeric(10,2) not null default 0,
  total          numeric(10,2) not null default 0,
  notes          text,
  payment_terms  text not null default 'Payment due upon order',
  status         text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  created_at     timestamptz default now()
);

-- ── Disable RLS (single-user tool, no auth needed) ────────────────────────────
alter table products  disable row level security;
alter table customers disable row level security;
alter table sales     disable row level security;
alter table quotes    disable row level security;
