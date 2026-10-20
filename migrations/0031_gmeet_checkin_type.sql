-- Adds "GMeet" as a check-in type (Log Check-in → 1. Check-in Type). Existing values are unchanged.
-- Run once, in the Supabase SQL Editor. Safe to re-run.

alter table public.visits drop constraint if exists visits_visit_type_check;
alter table public.visits add constraint visits_visit_type_check
  check (visit_type = any (array['Call','Visit','Email','WhatsApp','Note','GMeet']));

insert into supabase_migrations.schema_migrations (version, name)
values ('0031', 'gmeet_checkin_type') on conflict (version) do nothing;
