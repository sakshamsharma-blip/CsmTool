-- A check-in's / visit's next follow-up can have a time as well as a date (decision Nov 23 2026), so the follow-up or
-- planned-visit task it creates gets that due time (tasks.due_time, 0048) and editing the check-in later shows it.
-- Only adds one empty, optional column: no existing row or policy changes. Safe to re-run.
-- Run once, in the Supabase SQL Editor, BEFORE deploying the app code that reads it.

alter table public.visits add column if not exists next_followup_time time;

insert into supabase_migrations.schema_migrations (version, name)
values ('0049', 'visit_followup_time') on conflict (version) do nothing;
