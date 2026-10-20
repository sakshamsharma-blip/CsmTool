-- Daily reminders by email and/or Slack (overdue + due-today tasks, overdue payments). This migration adds
-- each person's reminder preferences. Sending is done by the `send-reminders` Edge Function
-- (supabase/functions/send-reminders) and stays OFF until the Admin adds the credentials — see the
-- "Turning reminders on" steps at the bottom of this file.
--
-- Everyone can read/edit their own preferences; a Lead/Admin can see and set anyone's. Run once, in the
-- Supabase SQL Editor. Safe to re-run.

create table if not exists public.notification_prefs (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  email_enabled   boolean not null default false,
  slack_enabled   boolean not null default false,
  email           text,          -- where to send; blank = the person's first linked login email
  slack_member_id text,          -- Slack member ID (e.g. U0123ABCD) so the team digest @mentions them
  updated_at      timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists "notification_prefs_scoped" on public.notification_prefs;
create policy "notification_prefs_scoped" on public.notification_prefs
  for all to authenticated
  using ((select public.is_lead_or_admin()) or profile_id = (select public.current_profile_id()))
  with check ((select public.is_lead_or_admin()) or profile_id = (select public.current_profile_id()));

-- ---------------------------------------------------------------------------------------------------------
-- Turning reminders on (Admin, one time — nothing below runs automatically):
--
-- 1. Edge Function secrets (Supabase → Edge Functions → Secrets):
--      REMINDER_CRON_SECRET   any long random string (protects the function from being triggered by others)
--      RESEND_API_KEY         from resend.com (for email)       } either or both;
--      REMINDER_FROM_EMAIL    e.g. "CS Console <cs@yourdomain>"  } a channel with no
--      SLACK_WEBHOOK_URL      Slack → Incoming Webhook URL       } credentials is skipped
--      APP_URL                https://csm-tool-two.vercel.app
-- 2. Deploy the function: supabase/functions/send-reminders (Supabase CLI `supabase functions deploy
--    send-reminders`, or ask Claude to deploy it through the Supabase connector).
-- 3. Database → Extensions: enable pg_cron and pg_net, then schedule it daily at 09:00 IST (03:30 UTC):
--
--   select cron.schedule('daily-reminders', '30 3 * * *', $$
--     select net.http_post(
--       url := 'https://fviorzjezigvjevlsdrv.supabase.co/functions/v1/send-reminders',
--       headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret', '<REMINDER_CRON_SECRET>'),
--       body := '{}'::jsonb
--     );
--   $$);
--
--   To stop: select cron.unschedule('daily-reminders');
