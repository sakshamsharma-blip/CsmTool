-- Billing Mode for Parent labs with children.
--
-- Before this, computeLabRollup / computeRows always treated a Parent-with-children's own mrr
-- as irrelevant and summed the children's mrr instead — even for groups that actually get ONE
-- consolidated invoice covering every branch. That meant adding a new child at mrr=0 silently
-- zeroed/overrode the whole group's reported MRR.
--
-- billing_mode records how a given group is actually billed:
--   'Consolidated' — one invoice for the whole group; the parent's own mrr IS the group's MRR.
--   'Per-Branch'   — each child billed separately; the parent's own mrr is ignored in favor of
--                    summing children (this app's original/only behavior before this column
--                    existed).
-- Only meaningful on a Parent-type row, and only once it has at least one child — see
-- src/lib/labRollup.js's computeLabRollup for where this is actually applied.
alter table labs add column if not exists billing_mode text check (billing_mode in ('Consolidated', 'Per-Branch'));

-- Backfill: every parent that already has children today was always billed as "sum of
-- children" — that was the app's only behavior until now — so preserve that for existing data
-- rather than silently changing anyone's reported MRR the moment this migration runs.
update labs set billing_mode = 'Per-Branch'
where type = 'Parent'
  and billing_mode is null
  and exists (select 1 from labs c where c.parent_id = labs.id and c.type = 'Child');
