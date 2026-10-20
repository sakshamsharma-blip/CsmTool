-- Decision (Oct 2026): an invoice's due date is the LAST day to pay — invoice date + credit days − 1. Example:
-- invoice on Oct 1 with 7 credit days → due Oct 7; on Oct 8 it is 1 day overdue. (With 0 credit days the due
-- date is the invoice date itself.) The app now saves new invoices this way; this moves the already-saved ones,
-- which were stored as invoice date + credit days, one day earlier.
-- Only rows still exactly at invoice_date + credit_days (credit days ≥ 1) are changed, so re-running is safe.
-- Run once, in the Supabase SQL Editor.

update public.invoices i
set due_date = i.due_date - 1
from public.labs l
where l.id = i.lab_id
  and coalesce(l.credit_days, 30) >= 1
  and i.due_date = i.invoice_date + coalesce(l.credit_days, 30);

insert into supabase_migrations.schema_migrations (version, name)
values ('0029', 'due_date_is_last_day_to_pay') on conflict (version) do nothing;
