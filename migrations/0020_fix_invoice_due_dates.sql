-- Fixes invoice due dates that were saved one day early.
--
-- Cause: the app computed "invoice date + credit days" and then converted it to UTC (toISOString), which in
-- India (UTC+5:30) rolls local midnight back to the previous day. Fixed in code (src/lib/dates.js), so new
-- invoices are correct; this repairs the ones already saved. When checked (Oct 2026) that was all 16 invoices.
--
-- Only rows whose due date is EXACTLY invoice_date + credit_days - 1 are moved forward one day, so any due date
-- that was set some other way is left alone. Re-running is safe: corrected rows no longer match.
-- (If a lab's credit days were changed after an invoice was saved, that invoice won't match and is untouched.)
--
-- Run once, in the Supabase SQL Editor.

update public.invoices i
set due_date = i.due_date + 1
from public.labs l
where l.id = i.lab_id
  -- 30 mirrors the app's default when a lab has no credit days set (lib/labs.js → creditDays "30").
  and i.due_date = i.invoice_date + coalesce(l.credit_days, 30) - 1;
