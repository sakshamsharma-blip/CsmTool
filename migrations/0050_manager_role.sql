-- A "Manager" role (decision Nov 23 2026) with exactly the same access as a CSM Lead: Team View, every lab, the Adoption
-- Template, KPI settings, Reassign CSM, Manage Users. Every Lead check in the database goes through
-- private.is_lead_or_admin(), so adding Manager there covers every policy and the reassign trigger at once.
-- Like a Lead, a Manager can't make anyone an Admin and can't change roles (only the Admin can — 0021 is unchanged).
-- No existing row changes: only the list of allowed role names grows. Safe to re-run.
-- Run once, in the Supabase SQL Editor, BEFORE giving anyone the role (the app code can go first: it just won't offer it yet).

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array['Lead', 'Manager', 'CSM', 'Admin']));

create or replace function private.is_lead_or_admin()
  returns boolean
  language sql
  stable security definer
  set search_path to 'public'
as $function$
  select coalesce((select role in ('Lead', 'Manager', 'Admin') from public.profiles where id = private.current_profile_id()), false);
$function$;

insert into supabase_migrations.schema_migrations (version, name)
values ('0050', 'manager_role') on conflict (version) do nothing;
