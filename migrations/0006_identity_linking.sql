-- Multiple login emails, one person, one shared profile/data.
--
-- Several teammates receive mail at two addresses (e.g. name@livehealth.in and
-- name@creliohealth.com landing in the same inbox) and need to be able to sign in
-- with either one and land on the exact same account: same labs, same tasks, same
-- activity history, no duplicate profile. Supabase Auth still creates one auth.users
-- row per email/password credential — that part can't be avoided — but every such
-- row gets mapped to the same profiles.id here, so "who am I" always resolves to one
-- person no matter which email they used to log in. Every real table (labs, tasks,
-- activity_log, collections_items, ...) already keys off profiles.id, never
-- auth_user_id directly, so once identity resolution is fixed, all of that data is
-- automatically shared — nothing else needs to change.
--
-- Note on passwords: this does NOT sync a password between someone's two emails —
-- each is still an independent Supabase Auth credential with its own password (set
-- when they accept that email's invite). That's fine: whichever of the two they log
-- in with, they land on the same data. There's no requirement the two passwords match,
-- though a person is welcome to set the same one on both for their own convenience.

-- 1. Known alternate emails per person. Seed one row per EXTRA email someone has,
--    pointing at their existing profiles row (see the template at the bottom of this
--    file). profiles.auth_user_id keeps working unchanged as the "primary" email link;
--    this table is what makes every OTHER email of theirs resolve to the same profile.
create table if not exists profile_emails (
  email text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 2. The actual lookup the app uses: which auth.users row (one per login identity)
--    maps to which profile. Many rows can point at the same profile_id.
create table if not exists profile_auth_links (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table profile_emails enable row level security;
create policy "profile_emails_read_authenticated" on profile_emails for select using (auth.role() = 'authenticated');
-- No client-side write policy on purpose — profile_emails is seeded by hand from the
-- SQL editor (admin/setup action), never written to from the app itself.

alter table profile_auth_links enable row level security;
create policy "profile_auth_links_read_authenticated" on profile_auth_links for select using (auth.role() = 'authenticated');
-- No client-side write policy here either — only the trigger below (security definer,
-- bypasses RLS) ever inserts into this table.

-- 3. Whenever a new login identity is created (the moment someone accepts an invite,
--    or signs up), auto-link it to an existing profile if its email is a known
--    alternate. Unrecognized emails are left unlinked — unchanged, existing behavior.
create or replace function public.handle_new_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_profile_id uuid;
begin
  select profile_id into matched_profile_id
  from profile_emails
  where email = lower(new.email)
  limit 1;

  if matched_profile_id is not null then
    insert into profile_auth_links (auth_user_id, profile_id, email)
    values (new.id, matched_profile_id, lower(new.email))
    on conflict (auth_user_id) do nothing;

    -- Keep the legacy single-column pointer populated too, but only if this profile
    -- doesn't already have a primary login linked — first one in wins there, harmless.
    update profiles
    set auth_user_id = new.id
    where id = matched_profile_id and auth_user_id is null;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_profile on auth.users;
create trigger on_auth_user_created_link_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_identity();

-- 4. One-time backfill for any auth.users rows that already exist at the moment you
--    add a profile_emails row (the trigger above only fires for logins created AFTER
--    it exists). Safe to re-run any time — matches are additive, already-linked rows
--    are skipped.
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

-- ---------------------------------------------------------------------------
-- To link someone's second email, run this once per extra address (find their
-- profiles.name in Authentication → Users, or `select name from profiles;`):
--
--   insert into profile_emails (email, profile_id)
--   select 'their.name@second-domain.com', id from profiles where name = 'Their Name'
--   on conflict (email) do nothing;
--
-- Do this BEFORE inviting that second email (Authentication → Users → Invite) so the
-- trigger links it the moment they accept — or after, since the backfill above will
-- also pick up an already-existing auth.users row the next time this file (or just
-- that one insert + the backfill block) is run.
-- ---------------------------------------------------------------------------
