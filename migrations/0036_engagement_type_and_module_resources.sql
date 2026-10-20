-- Two additions (Oct 2026). Safe to re-run. Run once, in the Supabase SQL Editor.
--
-- 1. visits.engagement — every check-in / logged visit is now marked Proactive (CSM-initiated) or Reactive (the lab
--    reached out / responding to an issue). Required in the app for new entries; older rows stay blank (NULL), so
--    nothing existing breaks. Feeds the analytics.
--
-- 2. module_resources — documentation / training-video links per MODULE (Registration, Billing, …; not per
--    parameter). Anyone signed in can see them and add one — from the Adoption Template or from any lab's Adoption
--    tab — and every lab shows the same list for that module. A link can be edited or removed by whoever added it,
--    or by a CSM Lead / Admin.

alter table public.visits add column if not exists engagement text;
alter table public.visits drop constraint if exists visits_engagement_check;
alter table public.visits add constraint visits_engagement_check
  check (engagement is null or engagement in ('Proactive', 'Reactive'));

create table if not exists public.module_resources (
  id          uuid primary key default gen_random_uuid(),
  module_key  text not null references public.modules(key) on delete cascade on update cascade,
  title       text not null,
  url         text not null,
  kind        text not null default 'Documentation' check (kind in ('Documentation', 'Training Video', 'Other')),
  added_by    uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists module_resources_module_key_idx on public.module_resources (module_key);
create index if not exists module_resources_added_by_idx on public.module_resources (added_by);

alter table public.module_resources enable row level security;
drop policy if exists "module_resources_read" on public.module_resources;
drop policy if exists "module_resources_insert" on public.module_resources;
drop policy if exists "module_resources_update" on public.module_resources;
drop policy if exists "module_resources_delete" on public.module_resources;
create policy "module_resources_read" on public.module_resources
  for select to authenticated using (true);
create policy "module_resources_insert" on public.module_resources
  for insert to authenticated with check (added_by = (select private.current_profile_id()));
create policy "module_resources_update" on public.module_resources
  for update to authenticated
  using ((select private.is_lead_or_admin()) or added_by = (select private.current_profile_id()))
  with check ((select private.is_lead_or_admin()) or added_by = (select private.current_profile_id()));
create policy "module_resources_delete" on public.module_resources
  for delete to authenticated
  using ((select private.is_lead_or_admin()) or added_by = (select private.current_profile_id()));

insert into supabase_migrations.schema_migrations (version, name)
values ('0036', 'engagement_type_and_module_resources') on conflict (version) do nothing;
