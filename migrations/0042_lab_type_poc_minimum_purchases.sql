-- Oct 2026. Run once, in the Supabase SQL Editor of the **CSM console** project. Safe to re-run. Touches no existing rows.
--
-- 1. labs.lab_type — what the lab does: Pathology, Radiology or Pathology + Radiology. NULL = not set yet (every
--    existing lab); a CSM sets it from Lab Details. (labs.type stays Parent / Child — a different thing.)
--
-- 2. lab_contacts.min_proactive_per_month — "Minimum Proactive Check-ins per Month" for that point of contact, typed
--    when the POC is added. NULL / 0 = no target. Done-this-month is counted from Proactive check-ins whose Person
--    Contacted matches the POC's name (no new column on visits).
--
-- 3. feature_purchases — one row per Expansion feature a lab bought (Purchased stage): when, priced or trial, the
--    monthly charge, and — if it was later lost — when. This is where purchase details live now; Collections is
--    invoice-driven only and is no longer written to by a purchase. Same tightened RLS shape as every lab-owned table.

-- ---- 1. ----
alter table public.labs add column if not exists lab_type text;
alter table public.labs drop constraint if exists labs_lab_type_check;
alter table public.labs add constraint labs_lab_type_check
  check (lab_type is null or lab_type in ('Pathology', 'Radiology', 'Pathology + Radiology'));

-- ---- 2. ----
alter table public.lab_contacts add column if not exists min_proactive_per_month int;
alter table public.lab_contacts drop constraint if exists lab_contacts_min_proactive_check;
alter table public.lab_contacts add constraint lab_contacts_min_proactive_check
  check (min_proactive_per_month is null or min_proactive_per_month between 0 and 31);

-- ---- 3. ----
create table if not exists public.feature_purchases (
  id              uuid primary key default gen_random_uuid(),
  lab_id          text not null references public.labs(id) on delete cascade,
  module_key      text not null,
  param_name      text,                       -- NULL = the whole module was bought
  label           text not null,
  is_trial        boolean not null default false,
  monthly_charge  numeric not null default 0, -- lab's native currency (INR Domestic / USD ROW); 0 while on trial
  purchased_on    date not null default current_date,
  charges_added_on date,                      -- set when a trial was converted to priced
  status          text not null default 'Active' check (status in ('Active', 'Lost')),
  lost_on         date,
  lost_comment    text,
  csm_id          uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists feature_purchases_lab_id_idx on public.feature_purchases (lab_id);
create index if not exists feature_purchases_csm_id_idx on public.feature_purchases (csm_id);

alter table public.feature_purchases enable row level security;
drop policy if exists "feature_purchases_scoped" on public.feature_purchases;
create policy "feature_purchases_scoped" on public.feature_purchases
  for all to authenticated
  using ((select private.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = feature_purchases.lab_id and l.csm_id = (select private.current_profile_id())
  ))
  with check ((select private.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = feature_purchases.lab_id and l.csm_id = (select private.current_profile_id())
  ));

insert into supabase_migrations.schema_migrations (version, name)
values ('0042', 'lab_type_poc_minimum_purchases') on conflict (version) do nothing;
