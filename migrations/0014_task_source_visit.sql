-- Links a follow-up task back to the visit/check-in that created it, so editing that visit's
-- follow-up date later can keep the task in sync (update its due date, or remove it if the
-- follow-up is cleared) instead of leaving a stale task behind.
-- Nullable and "on delete set null" — a task should never disappear just because its source
-- visit record does (visits aren't deletable from the UI today, but this stays safe either way).
alter table tasks add column if not exists source_visit_id uuid references visits(id) on delete set null;
create index if not exists tasks_source_visit_id_idx on tasks(source_visit_id) where source_visit_id is not null;