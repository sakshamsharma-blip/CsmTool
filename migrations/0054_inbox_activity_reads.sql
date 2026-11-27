-- Inbox → Adoption / Expansion / Account (decision Nov 27 2026). Each is its own inbox next to Check-ins & Visits, and lists
-- Lab History entries (activity_log) of its kinds: adoption stage / In plan changes, pitch stages / purchases / deals, and
-- MRR, invoice, plan, CSM, status, billing, churn and feedback changes. Nothing new is tracked — the app reads activity_log.
-- This table only remembers what each person has read. One row = "this person has read this Lab History entry".
-- Only the person themself can see, add or remove their rows (same shape as visit_reads, 0052); deleting the entry removes
-- its read marks. Entries before Nov 27 2026 are treated as read by the app (UPDATES_START in lib/inboxUpdates.js).
-- New table only — no existing row changes. Safe to re-run. Run once in the Supabase SQL Editor.

create table if not exists public.activity_reads (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null references public.activity_log(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (profile_id, activity_id)
);
create index if not exists activity_reads_activity_id_idx on public.activity_reads (activity_id);

alter table public.activity_reads enable row level security;
drop policy if exists "activity_reads_read" on public.activity_reads;
create policy "activity_reads_read" on public.activity_reads
  for select to authenticated
  using (profile_id = (select private.current_profile_id()));
drop policy if exists "activity_reads_insert" on public.activity_reads;
create policy "activity_reads_insert" on public.activity_reads
  for insert to authenticated
  with check (profile_id = (select private.current_profile_id())
    and exists (select 1 from public.activity_log a where a.id = activity_reads.activity_id));
drop policy if exists "activity_reads_delete" on public.activity_reads;
create policy "activity_reads_delete" on public.activity_reads
  for delete to authenticated
  using (profile_id = (select private.current_profile_id()));

-- Lets the Inbox fetch these kinds since a date without scanning all of Lab History.
create index if not exists activity_log_kind_created_idx on public.activity_log (kind, created_at desc);

insert into supabase_migrations.schema_migrations (version, name)
values ('0054', 'inbox_activity_reads') on conflict (version) do nothing;
