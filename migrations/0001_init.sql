-- ============================================================
-- CSM Tool — Supabase schema + seed data
-- Generated from the working prototype's data model (prototype.html)
-- so the real backend starts with exactly the same catalog, plans,
-- and CSM roster the team has already been reviewing.
--
-- Run this once against a fresh Supabase project (SQL Editor, or
-- `supabase db push` if you set it up as a migration file).
-- ============================================================

-- ---------- extensions ----------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- 1. CATALOG — the shared Adoption Template every Plan draws from
-- ============================================================
create table modules (
  key text primary key,
  name text not null,
  icon text not null,
  weight numeric not null
);

create table module_params (
  id bigint generated always as identity primary key,
  module_key text not null references modules(key) on delete cascade,
  name text not null,
  type text not null check (type in ('M','O')),           -- Mandatory / Optional (scoring)
  weight numeric not null,
  category text not null check (category in ('Adoption','Expansion')),
  unique (module_key, name)
);

-- ============================================================
-- 2. PLANS — named, sold bundles (module + param membership)
-- ============================================================
create table plans (
  id text primary key,
  name text not null unique
);

create table plan_modules (
  plan_id text not null references plans(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  primary key (plan_id, module_key)
);

-- a parameter explicitly EXCLUDED from an otherwise-included module for this plan
-- (e.g. LIMS Starter includes Billing but not Multi-currency Billing)
create table plan_excluded_params (
  plan_id text not null references plans(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  param_name text not null,
  primary key (plan_id, module_key, param_name)
);

-- ============================================================
-- 3. PEOPLE — the CSM directory. Decoupled from auth.users on purpose:
-- seed the roster now, link each person's auth_user_id once they've
-- signed up / been invited, so the schema isn't blocked on auth setup.
-- ============================================================
create table profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null check (role in ('Lead','CSM')),
  auth_user_id uuid unique references auth.users(id) on delete set null
);

-- ============================================================
-- 4. LABS — the master record (Customer Master)
-- ============================================================
create table labs (
  id text primary key,                 -- keep using the human Lab ID as PK, like today
  name text not null,
  type text not null check (type in ('Parent','Child')),
  parent_id text references labs(id) on delete set null,
  csm_id uuid not null references profiles(id),
  plan_id text not null references plans(id),
  region text not null,
  city text,
  state text,
  country text,
  mrr numeric not null default 0,
  status text not null default 'Active',
  credit_days int,
  billing_type text,
  payment_cycle text,
  remarks text,
  created_at timestamptz not null default now()
);

-- per-lab deviations from the Plan's default module scope
create table scope_overrides (
  lab_id text not null references labs(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  in_scope boolean not null,
  primary key (lab_id, module_key)
);

-- per-lab deviations from the Plan's default parameter scope
create table param_scope_overrides (
  lab_id text not null references labs(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  param_name text not null,
  in_scope boolean not null,
  primary key (lab_id, module_key, param_name)
);

-- per-lab, per-feature adoption state (replaces the prototype's seeded-random getParamState)
create table param_states (
  lab_id text not null references labs(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  param_name text not null,
  included boolean not null default false,   -- purchased/included (Expansion features only; Adoption is always true)
  status text not null default 'Not Started' check (status in ('Not Started','In Progress','Partially Adopted','Adopted')),
  exp_value numeric,                          -- illustrative upsell value while not yet included
  exp_stage text,
  primary key (lab_id, module_key, param_name)
);

-- pitch/upsell status — module-level (whole module not yet in scope) or param-level
create table pitch_status (
  id bigint generated always as identity primary key,
  lab_id text not null references labs(id) on delete cascade,
  module_key text not null references modules(key) on delete cascade,
  param_name text,                            -- null = module-level pitch
  status text not null check (status in ('To Do','Pitching','In Progress','Added','Not Required')),
  unique (lab_id, module_key, param_name)
);

-- ============================================================
-- 5. COLLECTIONS — itemized owed/collected per "Added" upsell
-- ============================================================
create table collections_items (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  module_key text not null references modules(key),
  param_name text,
  label text not null,
  amount numeric not null default 0,
  is_trial boolean not null default false,
  added_date date not null default current_date,
  collected_manual numeric,
  collected_zoho numeric,                     -- placeholder until the real Zoho Books sync lands
  status text not null default 'Pending' check (status in ('Pending','Matched','Conflict','Resolved')),
  resolution_comment text,
  csm_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 6. TASKS — manual/recurring to-dos + system-generated nudges
-- ============================================================
create table tasks (
  id uuid primary key default gen_random_uuid(),
  lab_id text references labs(id) on delete cascade,
  owner_id uuid not null references profiles(id),
  assigned_by uuid references profiles(id),
  broadcast_id uuid,                          -- shared across all per-CSM copies of one broadcast task
  description text not null,
  type text not null default 'Action Item',
  due date,
  done boolean not null default false,
  last_done_date date,
  repeat text not null default 'none' check (repeat in ('none','daily','weekly','fortnightly','monthly','custom')),
  repeat_day text,
  repeat_interval_days int,
  repeat_anchor date,
  auto boolean not null default false,        -- true for system-generated nudges (collections/pitch reminders)
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7. ACTIVITY LOG — the audit trail (check-ins + every system action)
-- ============================================================
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  source text not null default 'system' check (source in ('system','checkin')),
  kind text not null,
  title text not null,
  meta text,
  details jsonb,                              -- structured check-in fields (contact, topics, sentiment, action items)
  csm_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS — MVP posture: any signed-in team member can read/write everything,
-- matching the prototype's fully-shared team visibility today. Tighten
-- later (e.g. a CSM only edits their own labs) once the team is live —
-- this is the one thing worth revisiting before this goes beyond an
-- internal trial.
-- ============================================================

alter table modules enable row level security;
create policy "modules_rw_authenticated" on modules for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table module_params enable row level security;
create policy "module_params_rw_authenticated" on module_params for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table plans enable row level security;
create policy "plans_rw_authenticated" on plans for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table plan_modules enable row level security;
create policy "plan_modules_rw_authenticated" on plan_modules for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table plan_excluded_params enable row level security;
create policy "plan_excluded_params_rw_authenticated" on plan_excluded_params for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table profiles enable row level security;
create policy "profiles_rw_authenticated" on profiles for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table labs enable row level security;
create policy "labs_rw_authenticated" on labs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table scope_overrides enable row level security;
create policy "scope_overrides_rw_authenticated" on scope_overrides for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table param_scope_overrides enable row level security;
create policy "param_scope_overrides_rw_authenticated" on param_scope_overrides for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table param_states enable row level security;
create policy "param_states_rw_authenticated" on param_states for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table pitch_status enable row level security;
create policy "pitch_status_rw_authenticated" on pitch_status for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table collections_items enable row level security;
create policy "collections_items_rw_authenticated" on collections_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table tasks enable row level security;
create policy "tasks_rw_authenticated" on tasks for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
alter table activity_log enable row level security;
create policy "activity_log_rw_authenticated" on activity_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- SEED DATA — the same catalog, plans, and CSM roster already in
-- the reviewed prototype, so day one on the real backend looks
-- identical to what the team has been looking at.
-- ============================================================

-- ---------- modules & their parameters ----------

insert into modules (key, name, icon, weight) values ('registration', 'Registration', '👤', 10);
insert into modules (key, name, icon, weight) values ('billing', 'Billing', '🧾', 10);
insert into modules (key, name, icon, weight) values ('operations', 'Operations', '⚙️', 10);
insert into modules (key, name, icon, weight) values ('homecollection', 'Home Collection', '🏠', 8);
insert into modules (key, name, icon, weight) values ('appointment', 'Appointment', '📅', 8);
insert into modules (key, name, icon, weight) values ('reportmgmt', 'Report Management', '📄', 8);
insert into modules (key, name, icon, weight) values ('inventory', 'Inventory', '📦', 12);
insert into modules (key, name, icon, weight) values ('qc', 'QC', '🧪', 10);
insert into modules (key, name, icon, weight) values ('logistic', 'Logistic', '🚚', 6);
insert into modules (key, name, icon, weight) values ('marketing', 'Marketing', '📣', 6);
insert into modules (key, name, icon, weight) values ('smartreports', 'Smart Reports', '✨', 6);
insert into modules (key, name, icon, weight) values ('branding', 'Branding', '🎨', 3);
insert into modules (key, name, icon, weight) values ('adminsetup', 'Admin Setup', '🔐', 3);

insert into module_params (module_key, name, type, weight, category) values ('registration', 'Patient Registration', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('registration', 'Referral Registration', 'M', 20, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('registration', 'Doctor Registration', 'M', 20, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('registration', 'Organization Registration', 'O', 15, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('registration', 'User Creation', 'M', 15, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('registration', 'Branch Setup', 'O', 5, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('billing', 'Invoice Generation', 'M', 30, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('billing', 'Payment Collection', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('billing', 'Credit Note', 'O', 15, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('billing', 'Billing Reports', 'O', 15, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('billing', 'Multi-currency Billing', 'O', 15, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('operations', 'Sample Collection', 'M', 30, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('operations', 'Sample Tracking', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('operations', 'Result Entry', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('operations', 'Result Validation', 'O', 10, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('operations', 'Report Approval', 'O', 10, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('homecollection', 'Phlebotomist Assignment', 'M', 40, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('homecollection', 'Route Planning', 'O', 30, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('homecollection', 'Home Collection App', 'O', 30, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('appointment', 'Online Booking', 'M', 40, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('appointment', 'Slot Management', 'M', 30, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('appointment', 'Reminder Notifications', 'O', 30, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('reportmgmt', 'Report Generation', 'M', 30, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('reportmgmt', 'Report Dispatch', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('reportmgmt', 'Digital Signature', 'M', 20, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('reportmgmt', 'Report Templates', 'O', 25, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('inventory', 'Item Master', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('inventory', 'Vendor Setup', 'M', 20, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('inventory', 'Stock Entry', 'M', 20, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('inventory', 'Stock Consumption', 'M', 15, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('inventory', 'Purchase Orders', 'O', 10, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('inventory', 'Reorder Levels', 'O', 5, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('inventory', 'Inventory Reports', 'O', 5, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('qc', 'QC Setup', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('qc', 'Daily QC Usage', 'M', 25, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('qc', 'Levy Jennings', 'M', 20, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('qc', 'QC Reports', 'O', 15, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('qc', 'Westgard Rules', 'O', 15, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('logistic', 'Pickup Scheduling', 'M', 50, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('logistic', 'Route Optimization', 'O', 25, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('logistic', 'Logistics Reports', 'O', 25, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('marketing', 'Campaign Setup', 'O', 50, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('marketing', 'SMS / WhatsApp Integration', 'O', 50, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('smartreports', 'AI Report Summary', 'O', 60, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('smartreports', 'Smart Insights', 'O', 40, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('branding', 'Custom Letterhead', 'O', 50, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('branding', 'Custom Domain', 'O', 50, 'Expansion');
insert into module_params (module_key, name, type, weight, category) values ('adminsetup', 'Role Management', 'M', 60, 'Adoption');
insert into module_params (module_key, name, type, weight, category) values ('adminsetup', 'Access Control', 'M', 40, 'Adoption');

-- ---------- plans ----------

insert into plans (id, name) values ('starter', 'LIMS Starter');
insert into plans (id, name) values ('growth', 'LIMS Growth');
insert into plans (id, name) values ('advance', 'LIMS Advance');
insert into plans (id, name) values ('premium', 'LIMS Premium');
insert into plans (id, name) values ('enterprise', 'LIMS Enterprise');

insert into plan_modules (plan_id, module_key) values ('starter', 'registration');
insert into plan_modules (plan_id, module_key) values ('starter', 'billing');
insert into plan_modules (plan_id, module_key) values ('starter', 'operations');
insert into plan_modules (plan_id, module_key) values ('starter', 'reportmgmt');
insert into plan_modules (plan_id, module_key) values ('starter', 'adminsetup');
insert into plan_modules (plan_id, module_key) values ('growth', 'registration');
insert into plan_modules (plan_id, module_key) values ('growth', 'billing');
insert into plan_modules (plan_id, module_key) values ('growth', 'operations');
insert into plan_modules (plan_id, module_key) values ('growth', 'reportmgmt');
insert into plan_modules (plan_id, module_key) values ('growth', 'adminsetup');
insert into plan_modules (plan_id, module_key) values ('growth', 'appointment');
insert into plan_modules (plan_id, module_key) values ('growth', 'inventory');
insert into plan_modules (plan_id, module_key) values ('growth', 'qc');
insert into plan_modules (plan_id, module_key) values ('advance', 'registration');
insert into plan_modules (plan_id, module_key) values ('advance', 'billing');
insert into plan_modules (plan_id, module_key) values ('advance', 'operations');
insert into plan_modules (plan_id, module_key) values ('advance', 'reportmgmt');
insert into plan_modules (plan_id, module_key) values ('advance', 'adminsetup');
insert into plan_modules (plan_id, module_key) values ('advance', 'appointment');
insert into plan_modules (plan_id, module_key) values ('advance', 'inventory');
insert into plan_modules (plan_id, module_key) values ('advance', 'qc');
insert into plan_modules (plan_id, module_key) values ('advance', 'homecollection');
insert into plan_modules (plan_id, module_key) values ('advance', 'logistic');
insert into plan_modules (plan_id, module_key) values ('premium', 'registration');
insert into plan_modules (plan_id, module_key) values ('premium', 'billing');
insert into plan_modules (plan_id, module_key) values ('premium', 'operations');
insert into plan_modules (plan_id, module_key) values ('premium', 'reportmgmt');
insert into plan_modules (plan_id, module_key) values ('premium', 'adminsetup');
insert into plan_modules (plan_id, module_key) values ('premium', 'appointment');
insert into plan_modules (plan_id, module_key) values ('premium', 'inventory');
insert into plan_modules (plan_id, module_key) values ('premium', 'qc');
insert into plan_modules (plan_id, module_key) values ('premium', 'homecollection');
insert into plan_modules (plan_id, module_key) values ('premium', 'logistic');
insert into plan_modules (plan_id, module_key) values ('premium', 'marketing');
insert into plan_modules (plan_id, module_key) values ('premium', 'smartreports');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'registration');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'billing');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'operations');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'homecollection');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'appointment');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'reportmgmt');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'inventory');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'qc');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'logistic');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'marketing');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'smartreports');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'branding');
insert into plan_modules (plan_id, module_key) values ('enterprise', 'adminsetup');

insert into plan_excluded_params (plan_id, module_key, param_name) values ('starter', 'billing', 'Credit Note');
insert into plan_excluded_params (plan_id, module_key, param_name) values ('starter', 'billing', 'Multi-currency Billing');
insert into plan_excluded_params (plan_id, module_key, param_name) values ('starter', 'reportmgmt', 'Digital Signature');
insert into plan_excluded_params (plan_id, module_key, param_name) values ('starter', 'reportmgmt', 'Report Templates');
insert into plan_excluded_params (plan_id, module_key, param_name) values ('growth', 'billing', 'Multi-currency Billing');

-- ---------- CSM directory (link auth_user_id manually once each person signs up —
-- see MIGRATION_PLAN.md step 2) ----------

insert into profiles (name, role) values ('Rahul Barge', 'Lead');
insert into profiles (name, role) values ('Aditi', 'CSM');
insert into profiles (name, role) values ('Aseem Khan', 'CSM');
insert into profiles (name, role) values ('Mazhar Shaikh', 'CSM');
insert into profiles (name, role) values ('Hrushikesh', 'CSM');
insert into profiles (name, role) values ('Sanskriti', 'CSM');
insert into profiles (name, role) values ('Suraj Todkar', 'CSM');

-- ============================================================
-- Done. Next: run this file, then follow MIGRATION_PLAN.md to wire
-- the existing prototype.html UI to these tables via supabase-js.
-- ============================================================
