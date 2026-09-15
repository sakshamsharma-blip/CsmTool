-- Invoices — replaces the Zoho Books sync concept. A CSM uploads the actual invoice PDF; the
-- app auto-extracts invoice number/date/sub total/total and detects whether it's a Monthly
-- (recurring) invoice or a Pro-Rata (mid-month add-on) invoice, and the CSM confirms/corrects
-- before saving. Due date is deliberately NOT taken from the invoice's own "Due Date" field
-- (CrelioHealth's invoice template just repeats the invoice date there under "Terms: Refer
-- notes") — it's computed as invoice_date + that lab's credit_days instead, and stored (rather
-- than recomputed on the fly) so it doesn't drift if the lab's credit terms change later.
--
-- A Monthly invoice's sub_total becomes the lab's new MRR (see src/lib/invoices.js) — that's
-- the one side effect this table's rows can trigger elsewhere. A Pro-Rata invoice never touches
-- MRR; it's just a one-off amount to collect for a partial period, since the next Monthly
-- invoice will already include the new run-rate.
--
-- Amounts are stored in the lab's own native currency (INR for Domestic, USD for ROW) — see
-- src/lib/format.js's nativeCurrency(region). collected_manual is a running total a CSM updates
-- as payments come in, same pattern as collections_items.

create table invoices (
  id uuid primary key default gen_random_uuid(),
  lab_id text not null references labs(id) on delete cascade,
  invoice_number text not null,
  invoice_type text not null check (invoice_type in ('Monthly', 'ProRata')),
  currency text not null check (currency in ('INR', 'USD')),
  invoice_date date not null,
  due_date date not null,             -- invoice_date + lab's credit_days at time of upload
  sub_total numeric not null,         -- pre-tax — this is what becomes MRR for a Monthly invoice
  total numeric not null,             -- includes tax — what's actually owed/collected against
  collected_manual numeric not null default 0,
  collected_at timestamptz,
  extracted_ok boolean not null default true,   -- false if auto-extraction couldn't read one or more fields
  source_filename text,
  csm_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index invoices_lab_id_idx on invoices(lab_id);

-- Matches every other table's existing policy in this app (permissive for any signed-in user) —
-- RLS tightening is a separate, explicitly deferred decision (see GO_LIVE.md section 4), not
-- something this table should get ahead of on its own.
alter table invoices enable row level security;
create policy "invoices_rw_authenticated" on invoices for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- Unrelated fix, bundled in here since it's a one-liner and this migration is already running:
-- collections_items.module_key was `not null`, but every "+ Add Item" flow (both the
-- portfolio-wide Collections page and a lab's own Collections tab) inserts a manual item with
-- module_key: null — this is for a manually-noted charge that isn't tied to any specific
-- catalog module. That insert has always violated this constraint against a real Postgres
-- database (it just never got exercised against one before now, only against demo/mocked
-- data), so "+ Add Item" would currently fail for real. module_key stays a real foreign key for
-- rows that do reference a module (e.g. pitch-Added items) — this only drops the NOT NULL.
-- ============================================================
alter table collections_items alter column module_key drop not null;
