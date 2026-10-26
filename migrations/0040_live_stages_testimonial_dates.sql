-- Oct 26 2026. Run once, in the Supabase SQL Editor of the **CSM console** project. Safe to re-run.
--
-- 1. Live stages. The In-plan list becomes: To-Do → In Discussion / Demo → Trial → Onboarding / Setup → Live 1 →
--    Live 2 → Live 3 → Live 4 → Adopted (+ Not Required / Not Applicable / Did Not Meet Requirements, settable from
--    any stage). It is strictly one step forward at a time (only a CSM Lead / Admin can step back). Each Live step
--    unlocks 7 days after the previous one; Adopted unlocks 30 days after Live 1 started and needs an adoption note.
--    To enforce the waits, param_states now records WHEN the current status was set and when Live 1 started.
--    Existing rows keep their status; the timestamps start empty (only items entering Live from now on need them).
--
-- 2. "Onboarding / Setup" is removed from the Expansion (Not in plan) list — onboarding happens on the In-plan list
--    after Purchased. The add-ons currently at that stage (not purchased) move to Trial.
--
-- 3. Testimonials get the date they were collected (backfilled from when they were added).

-- ---- 1. ----
alter table public.param_states add column if not exists status_changed_at timestamptz;
alter table public.param_states add column if not exists live_started_at timestamptz;
alter table public.param_states drop constraint if exists param_states_status_check;
alter table public.param_states add constraint param_states_status_check check (status in (
  'To-Do', 'In Discussion / Demo', 'Trial', 'Onboarding / Setup', 'Live 1', 'Live 2', 'Live 3', 'Live 4', 'Adopted',
  'Not Required', 'Not Applicable', 'Did Not Meet Requirements',
  'Not Started', 'In Progress'));  -- legacy names, read as To-Do / Onboarding / Setup

-- ---- 2. ----
update public.pitch_status set status = 'Trial' where status = 'Onboarding / Setup';
-- 'Onboarding / Setup' and the legacy names stay accepted so a browser tab opened before the update can't fail a
-- save; the app reads them as Trial (see normalizePitch in lib/adoption.js).

-- ---- 3. ----
alter table public.lab_testimonials add column if not exists collected_on date;
update public.lab_testimonials set collected_on = (created_at at time zone 'Asia/Kolkata')::date where collected_on is null;
alter table public.lab_testimonials alter column collected_on set default current_date;
alter table public.lab_testimonials alter column collected_on set not null;

insert into supabase_migrations.schema_migrations (version, name)
values ('0040', 'live_stages_testimonial_dates') on conflict (version) do nothing;
