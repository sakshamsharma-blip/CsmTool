-- Adds an index for every foreign key Supabase's performance advisor flagged as unindexed (26 of them).
-- Pure performance: lookups like "all tasks/visits/activity for this lab" or "everything owned by this CSM"
-- stop scanning whole tables as data grows. No data or behaviour changes. `if not exists` makes it safe to
-- re-run. Run once, in the Supabase SQL Editor.

create index if not exists activity_log_csm_id_idx            on public.activity_log (csm_id);
create index if not exists activity_log_lab_id_idx            on public.activity_log (lab_id);
create index if not exists churn_log_csm_id_idx               on public.churn_log (csm_id);
create index if not exists collections_items_csm_id_idx       on public.collections_items (csm_id);
create index if not exists collections_items_lab_id_idx       on public.collections_items (lab_id);
create index if not exists collections_items_module_key_idx   on public.collections_items (module_key);
create index if not exists expansion_opportunities_csm_id_idx on public.expansion_opportunities (csm_id);
create index if not exists invoices_csm_id_idx                on public.invoices (csm_id);
create index if not exists lab_pulse_log_csm_id_idx           on public.lab_pulse_log (csm_id);
create index if not exists labs_csm_id_idx                    on public.labs (csm_id);
create index if not exists labs_parent_id_idx                 on public.labs (parent_id);
create index if not exists labs_plan_id_idx                   on public.labs (plan_id);
create index if not exists labs_testimonial_collected_by_idx  on public.labs (testimonial_collected_by);
create index if not exists param_scope_overrides_module_key_idx on public.param_scope_overrides (module_key);
create index if not exists param_states_module_key_idx        on public.param_states (module_key);
create index if not exists pitch_status_module_key_idx        on public.pitch_status (module_key);
create index if not exists plan_excluded_params_module_key_idx on public.plan_excluded_params (module_key);
create index if not exists plan_modules_module_key_idx        on public.plan_modules (module_key);
create index if not exists profile_auth_links_profile_id_idx  on public.profile_auth_links (profile_id);
create index if not exists profile_emails_profile_id_idx      on public.profile_emails (profile_id);
create index if not exists scope_overrides_module_key_idx     on public.scope_overrides (module_key);
create index if not exists tasks_assigned_by_idx              on public.tasks (assigned_by);
create index if not exists tasks_lab_id_idx                   on public.tasks (lab_id);
create index if not exists tasks_owner_id_idx                 on public.tasks (owner_id);
create index if not exists visits_csm_id_idx                  on public.visits (csm_id);
create index if not exists visits_lab_id_idx                  on public.visits (lab_id);
