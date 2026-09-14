-- ============================================================
-- VISITS & MEETINGS — a lightweight, standalone log of visits/
-- meetings/calls, independent of the (not-yet-built) Log Check-in
-- module. "Upcoming" reads next_followup_date; "Recent" reads
-- visit_date, newest first.
-- ============================================================
create table visits (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  csm_id uuid references profiles(id),
  visit_type text not null default 'Visit' check (visit_type in ('Call','Visit','Email','WhatsApp','Note')),
  visit_date date not null default current_date,
  notes text,
  next_followup_date date,
  next_followup_reason text,
  created_at timestamptz not null default now()
);

alter table visits enable row level security;
create policy "visits_rw_authenticated" on visits for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
