-- Oct 2026. Run once, in the Supabase SQL Editor of the **CSM console** project. Safe to re-run.
--
-- Task management revamp (Tasks page redesign):
-- 1. tasks get a workflow status (Open / In Progress / On Hold / Done — "Overdue" is shown from the due date, not
--    stored), a priority (High / Medium / Low, default Medium), a source (Manual / Adoption / Expansion), a longer
--    description (`details`; `description` stays the task title), when it was completed (for Resolution TAT and
--    On-time %), and — for tasks created automatically from an Adoption / Expansion item — which parameter it is for.
--    `done` is kept in step with status = 'Done' by the app (the sidebar counter and older screens still read it).
-- 2. task_updates — the comments and the activity history (status / priority / due date / owner changes) of a task.
--    Anyone who can see the task can read them and comment; a comment can be removed by its author or a Lead/Admin.
--
-- The only existing data touched: one-off tasks already ticked done get status 'Done' (so the new column agrees with
-- `done`); their completion time is unknown, so completed_at stays empty and they don't count in TAT.

-- ---- 1. ----
alter table public.tasks add column if not exists status text not null default 'Open';
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('Open', 'In Progress', 'On Hold', 'Done'));

alter table public.tasks add column if not exists priority text not null default 'Medium';
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check check (priority in ('High', 'Medium', 'Low'));

alter table public.tasks add column if not exists source text not null default 'Manual';
alter table public.tasks drop constraint if exists tasks_source_check;
alter table public.tasks add constraint tasks_source_check check (source in ('Manual', 'Adoption', 'Expansion'));

alter table public.tasks add column if not exists details text;
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists module_key text;
alter table public.tasks add column if not exists param_name text;

update public.tasks set status = 'Done' where done and repeat = 'none' and status <> 'Done';

-- Finding the open task of one Adoption / Expansion item.
create index if not exists tasks_item_idx on public.tasks (lab_id, module_key, param_name) where module_key is not null;

-- ---- 2. ----
create table if not exists public.task_updates (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid references public.profiles(id),
  kind       text not null check (kind in ('comment', 'event')),
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_updates_task_id_idx on public.task_updates (task_id);
create index if not exists task_updates_author_id_idx on public.task_updates (author_id);

alter table public.task_updates enable row level security;
-- Visibility follows the task itself (the tasks policy applies inside the sub-query).
drop policy if exists "task_updates_read" on public.task_updates;
create policy "task_updates_read" on public.task_updates
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_updates.task_id));
drop policy if exists "task_updates_insert" on public.task_updates;
create policy "task_updates_insert" on public.task_updates
  for insert to authenticated
  with check (author_id = (select private.current_profile_id())
    and exists (select 1 from public.tasks t where t.id = task_updates.task_id));
drop policy if exists "task_updates_delete" on public.task_updates;
create policy "task_updates_delete" on public.task_updates
  for delete to authenticated
  using ((select private.is_lead_or_admin()) or author_id = (select private.current_profile_id()));

insert into supabase_migrations.schema_migrations (version, name)
values ('0043', 'task_management') on conflict (version) do nothing;
