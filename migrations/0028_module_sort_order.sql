-- Adoption Template: modules can be dragged into any order in the Module Builder, and that order is used
-- everywhere (each lab's Adoption tab, My Portfolio, Log Check-in). Adds modules.sort_order and seeds it from the
-- order the app shows today (heaviest weight first, then name), so nothing moves until someone reorders.
-- Safe to re-run. Run once, in the Supabase SQL Editor.

alter table public.modules add column if not exists sort_order integer;

with ranked as (
  select key, row_number() over (order by weight desc, name) as rn from public.modules
)
update public.modules m set sort_order = ranked.rn
from ranked where ranked.key = m.key and m.sort_order is null;

insert into supabase_migrations.schema_migrations (version, name)
values ('0028', 'module_sort_order') on conflict (version) do nothing;
