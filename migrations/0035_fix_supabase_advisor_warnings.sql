-- Clears the Supabase advisor warnings (Oct 2026). No change to who can see or do what.
--
-- 1. "Signed-in users can execute SECURITY DEFINER function" (current_profile_id, is_lead_or_admin, is_admin):
--    these helpers only exist for the RLS policies, but living in the API-exposed `public` schema made them callable
--    at /rest/v1/rpc/…. They move to a `private` schema (not exposed by the API); every policy and trigger that used
--    them is re-pointed at the private copies (same logic, same results), then the public copies are dropped.
--    The app never calls them directly.
-- 2. "Auth RLS initplan" on profile_emails / profile_auth_links: their read policies re-checked auth.role() per row;
--    they become plain "signed-in users can read" policies (same access, evaluated once).
-- 3. "Multiple permissive policies" on the Adoption Template tables: the Lead/Admin write rule was FOR ALL, which
--    also overlapped the read rule. It's split into separate INSERT / UPDATE / DELETE rules (same access).
--
-- Not changed: "unused index" notices (the indexes from 0022 are a day old and get used as data grows) and
-- leaked-password protection (needs the Pro plan).
-- All in one transaction — if anything fails, nothing changes.

begin;

-- ---- 1a. private copies of the helpers ----
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.current_profile_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select profile_id from public.profile_auth_links where auth_user_id = auth.uid() limit 1),
    (select id from public.profiles where auth_user_id = auth.uid() limit 1)
  );
$$;

create or replace function private.is_lead_or_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select role in ('Lead', 'Admin') from public.profiles where id = private.current_profile_id()), false);
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select role = 'Admin' from public.profiles where id = private.current_profile_id()), false);
$$;

revoke all on function private.current_profile_id(), private.is_lead_or_admin(), private.is_admin() from public, anon;
grant execute on function private.current_profile_id(), private.is_lead_or_admin(), private.is_admin() to authenticated;

-- ---- 1b. re-point every policy that calls the public helpers ----
do $$
declare
  r record; q text; w text; roles text;
  -- (?<!private\.) = leave calls that already point at the private copies alone.
  pat constant text := '(?<!private\.)(public\.)?(is_lead_or_admin|current_profile_id|is_admin)\(\)';
begin
  for r in
    select * from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    q := case when r.qual is null then null else regexp_replace(r.qual, pat, 'private.\2()', 'g') end;
    w := case when r.with_check is null then null else regexp_replace(r.with_check, pat, 'private.\2()', 'g') end;
    select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') into roles from unnest(r.roles) x;
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    execute format('create policy %I on %I.%I as %s for %s to %s%s%s',
      r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, roles,
      case when q is not null then ' using (' || q || ')' else '' end,
      case when w is not null then ' with check (' || w || ')' else '' end);
  end loop;
end $$;

-- ---- 3. Adoption Template tables: split the FOR ALL write rule ----
do $$
declare t text;
begin
  foreach t in array array['modules','module_params','plans','plan_modules','plan_excluded_params'] loop
    execute format('drop policy if exists %I on public.%I', t || '_write_lead_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_lead_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_lead_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_lead_admin', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_lead_or_admin()))', t || '_insert_lead_admin', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_lead_or_admin())) with check ((select private.is_lead_or_admin()))', t || '_update_lead_admin', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_lead_or_admin()))', t || '_delete_lead_admin', t);
  end loop;
end $$;

-- ---- 1c. triggers use the private helpers ----
create or replace function public.prevent_non_admin_role_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the Admin can change a team member''s role.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_non_lead_reassign()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.csm_id is distinct from old.csm_id and auth.uid() is not null and not private.is_lead_or_admin() then
    raise exception 'Only a CSM Lead or Admin can reassign a lab to another CSM.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---- 1d. drop the public copies (fails — and rolls everything back — if anything still depends on them) ----
drop function public.is_admin();
drop function public.is_lead_or_admin();
drop function public.current_profile_id();

-- ---- 2. identity tables: same access, no per-row auth call ----
drop policy if exists "profile_emails_read_authenticated" on public.profile_emails;
create policy "profile_emails_read_authenticated" on public.profile_emails for select to authenticated using (true);
drop policy if exists "profile_auth_links_read_authenticated" on public.profile_auth_links;
create policy "profile_auth_links_read_authenticated" on public.profile_auth_links for select to authenticated using (true);

insert into supabase_migrations.schema_migrations (version, name)
values ('0035', 'fix_supabase_advisor_warnings') on conflict (version) do nothing;

commit;
