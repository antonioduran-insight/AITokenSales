-- Vendors table for Global Admin
-- Tracks resellers/partners and their commission percentage

create table if not exists public.vendors (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  email           text,
  commission_pct  integer not null default 30 check (commission_pct >= 0 and commission_pct <= 100),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Only admin_global can read/write vendors (via service role in API routes)
alter table public.vendors enable row level security;

create policy "admin_global can manage vendors"
  on public.vendors
  for all
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin_global'
    )
  );
