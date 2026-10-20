-- "Yearly visits required" per lab — how many in-person visits a year the lab is owed. Required when adding a
-- Parent lab (enforced in the app), optional for Child labs. Existing labs are left blank until someone fills it
-- in from Lab Details. Run once, in the Supabase SQL Editor. Safe to re-run.

alter table public.labs add column if not exists yearly_visits_required integer
  check (yearly_visits_required is null or yearly_visits_required >= 0);

insert into supabase_migrations.schema_migrations (version, name)
values ('0030', 'yearly_visits_required') on conflict (version) do nothing;
