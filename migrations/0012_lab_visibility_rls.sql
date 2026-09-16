-- Real, database-enforced lab visibility: a plain CSM can only read/write their own labs
-- (and everything hanging off them — Adoption, Collections, Tasks, Visits, Invoices, Health
-- Checks, Churn, MRR history). A CSM Lead or Admin still sees everything, unchanged.
--
-- Why this has to happen here and not in the React code: every table's policy since
-- 0001_init.sql has been the MVP placeholder `for all using (auth.role() = 'authenticated')`
-- — any signed-in user can read and write every row in every table. Total Labs, Dashboard,
-- Collections, Tasks, Visits, Reports all fetch the FULL dataset from Supabase and only filter
-- it in the browser (the "My Labs" / "Team View" toggle) — nothing stops a CSM from opening
-- another CSM's lab directly, or reading it straight from the network tab. Row Level Security
-- is the only place this can be enforced for real, and doing it here fixes every screen at
-- once — no view-level code changes needed, since each screen just receives fewer rows back.
--
-- Design:
--  * Two helper functions resolve "who is asking" the same way the app already does (via
--    profile_auth_links from migrations/0006, falling back to the legacy profiles.auth_user_id
--    column) so it stays correct for teammates with two linked emails.
--  * Every policy below is USING (visibility) restrictive but WITH CHECK (write shape)
--    permissive — this is a deliberate, narrow scope: fix who can SEE/target which rows,
--    without touching any existing write behavior (e.g. Reassign CSM moving a lab to someone
--    else) that the app already relies on. Widening WITH CHECK is a separate decision.
--  * modules/module_params/plans/plan_modules/plan_excluded_params/profiles are untouched —
--    the shared catalog and CSM directory need to stay readable by everyone (dropdowns,
--    Adoption Template, "All CSMs" filters); nothing in there is per-lab sensitive data.

-- ---------- 1. who is asking ----------

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select profile_id from profile_auth_links where auth_user_id = auth.uid() limit 1),
    (select id from profiles where auth_user_id = auth.uid() limit 1)
  );
$$;

create or replace function public.is_lead_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('Lead', 'Admin') from profiles where id = public.current_profile_id()),
    false
  );
$$;

grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_lead_or_admin() to authenticated;

-- ---------- 2. labs — the direct owner column (csm_id) ----------

drop policy if exists "labs_rw_authenticated" on labs;
create policy "labs_scoped" on labs
  for all
  using (public.is_lead_or_admin() or csm_id = public.current_profile_id())
  with check (true);

-- ---------- 3. everything keyed off a lab (join to labs.csm_id) ----------

drop policy if exists "scope_overrides_rw_authenticated" on scope_overrides;
create policy "scope_overrides_scoped" on scope_overrides
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = scope_overrides.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "param_scope_overrides_rw_authenticated" on param_scope_overrides;
create policy "param_scope_overrides_scoped" on param_scope_overrides
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = param_scope_overrides.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "param_states_rw_authenticated" on param_states;
create policy "param_states_scoped" on param_states
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = param_states.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "pitch_status_rw_authenticated" on pitch_status;
create policy "pitch_status_scoped" on pitch_status
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = pitch_status.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "collections_items_rw_authenticated" on collections_items;
create policy "collections_items_scoped" on collections_items
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = collections_items.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "activity_log_rw_authenticated" on activity_log;
create policy "activity_log_scoped" on activity_log
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = activity_log.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "visits_rw_authenticated" on visits;
create policy "visits_scoped" on visits
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = visits.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "invoices_rw_authenticated" on invoices;
create policy "invoices_scoped" on invoices
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = invoices.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "lab_pulse_log_rw_authenticated" on lab_pulse_log;
create policy "lab_pulse_log_scoped" on lab_pulse_log
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = lab_pulse_log.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "churn_log_rw_authenticated" on churn_log;
create policy "churn_log_scoped" on churn_log
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = churn_log.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

drop policy if exists "mrr_snapshot_rw_authenticated" on mrr_snapshot;
create policy "mrr_snapshot_scoped" on mrr_snapshot
  for all
  using (public.is_lead_or_admin() or exists (
    select 1 from labs l where l.id = mrr_snapshot.lab_id and l.csm_id = public.current_profile_id()
  ))
  with check (true);

-- ---------- 4. tasks — not lab-scoped (a personal task has lab_id null), visibility is
--    owner_id (whose task list it's in) or assigned_by (who created/broadcast it) instead ----------

drop policy if exists "tasks_rw_authenticated" on tasks;
create policy "tasks_scoped" on tasks
  for all
  using (
    public.is_lead_or_admin()
    or owner_id = public.current_profile_id()
    or assigned_by = public.current_profile_id()
  )
  with check (true);

-- ============================================================
-- Verify after running: log in as a plain CSM and confirm Total Labs, Dashboard, My
-- Portfolio, Collections, Tasks, Visits & Meetings, and Reports show ONLY their own labs —
-- and that opening another CSM's lab by ID (if you have one handy) now shows nothing / an
-- empty state rather than that lab's real data. Then confirm a Lead or Admin login still
-- sees everyone's labs exactly as before.
-- ============================================================
