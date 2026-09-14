-- Extends `visits` with the richer fields the "Log Check-in" screen captures (matching the
-- prototype's Log Check-in form): meeting logistics, who was contacted, what was discussed, a
-- sentiment read, which modules were flagged for follow-up during the call, and any action
-- items agreed on. Existing rows (simple visit-type entries logged from Visits & Meetings)
-- just get nulls here — nothing about the existing `visits` usage changes.
alter table visits add column if not exists duration_minutes int;
alter table visits add column if not exists location text;
alter table visits add column if not exists person_name text;
alter table visits add column if not exists person_designation text;
alter table visits add column if not exists discussion_topics text[];
alter table visits add column if not exists sentiment text check (sentiment in ('Positive', 'Neutral', 'At Risk'));
alter table visits add column if not exists flagged_modules text[];
alter table visits add column if not exists action_items jsonb;
