-- Auto-created task titles without the lab name (decision Nov 24 2026). The Tasks list already shows the Lab and Type in
-- their own columns, so new tasks are titled:
--   action item   → just its text                    (was "Action item — <lab>: <text>")
--   follow-up     → "Follow-up" or "Follow-up: <reason>"       (was "Follow-up — <lab>: <reason>")
--   planned visit → "Planned visit" or "Planned visit: <purpose>" (was "Planned visit — <lab>: <purpose>")
-- This tidies the existing ones the same way. Only the `description` of tasks of those three types changes, and only when
-- it starts with EXACTLY the old prefix for that task's own lab (plain string comparison, no pattern matching), so a
-- manually renamed title is left alone. Nothing else on the task changes. Safe to re-run (a second run matches nothing).

-- Action items: drop "Action item — <lab>: ".
update public.tasks t
set description = substr(t.description, length('Action item — ' || l.name || ': ') + 1)
from public.labs l
where l.id = t.lab_id and t.type = 'action-item'
  and left(t.description, length('Action item — ' || l.name || ': ')) = 'Action item — ' || l.name || ': '
  and length(t.description) > length('Action item — ' || l.name || ': ');

-- Follow-ups and planned visits: "<Prefix> — <lab>" → "<Prefix>", "<Prefix> — <lab>: <text>" → "<Prefix>: <text>".
update public.tasks t
set description = case
    when t.description = p.prefix || ' — ' || l.name then p.prefix
    else p.prefix || ': ' || substr(t.description, length(p.prefix || ' — ' || l.name || ': ') + 1)
  end
from public.labs l,
  (values ('follow-up', 'Follow-up'), ('planned-visit', 'Planned visit')) as p(task_type, prefix)
where l.id = t.lab_id and t.type = p.task_type
  and (t.description = p.prefix || ' — ' || l.name
    or left(t.description, length(p.prefix || ' — ' || l.name || ': ')) = p.prefix || ' — ' || l.name || ': ');

insert into supabase_migrations.schema_migrations (version, name)
values ('0053', 'task_titles_without_lab') on conflict (version) do nothing;
