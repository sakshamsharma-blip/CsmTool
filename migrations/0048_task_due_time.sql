-- Tasks can have a due time as well as a due date (decision Nov 23 2026), set from Add Task and the task panel.
-- Only adds one empty, optional column: no existing row or policy changes. A task with no time stays due any time that day,
-- and a task still only becomes Overdue the day after its due date. Safe to re-run.
-- Run once, in the Supabase SQL Editor, BEFORE deploying the app code that writes it.

alter table public.tasks add column if not exists due_time time;

insert into supabase_migrations.schema_migrations (version, name)
values ('0048', 'task_due_time') on conflict (version) do nothing;
