-- Two status-vocabulary changes, both done as "replace the CHECK constraint" so the database
-- enforces the new lists:
--
-- 1. Pitch stages (My Portfolio / Tasks "Pitch Reminders"): adds two terminal stages,
--    'Lost in Expansion' (the pitch never converted) and 'Lost after Purchase' (the feature was
--    bought, then lost). Neither is an "active" stage, so they drop out of the open-pitch worklist.
--
-- 2. Adoption parameter status: removes 'Partially Adopted'. Any param_states row still on it is
--    first moved to 'In Progress' (the closest remaining stage) so the new constraint can't fail
--    against existing data. At the time of writing that is 3 rows out of 71.
--
-- Run once, in the Supabase SQL Editor. Safe to re-run: every step is idempotent.

-- ---- 1. pitch_status ----
alter table public.pitch_status drop constraint if exists pitch_status_status_check;
alter table public.pitch_status add constraint pitch_status_status_check
  check (status = any (array['To Do','Pitching','In Progress','Added','Not Required','Lost in Expansion','Lost after Purchase']));

-- ---- 2. param_states ----
update public.param_states set status = 'In Progress' where status = 'Partially Adopted';

alter table public.param_states drop constraint if exists param_states_status_check;
alter table public.param_states add constraint param_states_status_check
  check (status = any (array['Not Started','In Progress','Adopted']));
