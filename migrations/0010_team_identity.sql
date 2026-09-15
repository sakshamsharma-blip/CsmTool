-- Links each real teammate's two emails (@creliohealth.com and its @livehealth.in mirror) to
-- their existing profiles row, so either address logs into the exact same account — same labs,
-- tasks, and history. Mechanism is migrations/0006_identity_linking.sql: seed profile_emails for
-- BOTH addresses now, before anyone is invited, so the auto-link trigger fires the moment either
-- one accepts an invite — no manual "update profiles set auth_user_id" step needed afterward.
--
-- ASSUMPTION TO DOUBLE-CHECK: the @livehealth.in address below mirrors the @creliohealth.com
-- local part exactly, the same pattern Saksham's own two emails already use
-- (saksham.sharma@creliohealth.com / saksham.sharma@livehealth.in — already linked in
-- migrations/0007_admin_role.sql, nothing to do for him here). Fix any line where that guess is
-- wrong before running.
--
-- Two roster names (from migrations/0001_init.sql) didn't match the real surname per email —
-- fixed here to first-name-only display, matching the existing Aditi/Hrushikesh/Sanskriti
-- convention (their real surname per email — Ansari, Hussain — is reflected in the email itself,
-- just not carried into the short display name). Safe to re-run: a no-op once already renamed.
update profiles set name = 'Aseem' where name = 'Aseem Khan';
update profiles set name = 'Mazhar' where name = 'Mazhar Shaikh';

insert into profile_emails (email, profile_id) select 'rahul.barge@creliohealth.com', id from profiles where name = 'Rahul Barge' on conflict (email) do nothing;
insert into profile_emails (email, profile_id) select 'rahul.barge@livehealth.in', id from profiles where name = 'Rahul Barge' on conflict (email) do nothing;

insert into profile_emails (email, profile_id) select 'aditi.salunkhe@creliohealth.com', id from profiles where name = 'Aditi' on conflict (email) do nothing;
insert into profile_emails (email, profile_id) select 'aditi.salunkhe@livehealth.in', id from profiles where name = 'Aditi' on conflict (email) do nothing;

insert into profile_emails (email, profile_id) select 'aseem.ansari@creliohealth.com', id from profiles where name = 'Aseem' on conflict (email) do nothing;
insert into profile_emails (email, profile_id) select 'aseem.ansari@livehealth.in', id from profiles where name = 'Aseem' on conflict (email) do nothing;

insert into profile_emails (email, profile_id) select 'mazhar.hussain@creliohealth.com', id from profiles where name = 'Mazhar' on conflict (email) do nothing;
insert into profile_emails (email, profile_id) select 'mazhar.hussain@livehealth.in', id from profiles where name = 'Mazhar' on conflict (email) do nothing;

insert into profile_emails (email, profile_id) select 'hrushikesh.shinde@creliohealth.com', id from profiles where name = 'Hrushikesh' on conflict (email) do nothing;
insert into profile_emails (email, profile_id) select 'hrushikesh.shinde@livehealth.in', id from profiles where name = 'Hrushikesh' on conflict (email) do nothing;

insert into profile_emails (email, profile_id) select 'sanskriti.sharma@creliohealth.com', id from profiles where name = 'Sanskriti' on conflict (email) do nothing;
insert into profile_emails (email, profile_id) select 'sanskriti.sharma@livehealth.in', id from profiles where name = 'Sanskriti' on conflict (email) do nothing;

insert into profile_emails (email, profile_id) select 'suraj.todkar@creliohealth.com', id from profiles where name = 'Suraj Todkar' on conflict (email) do nothing;
insert into profile_emails (email, profile_id) select 'suraj.todkar@livehealth.in', id from profiles where name = 'Suraj Todkar' on conflict (email) do nothing;

-- One-time backfill: picks up anyone above who already has a Supabase Auth account from an
-- earlier invite. Safe no-op for anyone who hasn't signed in yet — running this file before or
-- after the actual invites both work.
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
