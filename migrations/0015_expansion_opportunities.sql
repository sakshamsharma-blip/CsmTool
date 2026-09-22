-- Expansion tab (item 1 of the latest feedback batch) — a per-CSM / manager-consolidated
-- tracker for upsell deals in flight, separate in concept from the existing Pitch Pipeline
-- (module/param-level upsell tracking on My Portfolio): this is deal-level, with its own
-- lifecycle (Onboarding -> Pipeline -> Live -> Lost) and dates, same shape the user asked for.
--
-- Amounts follow the same convention as collections_items/invoices — stored in the lab's own
-- native currency (INR for Domestic, ROW for USD), converted for display via
-- src/lib/format.js's toINR/toUSD/fmtMoney(amount, lab.region) — no separate currency column,
-- same as collections_items.
--
-- Created after migration 0012 tightened RLS to real per-CSM visibility, so this table's policy
-- is written directly in the tightened shape (join to labs.csm_id via current_profile_id()/
-- is_lead_or_admin()) rather than the old MVP-permissive placeholder earlier tables started with.

create table expansion_opportunities (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  monthly_revenue numeric not null default 0,
  annual_revenue numeric not null default 0,
  deal_won_date date,
  expected_live_date date,
  status text not null default 'Pipeline' check (status in ('Onboarding', 'Pipeline', 'Live', 'Lost')),
  comments text,
  csm_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expansion_opportunities_lab_id_idx on expansion_opportunities(lab_id);

alter table expansion_opportunities enable row level security;
create policy "expansion_opportunities_scoped" on expansion_opportunities
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = expansion_opportunities.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);
