-- Testimonials, fuller record (decision Nov 24 2026): format (Video / Written), topics, source platform (Written only),
-- rating, publication status and customer consent. Feedback & NPS → Testimonials tab reports on all of them.
--   format  : 'Video' | 'Written'                    (existing rows are video links, so they become 'Video')
--   topics  : topic keys, e.g. {'product:overall','product:inventory','support:response_time'} (list in lib/testimonials.js)
--   source  : 'Email' | 'WhatsApp' | 'Google Form' | 'Other'  (Written only; NULL for Video)
--   source_detail : what "Other" was (required in the app when source = 'Other')
--   rating  : 1–5 in half steps, optional
--   status  : 'Pending' | 'In Review' | 'Approved' | 'Published'
--   consent : 'Not Requested' | 'Requested' | 'Received'
-- status / consent stay NULL on older rows ("Not set" in the app) rather than claiming something nobody recorded.
-- Approved / Published needing consent = Received is checked in the app, not here.
-- video_url keeps its name: it is now "the review or video link" for both formats.
-- Additive only: no row is changed or removed, the existing lab_testimonials_scoped RLS policy covers the new columns.
-- Safe to re-run. Run once in the Supabase SQL Editor (the app works before and after it).

alter table public.lab_testimonials add column if not exists format text not null default 'Video';
alter table public.lab_testimonials add column if not exists topics text[] not null default '{}';
alter table public.lab_testimonials add column if not exists source text;
alter table public.lab_testimonials add column if not exists source_detail text;
alter table public.lab_testimonials add column if not exists rating numeric(2,1);
alter table public.lab_testimonials add column if not exists status text;
alter table public.lab_testimonials add column if not exists consent text;

alter table public.lab_testimonials drop constraint if exists lab_testimonials_format_check;
alter table public.lab_testimonials add constraint lab_testimonials_format_check check (format in ('Video', 'Written'));
alter table public.lab_testimonials drop constraint if exists lab_testimonials_source_check;
alter table public.lab_testimonials add constraint lab_testimonials_source_check
  check (source is null or source in ('Email', 'WhatsApp', 'Google Form', 'Other'));
alter table public.lab_testimonials drop constraint if exists lab_testimonials_rating_check;
alter table public.lab_testimonials add constraint lab_testimonials_rating_check
  check (rating is null or (rating >= 1 and rating <= 5 and rating * 2 = round(rating * 2)));
alter table public.lab_testimonials drop constraint if exists lab_testimonials_status_check;
alter table public.lab_testimonials add constraint lab_testimonials_status_check
  check (status is null or status in ('Pending', 'In Review', 'Approved', 'Published'));
alter table public.lab_testimonials drop constraint if exists lab_testimonials_consent_check;
alter table public.lab_testimonials add constraint lab_testimonials_consent_check
  check (consent is null or consent in ('Not Requested', 'Requested', 'Received'));

insert into supabase_migrations.schema_migrations (version, name)
values ('0051', 'testimonial_details')
on conflict (version) do nothing;
