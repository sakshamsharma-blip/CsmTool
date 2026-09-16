-- Health/sentiment tracking, Stage tags, Churn logging, testimonials, and CSM deactivation —
-- all sourced from real columns in CrelioHealth's original "New CSM From July 2026" master
-- sheet that never made it into the app. See the "CSM Tool Backlog" review for the source
-- columns each of these maps to.
--
-- Design notes:
--  * Health status + satisfaction rating are logged together in one `lab_pulse_log` row,
--    because in the source sheet a CSM sets both at the same time each month — no reason to
--    force two separate actions in the UI for something that's one real-world check-in.
--  * `labs.health_status` / `labs.last_rating` are denormalized copies of the latest pulse log
--    row, same pattern as `labs.mrr` being a denormalized copy of the latest invoice — fast to
--    read on Total Labs without a join; the log table is the source of truth/history.
--  * churn_log does NOT duplicate region/billing_type (already on `labs`, join if needed) or
--    quarter (derivable from churn_month client-side) — only what's genuinely new.
--  * Every new table gets the same permissive "any signed-in user" RLS policy every other
--    table in this app has — RLS tightening is still the separate, explicitly deferred decision.

create table lab_pulse_log (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  health_status text not null check (health_status in ('No Risk','Happy','Unhappy','Risky Churn','Churn','Assign CS')),
  rating numeric,                     -- optional 0-10 satisfaction score — not every pulse check includes one
  note text,
  csm_id uuid references profiles(id),
  logged_at timestamptz not null default now()
);
create index lab_pulse_log_lab_id_idx on lab_pulse_log(lab_id);
alter table lab_pulse_log enable row level security;
create policy "lab_pulse_log_rw_authenticated" on lab_pulse_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table labs add column if not exists health_status text;
alter table labs add column if not exists last_rating numeric;

-- Stage tags — a lab can be several things at once (Adoption, Expansion, Support, Pending
-- Dues, Open Points, Pilot, Future Churn, Churn, Rapo) at the same time, matching the source
-- sheet's "Stage" column, which stacked multiple tags per lab in one cell.
alter table labs add column if not exists stage_tags text[] not null default '{}';

-- Testimonials — flat/denormalized on the lab itself, matching the source sheet: this is a
-- one-time capture per lab, not something with a history worth logging separately.
alter table labs add column if not exists testimonial_collected boolean not null default false;
alter table labs add column if not exists testimonial_video_url text;
alter table labs add column if not exists testimonial_collected_by uuid references profiles(id);
alter table labs add column if not exists testimonial_collected_at timestamptz;

-- Churn — labs.status already accepts any text (no CHECK constraint to alter), so 'Churned'
-- is a valid value immediately; this table is the detail record behind that status change.
create table churn_log (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  churn_type text not null check (churn_type in ('Churned','Contraction')),
  churn_month date not null,
  mrr_lost numeric not null default 0,
  due_amount numeric not null default 0,   -- outstanding Collections balance at the moment this was logged
  reason text,
  csm_id uuid references profiles(id),
  logged_at timestamptz not null default now()
);
create index churn_log_lab_id_idx on churn_log(lab_id);
alter table churn_log enable row level security;
create policy "churn_log_rw_authenticated" on churn_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Deactivate a team member — Manage Users has Add + Edit today but no way to mark someone
-- inactive if they leave; default true so every existing profile stays exactly as visible as
-- it is today.
alter table profiles add column if not exists active boolean not null default true;

-- MRR trend history — the app only ever showed current MRR; the source sheet keeps a running
-- Jan-Dec column per lab. There's no way to backfill genuine history for MRR that already
-- changed before this table existed, so this starts tracking going forward only: one row per
-- lab at creation, and one more every time updateLabMRR() runs (invoice-driven MRR changes) —
-- see src/lib/labs.js. The UI is honest about this ("trend starts tracking from today") rather
-- than implying a longer history than actually exists.
create table mrr_snapshot (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  mrr numeric not null,
  region text not null,
  source text not null default 'system',   -- 'lab_created' | 'invoice' | 'manual'
  logged_at timestamptz not null default now()
);
create index mrr_snapshot_lab_id_idx on mrr_snapshot(lab_id);
alter table mrr_snapshot enable row level security;
create policy "mrr_snapshot_rw_authenticated" on mrr_snapshot for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
