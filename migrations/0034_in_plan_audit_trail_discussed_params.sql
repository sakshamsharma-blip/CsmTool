-- Adoption model v2 (decision, Oct 2026). Three additions, all safe against existing data:
--
-- 1. param_states.in_plan — per lab, per parameter: In plan (part of the lab's plan → tracked as Adoption) or Not
--    in plan (an add-on → tracked as Expansion: pitched, purchased, then rolled out). NULL means "use the default":
--    In plan when the lab's Plan includes it AND its template category is Adoption. This replaces the old module /
--    parameter "In scope" switches. To keep every lab exactly as it looks today, the lab+parameter pairs where those
--    old switches differ from the new default (45 at the time of writing) get an explicit value here:
--      in_plan = module in scope AND parameter in scope AND category = Adoption.
--    An Adoption-category parameter that ends up Not in plan this way also gets included = false (it was out of
--    scope, i.e. not something the lab has). The old scope_overrides / param_scope_overrides tables are left in
--    place untouched (no longer read by the app).
--
-- 2. param_changes — the per-parameter audit trail: every change to a lab's parameter (In plan / Not in plan,
--    rollout status, pitch stage) with the REQUIRED comment, who made it and when. The latest comment shows next to
--    the parameter; clicking the parameter opens its full trail. Same RLS shape as every lab-owned table.
--
-- 3. visits.discussed_params — Log Check-in's Adoption Snapshot can now mark individual parameters (not just whole
--    modules) as discussed. Stored as 'moduleKey|paramName'.
--
-- Run once, in the Supabase SQL Editor. Safe to re-run.

alter table public.param_states add column if not exists in_plan boolean;

with lp as (
  select l.id lab_id, mp.module_key, mp.name param_name, mp.category,
         exists (select 1 from public.plan_modules pm where pm.plan_id = l.plan_id and pm.module_key = mp.module_key) plan_mod,
         exists (select 1 from public.plan_excluded_params pe where pe.plan_id = l.plan_id and pe.module_key = mp.module_key and pe.param_name = mp.name) plan_excl
  from public.labs l cross join public.module_params mp
), calc as (
  select lp.*,
    (coalesce(so.in_scope, lp.plan_mod) and coalesce(pso.in_scope, lp.plan_mod and not lp.plan_excl) and lp.category = 'Adoption') old_in_plan,
    (lp.plan_mod and not lp.plan_excl and lp.category = 'Adoption') default_in_plan
  from lp
  left join public.scope_overrides so on so.lab_id = lp.lab_id and so.module_key = lp.module_key
  left join public.param_scope_overrides pso on pso.lab_id = lp.lab_id and pso.module_key = lp.module_key and pso.param_name = lp.param_name
)
insert into public.param_states (lab_id, module_key, param_name, in_plan, included, status)
select c.lab_id, c.module_key, c.param_name, c.old_in_plan,
       case when c.category = 'Adoption' then c.old_in_plan else false end,
       'Not Started'
from calc c
where c.old_in_plan <> c.default_in_plan
on conflict (lab_id, module_key, param_name) do update
  set in_plan = excluded.in_plan,
      included = case when excluded.in_plan = false and (select category from public.module_params mp
                        where mp.module_key = excluded.module_key and mp.name = excluded.param_name) = 'Adoption'
                      then false else public.param_states.included end
  where public.param_states.in_plan is null;

create table if not exists public.param_changes (
  id          uuid primary key default gen_random_uuid(),
  lab_id      text not null references public.labs(id) on delete cascade,
  module_key  text not null,
  param_name  text not null,
  change      text not null,          -- e.g. "Status: Not Started → In Progress", "Not in plan → In plan"
  comment     text not null,
  csm_id      uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists param_changes_lab_param_idx on public.param_changes (lab_id, module_key, param_name, created_at desc);
create index if not exists param_changes_csm_id_idx on public.param_changes (csm_id);

alter table public.param_changes enable row level security;
drop policy if exists "param_changes_scoped" on public.param_changes;
create policy "param_changes_scoped" on public.param_changes
  for all to authenticated
  using ((select public.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = param_changes.lab_id and l.csm_id = (select public.current_profile_id())
  ))
  with check ((select public.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = param_changes.lab_id and l.csm_id = (select public.current_profile_id())
  ));

alter table public.visits add column if not exists discussed_params text[];

insert into supabase_migrations.schema_migrations (version, name)
values ('0034', 'in_plan_audit_trail_discussed_params') on conflict (version) do nothing;
