-- ============================================================
-- K.S OPTICALS — Supabase schema
-- Run this whole file in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- 1) Customers (each row = one customer + their full record history as jsonb)
create table if not exists customers (
  id text primary key,
  name text not null,
  mobile text not null,
  dob text,
  created_at bigint not null,
  records jsonb not null default '[]'::jsonb
);

alter table customers enable row level security;

create policy "owner full access to customers"
  on customers for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 2) Public digital bills (one row per generated bill, keyed by its unguessable token)
create table if not exists bills (
  token text primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table bills enable row level security;

-- Only the signed-in owner can read/write the bills table directly.
-- Customers reach their bill only through the get_public_bill() function below,
-- which is the ONLY way an anonymous visitor can read a bill — and only one at a
-- time, by its exact token. They can never list or browse the table.
create policy "owner full access to bills"
  on bills for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 3) Per-year bill number counter (KS-2026-00001, KS-2026-00002, ...)
create table if not exists bill_counters (
  year int primary key,
  count int not null default 0
);

alter table bill_counters enable row level security;

create policy "owner full access to bill_counters"
  on bill_counters for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ============================================================
-- RPC functions (SECURITY DEFINER = run with elevated privilege,
-- so they can safely give narrow, controlled public access)
-- ============================================================

-- Look up exactly one bill by its exact token. No login required.
-- Because there is no "list all bills" equivalent exposed anywhere,
-- a bill can only ever be found by already having its exact link.
create or replace function get_public_bill(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from bills where token = p_token limit 1;
$$;

grant execute on function get_public_bill(text) to anon, authenticated;

-- Atomically increments and returns the next bill number for a given year.
create or replace function next_bill_number(p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into bill_counters (year, count) values (p_year, 1)
  on conflict (year) do update set count = bill_counters.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

grant execute on function next_bill_number(int) to authenticated;
