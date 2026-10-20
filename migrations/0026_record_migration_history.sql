-- Records which numbered migrations from this repo have been applied, in Supabase's own migration-history
-- table (supabase_migrations.schema_migrations) — the table the Supabase dashboard, the Supabase CLI and the
-- Supabase connector read when you ask "which migrations are applied?".
--
-- Why: every migration here has been run by hand in the SQL Editor, so that table never existed and nothing
-- recorded what's live. With it, anyone (or any Claude session) can check the applied list in one step
-- instead of inspecting the schema; it's easy to spot a file that was written but never run; and future
-- migrations applied through the connector or CLI are recorded there automatically, next to these.
--
-- Effect on the app and its users: none. This only creates/fills that bookkeeping table; no app table, row,
-- permission or screen changes. Safe to re-run (existing rows are left alone).
--
-- Keep running new files by hand as before; when you add one, also add its row here:
--   insert into supabase_migrations.schema_migrations (version, name) values ('0027', 'your_name') on conflict do nothing;
-- (This file lists everything up to and including itself, so run it only after 0022–0025.)

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);

insert into supabase_migrations.schema_migrations (version, name) values
  ('0001', 'init'),
  ('0002', 'visits'),
  ('0003', 'catalog_description'),
  ('0004', 'collections_zoho'),
  ('0005', 'checkins'),
  ('0006', 'identity_linking'),
  ('0007', 'admin_role'),
  ('0008', 'invoices'),
  ('0009', 'truncate_test_data'),
  ('0010', 'team_identity'),
  ('0011', 'health_stage_churn_testimonials'),
  ('0012', 'lab_visibility_rls'),
  ('0013', 'billing_mode'),
  ('0014', 'task_source_visit'),
  ('0015', 'expansion_opportunities'),
  ('0016', 'adoption_catalog_seed'),
  ('0017', 'lab_code'),
  ('0018', 'pitch_lost_stages_drop_partial'),
  ('0019', 'rebalance_template_weights'),
  ('0020', 'fix_invoice_due_dates'),
  ('0021', 'protect_profiles_and_functions'),
  ('0022', 'foreign_key_indexes'),
  ('0023', 'rebalance_weights_to_exactly_100'),
  ('0024', 'template_and_reassign_lead_admin_only'),
  ('0025', 'reminder_preferences'),
  ('0026', 'record_migration_history')
on conflict (version) do nothing;
