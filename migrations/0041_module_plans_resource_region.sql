-- Oct 2026. Run once, in the Supabase SQL Editor of the **CSM console** project. Safe to re-run.
--
-- 1. New modules now join every Plan when they're created (app change), so their Adoption-category parameters default
--    to "In plan" for every lab. Two modules created before that are in NO plan, so their parameters showed as
--    "Not in plan" everywhere: Contract / Order Form and Finance Management. This adds them to every plan.
--    Only DEFAULTS change — any parameter a CSM already set by hand for a lab (param_states.in_plan) keeps that value.
--    A Lead / Admin can still untick a plan in the Adoption Template's "Apply Rules".
--
-- 2. Resources get a Region — who the document is useful for: All, Domestic or ROW (Rest of the World). Existing
--    resources become "All".

-- ---- 1. ----
insert into public.plan_modules (plan_id, module_key)
select p.id, m.key
from public.plans p
cross join public.modules m
where m.key in ('contractorderform', 'financemanagement')
on conflict do nothing;

-- ---- 2. ----
alter table public.resources add column if not exists region text not null default 'All';
alter table public.resources drop constraint if exists resources_region_check;
alter table public.resources add constraint resources_region_check check (region in ('All', 'Domestic', 'ROW'));

insert into supabase_migrations.schema_migrations (version, name)
values ('0041', 'module_plans_resource_region') on conflict (version) do nothing;
