-- Closes a privilege-escalation hole without changing anything the app lets people do today.
--
-- Before: `profiles` had one policy allowing ANY signed-in user to insert/update/delete ANY profile. The app
-- only offers Manage Users to Leads/Admins, but a plain CSM could still call the API directly and set their
-- own role to 'Admin' — which would also unlock every lab via is_lead_or_admin() in the RLS policies.
--
-- After (matches what the UI already allows):
--   * everyone signed in can still READ the roster (the app needs it everywhere);
--   * only Leads and Admins can add or edit team members (Manage Users);
--   * only the Admin can create, edit, demote or delete an Admin profile, or give anyone the Admin role
--     (the Add/Edit form already never offers 'Admin');
--   * only the Admin can delete a profile (the app never deletes profiles);
--   * only the Admin can CHANGE an existing person's role (CSM ↔ Lead ↔ Admin) — enforced by a trigger, since
--     RLS can't compare the old and new value. Leads can still add people and edit name / active status.
--     Changes made without a signed-in app user (Supabase SQL Editor, service role) are not blocked.
-- The sign-up trigger (handle_new_auth_identity) runs as SECURITY DEFINER, so linking new logins keeps working.
--
-- Also: the helper functions were callable by logged-out visitors through /rest/v1/rpc. They stay callable
-- by signed-in users (RLS policies need that), but anon/public execute is removed; the sign-up trigger
-- function isn't meant to be called through the API at all.
--
-- Not changed on purpose: plans / Adoption Template tables and the lab-scoped tables' write checks — every
-- CSM uses the Adoption Template and Reassign CSM today, so tightening those would change behaviour.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select role = 'Admin' from profiles where id = public.current_profile_id()), false);
$$;

drop policy if exists "profiles_rw_authenticated" on public.profiles;
drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_delete" on public.profiles;

create policy "profiles_read" on public.profiles
  for select to authenticated
  using (true);

create policy "profiles_insert" on public.profiles
  for insert to authenticated
  with check (public.is_lead_or_admin() and (role <> 'Admin' or public.is_admin()));

create policy "profiles_update" on public.profiles
  for update to authenticated
  using (public.is_admin() or (public.is_lead_or_admin() and role <> 'Admin'))
  with check (public.is_lead_or_admin() and (role <> 'Admin' or public.is_admin()));

create policy "profiles_delete" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- Role changes on existing profiles: Admin only
create or replace function public.prevent_non_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the Admin can change a team member''s role.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_change_admin_only on public.profiles;
create trigger profiles_role_change_admin_only
  before update of role on public.profiles
  for each row execute function public.prevent_non_admin_role_change();

-- Function execute rights
revoke execute on function public.current_profile_id() from public, anon;
revoke execute on function public.is_lead_or_admin() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_lead_or_admin() to authenticated;
grant execute on function public.is_admin() to authenticated;

revoke execute on function public.handle_new_auth_identity() from public, anon, authenticated;
revoke execute on function public.prevent_non_admin_role_change() from public, anon, authenticated;
