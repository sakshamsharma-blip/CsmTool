-- Settlement date (decision Nov 4 2026): the day an invoice's payment actually settled, as opposed to collected_at, which
-- is only when someone typed it in. Lets past billing be entered with its real payment dates. With part payments it holds
-- the date of the latest payment.
-- Only adds an empty, optional column, so no existing row or policy changes. Existing rows stay NULL rather than being
-- filled from collected_at, because that date isn't the settlement date. Safe to re-run.
-- Run once, in the Supabase SQL Editor, BEFORE deploying the app and connector code that reads it.

alter table public.invoices add column if not exists settlement_date date;

insert into supabase_migrations.schema_migrations (version, name)
values ('0045', 'invoice_settlement_date') on conflict (version) do nothing;
