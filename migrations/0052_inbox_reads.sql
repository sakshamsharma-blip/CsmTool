-- Inbox read status (decision Nov 24 2026). The Inbox (CSM Lead / Manager / Admin) lists the team's check-ins and logged
-- visits; each person marks entries read on their own. One row = "this person has read this check-in / visit".
-- Only the person themself can see, add or remove their rows; deleting a visit removes its read marks.
-- Entries created before Nov 24 2026 are treated as read by the app (INBOX_START in lib/inbox.js), so nothing old shows
-- as unread. New table only — no existing row changes. Safe to re-run. Run once in the Supabase SQL Editor.

create table if not exists public.visit_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  visit_id   uuid not null references public.visits(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (profile_id, visit_id)
);
create index if not exists visit_reads_visit_id_idx on public.visit_reads (visit_id);

alter table public.visit_reads enable row level security;
drop policy if exists "visit_reads_read" on public.visit_reads;
create policy "visit_reads_read" on public.visit_reads
  for select to authenticated
  using (profile_id = (select private.current_profile_id()));
drop policy if exists "visit_reads_insert" on public.visit_reads;
create policy "visit_reads_insert" on public.visit_reads
  for insert to authenticated
  with check (profile_id = (select private.current_profile_id())
    and exists (select 1 from public.visits v where v.id = visit_reads.visit_id));
drop policy if exists "visit_reads_delete" on public.visit_reads;
create policy "visit_reads_delete" on public.visit_reads
  for delete to authenticated
  using (profile_id = (select private.current_profile_id()));

insert into supabase_migrations.schema_migrations (version, name)
values ('0052', 'inbox_reads') on conflict (version) do nothing;
