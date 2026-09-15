-- An "Admin" role for builders/testers: full (Lead-equivalent) access everywhere, plus —
-- unlike a real Lead or CSM — the ability to switch "viewing as" any teammate from the
-- sidebar in the real (non-demo) app, the same way the old demo-mode CSM switcher always
-- worked. Lets one person test the CSM Lead experience and the plain-CSM experience
-- without needing separate logins for each.

-- 1. Widen profiles.role's check constraint (it only allowed 'Lead'/'CSM' — added
--    dynamically since Postgres auto-names an unnamed column check, so we look it up
--    instead of guessing the name).
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';
  if cname is not null then
    execute format('alter table profiles drop constraint %I', cname);
  end if;
end $$;

alter table profiles add constraint profiles_role_check check (role in ('Lead','CSM','Admin'));

-- 2. Your own profile, as Admin. Both your emails point at it via profile_emails
--    (migrations/0006) — sign in with either one. Edit the name/emails below first if
--    you'd rather use different values, before running this.
insert into profiles (name, role)
values ('Saksham Sharma', 'Admin')
on conflict (name) do update set role = 'Admin';

insert into profile_emails (email, profile_id)
select 'saksham.sharma@livehealth.in', id from profiles where name = 'Saksham Sharma'
on conflict (email) do nothing;

insert into profile_emails (email, profile_id)
select 'saksham.sharma@creliohealth.com', id from profiles where name = 'Saksham Sharma'
on conflict (email) do nothing;

-- 3. Backfill in case either email already has a Supabase Auth account (already
--    invited/signed in before this migration ran) — safe to re-run any time.
insert into profile_auth_links (auth_user_id, profile_id, email)
select u.id, pe.profile_id, lower(u.email)
from auth.users u
join profile_emails pe on lower(u.email) = pe.email
on conflict (auth_user_id) do nothing;

update profiles p
set auth_user_id = coalesce(p.auth_user_id, u.id)
from profile_emails pe
join auth.users u on lower(u.email) = pe.email
where pe.profile_id = p.id and p.auth_user_id is null;

-- If you haven't invited yourself yet: Authentication → Users → Invite user, for
-- whichever of your two emails you want to sign in with first (or both).
