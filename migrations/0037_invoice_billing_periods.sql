-- Invoices can now cover more than one month (decision, Oct 2026): Monthly (1), Quarterly (3), HalfYearly (6) and
-- Annual (12) are all RECURRING invoices — the lab's MRR becomes sub total ÷ number of months, and the invoice
-- covers that many months from its invoice date. ProRata stays a one-off top-up added to MRR.
-- Only widens the allowed values; existing rows (Monthly / ProRata) are untouched. Safe to re-run.
-- Run once, in the Supabase SQL Editor.

alter table public.invoices drop constraint if exists invoices_invoice_type_check;
alter table public.invoices add constraint invoices_invoice_type_check
  check (invoice_type = any (array['Monthly','Quarterly','HalfYearly','Annual','ProRata']));

insert into supabase_migrations.schema_migrations (version, name)
values ('0037', 'invoice_billing_periods') on conflict (version) do nothing;
