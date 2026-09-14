-- Tracks when a collections item was last marked collected, so Collections screens can show
-- a "Last Payment" date per lab (matching the prototype's per-lab Collections tile). The
-- collected_zoho / Matched / Conflict machinery this feeds into already existed in
-- 0001_init.sql (collections_items.collected_zoho, resolution_comment, and the status CHECK
-- allowing 'Matched'/'Conflict') — it just wasn't being written to until now.
alter table collections_items add column if not exists collected_at timestamptz;
