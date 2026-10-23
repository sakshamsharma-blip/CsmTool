-- Oct 2026. Run once, in the Supabase SQL Editor of the **CSM console** project. Safe to re-run.
--
-- Feedback & NPS is recorded MANUALLY by the CSM — the lab gives it offline (call / visit), by Google Form, email…
-- and the CSM saves each response here so it can be reported on. One row = one response:
--   nps_score 0–10 ("How likely are you to recommend us?") and/or rating 1–5 (overall feedback) — at least one,
--   who gave it (name, designation), where it came from (source), a comment, and an optional supporting link
--   (Google Form response, sheet, email, recording…). lab_feedback had no rows when this was written.

alter table public.lab_feedback alter column rating drop not null;
alter table public.lab_feedback add column if not exists nps_score int;
alter table public.lab_feedback add column if not exists source text;
alter table public.lab_feedback add column if not exists respondent_name text;
alter table public.lab_feedback add column if not exists respondent_designation text;
alter table public.lab_feedback add column if not exists link_url text;

alter table public.lab_feedback drop constraint if exists lab_feedback_rating_check;
alter table public.lab_feedback add constraint lab_feedback_rating_check check (rating is null or rating between 1 and 5);
alter table public.lab_feedback drop constraint if exists lab_feedback_nps_check;
alter table public.lab_feedback add constraint lab_feedback_nps_check check (nps_score is null or nps_score between 0 and 10);
alter table public.lab_feedback drop constraint if exists lab_feedback_has_score;
alter table public.lab_feedback add constraint lab_feedback_has_score check (nps_score is not null or rating is not null);
alter table public.lab_feedback drop constraint if exists lab_feedback_source_check;
alter table public.lab_feedback add constraint lab_feedback_source_check
  check (source is null or source in ('Call', 'Visit', 'Google Form', 'Email', 'WhatsApp', 'Other'));

insert into supabase_migrations.schema_migrations (version, name)
values ('0039', 'feedback_nps_responses') on conflict (version) do nothing;
