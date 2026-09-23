-- Lets a lab's user-facing "Lab ID" be renamed without touching labs.id, the internal primary
-- key every other table (collections_items, invoices, activity_log, scope_overrides,
-- param_scope_overrides, param_states, mrr_snapshot, visits, expansion_opportunities, and any
-- Child lab's own parent_id) references via lab_id/parent_id foreign keys. Renaming labs.id
-- itself would mean cascading that change through every one of those tables at once — a real
-- database-level operation, and a risky one for a table (or more) that's meant to be an
-- immutable audit trail. This sidesteps that entirely: labs.id keeps doing its current job
-- (the stable relational key, set once at lab creation and never touched again), and lab_code
-- becomes the separate, freely-editable "Lab ID" people actually type, search by, and see —
-- what CrelioHealth's own lab code is, independent of anything in this app's database.
--
-- Existing labs get lab_code backfilled to match their current id, so nothing changes visibly
-- until someone edits it. New labs (AddLabDrawer) also set lab_code = the "Lab ID" field typed
-- there, same starting point, but from then on lab_code can be changed freely from Lab Details
-- while id stays fixed underneath.

alter table public.labs add column if not exists lab_code text;

update public.labs set lab_code = id where lab_code is null;

alter table public.labs alter column lab_code set not null;

-- Plain (case-sensitive) uniqueness — guaranteed to succeed against today's data no matter what
-- it looks like, since every lab_code is backfilled from id, and id is already unique as the
-- primary key. The app's own checks (AddLabDrawer, Lab Details) additionally compare Lab IDs
-- case-insensitively before ever reaching the database, which is the real day-to-day guard —
-- this is just the backstop, and it's deliberately the weaker of the two rules so this migration
-- can never fail on a same-id-different-case pair that might already exist.
alter table public.labs add constraint labs_lab_code_key unique (lab_code);
