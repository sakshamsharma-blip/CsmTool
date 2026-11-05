-- Feature expansions get an expected live date and a description (decision Nov 5 2026), edited from Expansion → Deals & Purchases,
-- as manual deals already have. They sit on the feature's pitch_status row, which every stage change keeps and only updates the
-- status of. Only adds two empty, optional columns: no existing row or policy changes. Safe to re-run.
-- Run once, in the Supabase SQL Editor, BEFORE deploying the app code that writes them.

alter table public.pitch_status add column if not exists expected_live_date date;
alter table public.pitch_status add column if not exists description text;

insert into supabase_migrations.schema_migrations (version, name)
values ('0047', 'feature_expansion_details') on conflict (version) do nothing;
