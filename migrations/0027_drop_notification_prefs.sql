-- Decision (Oct 2026): reminders stay inside the CSM tool only (Tasks, Dashboard, Pitch Reminders) — no email
-- or Slack sending. The Email/Slack reminder feature was removed from the app, so the preferences table that
-- migration 0025 created is no longer used by anything. This drops it (with its RLS policy) and records this
-- migration in the history table from 0026. Safe to re-run. Run once, in the Supabase SQL Editor.

drop table if exists public.notification_prefs;

insert into supabase_migrations.schema_migrations (version, name)
values ('0027', 'drop_notification_prefs')
on conflict (version) do nothing;
