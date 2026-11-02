-- KPI Management (decision Nov 2 2026): each KPI's weight and team target, plus optional per-CSM target overrides.
-- Everyone signed in can read them (a CSM sees the targets they're measured against); only a CSM Lead / Admin can change
-- them. Purely additive: two new tables, nothing existing is touched. Until this is run the app uses the same defaults.

create table if not exists public.kpi_settings (
  kpi_key     text primary key check (kpi_key in ('adoption','poc','retention','expansion','collection','tasks')),
  weight      numeric(5,2) not null check (weight >= 0 and weight <= 100),
  target      numeric(5,2) not null check (target >= 0 and target <= 100),
  updated_at  timestamptz not null default now()
);

insert into public.kpi_settings (kpi_key, weight, target) values
  ('adoption', 30, 75), ('poc', 10, 90), ('retention', 20, 100), ('expansion', 15, 70), ('collection', 15, 95), ('tasks', 10, 90)
on conflict (kpi_key) do nothing;

create table if not exists public.kpi_csm_targets (
  csm_id   uuid not null references public.profiles(id) on delete cascade,
  kpi_key  text not null references public.kpi_settings(kpi_key) on delete cascade,
  target   numeric(5,2) not null check (target >= 0 and target <= 100),
  primary key (csm_id, kpi_key)
);
create index if not exists kpi_csm_targets_kpi_key_idx on public.kpi_csm_targets (kpi_key);

alter table public.kpi_settings enable row level security;
drop policy if exists "kpi_settings_read" on public.kpi_settings;
create policy "kpi_settings_read" on public.kpi_settings for select to authenticated using (true);
drop policy if exists "kpi_settings_write" on public.kpi_settings;
create policy "kpi_settings_write" on public.kpi_settings for all to authenticated
  using ((select private.is_lead_or_admin())) with check ((select private.is_lead_or_admin()));

alter table public.kpi_csm_targets enable row level security;
drop policy if exists "kpi_csm_targets_read" on public.kpi_csm_targets;
create policy "kpi_csm_targets_read" on public.kpi_csm_targets for select to authenticated using (true);
drop policy if exists "kpi_csm_targets_write" on public.kpi_csm_targets;
create policy "kpi_csm_targets_write" on public.kpi_csm_targets for all to authenticated
  using ((select private.is_lead_or_admin())) with check ((select private.is_lead_or_admin()));

insert into supabase_migrations.schema_migrations (version, name)
values ('0044', 'kpi_settings') on conflict (version) do nothing;
