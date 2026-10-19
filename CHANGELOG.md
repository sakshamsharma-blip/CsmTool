# Changelog

Newest first. Add an entry whenever a batch of work is finished (CLAUDE.md asks for this).

## Oct 2026 — feedback batch 2 (12 items) — NOT YET COMMITTED/DEPLOYED

**Needs a manual step:** run `migrations/0018_pitch_lost_stages_drop_partial.sql` in the Supabase SQL Editor.

### Adoption Template
- Module weights total ≤ 100%; each module's parameter weights total ≤ 100%. Edits that would exceed are
  refused. Existing over-limit data (modules 118%; Registration/Inventory/Operations/Master Config/Branding
  parameters over 100%) is flagged in red, not rewritten.
- "Partially Adopted" status removed (Not Started / In Progress / Adopted). Migration 0018 moves the 3
  existing rows to In Progress.

### Expansion pitch stages
- New stages **Lost in Expansion** and **Lost after Purchase** (record the outcome only; no scope/MRR change).
- Every stage change opens a confirm dialog with an **optional comment**; every change is logged to Lab History
  as a check-in-sourced entry. Works from My Portfolio, Tasks → Pitch Reminders, and each lab's Adoption tab
  (all three edit the same records). The old separate "Stage…" list on the Adoption tab is gone.

### Visits, check-ins, tasks
- Visits & Meetings is offline visits only: log a past visit (→ Lab History) or plan a future one (→ a task,
  type `planned-visit`, due on the date, owned by the lab's CSM). "Log this visit" completes a plan.
- Log Check-in: each action item becomes a task (`action-item`); follow-up date → follow-up task; Lab History
  rows now carry a summary (sentiment, topics, action items, follow-up). Action items added when editing a
  check-in also become tasks.

### Labs, dashboard, money
- Total Labs: fixed the email being auto-filled into the search box (browser autofill via the top-bar search);
  opening Total Labs from the sidebar always starts with no search.
- Dashboard: Total Labs / Parent Labs (Clients) / Child Labs tiles. "Parent Labs" renamed "Parent Labs
  (Clients)" on Total Labs too.
- Lab Details: MRR editable for parent and child labs, with a note on whether the value counts toward the group
  total (Consolidated = parent's own MRR; Per-Branch = sum of children).
- Collections/invoices: marking a payment now errors clearly if the database saved nothing (previously silent).

### UI
- New type-to-filter dropdown (`SearchSelect`) for every lab picker (parents and children, with Lab ID),
  country and state, and the Total Labs State filter.

### Docs
- Added CLAUDE.md (working rules + domain rules) and CHANGELOG.md; rewrote README.md; GO_LIVE.md lists
  migrations 0015–0018.
