# Changelog

Newest first. Add an entry whenever a batch of work is finished (CLAUDE.md asks for this).

## Oct 2026 — fix: lost-after-purchase trials
- A feature marked "Lost after Purchase" no longer offers "Add charges" (Adoption tab, Collections tab) or a
  rollout status; it shows a "Lost after purchase" tag instead (also on My Portfolio).

## Oct 2026 — batch 4, phase 2: adoption model v2
**Database (both applied):** `0034_in_plan_audit_trail_discussed_params.sql`; `0035_fix_supabase_advisor_warnings.sql`
(moves the RLS helper functions to a private schema, tidies policies — access verified unchanged for a CSM and a Lead).
- Each lab sees the whole Adoption Template; every parameter is **In plan** (Adoption) or **Not in plan**
  (Expansion), reversible. Default comes from the lab's Plan + the template category. The "In scope" switches,
  "Save Changes" bar, plan-deviation banner and "Reset to Plan Defaults" are gone from the lab Adoption tab.
- New score ladder (0–100 per parameter; module and lab are weighted averages): Not in plan To Do 0 / Pitching
  10 / In Progress 30; In plan or purchased Not Started 70 / In Progress 85 / Adopted 100; Not Required and
  Lost = 0. Used on the lab's Adoption tab, My Portfolio, Dashboard and Log Check-in.
- Every parameter change needs a comment and saves at once; the newest comment shows under the parameter and
  clicking the parameter opens its full history (incl. pitch-stage changes).
- My Portfolio lists each lab's Not-in-plan parameters per module for pitching.
- Log Check-in → Adoption Snapshot: tick modules and/or individual parameters as *discussed*; no more automatic
  training follow-up tasks.
- Lint now also catches undefined variables (`no-undef`); smoke tests: 9.

## Oct 2026 — batch 4, phase 1
**Database (all applied):** 0028 module order, 0029 due date = last day to pay, 0030 yearly
visits required, 0031 GMeet check-in type, 0032 lab contacts, 0033 lab documents.
- Pitch-stage comment is now required.
- Adoption Template: drag/▲▼ to reorder modules (labs follow the order); module & parameter edits are saved only
  with "Save Changes" (Discard reverts); per-parameter descriptions; descriptions show as ⓘ on labs' Adoption tab.
- Visits & Meetings: a logged visit's "Next Visit" now appears under Upcoming Planned Visits; planned visits are
  editable; City column and city filter.
- Add Lab / Lab Details: "Yearly Visits Required" (required for Parent labs).
- Total Labs: Country and City filters (type-to-filter) and a City column.
- "Reports" renamed "Financial Reports".
- Collections: due date = last day to pay (invoice date + credit days − 1); overdue days count from the next day,
  for invoices and items alike.
- Log Check-in: GMeet type; Person Contacted picks from the lab's points of contact (or type a new one and save it).
- Lab Details: Points of Contact card. New Documents tab (links to the lab's documents).
- MRR trend: hover any point to see its date and value.

## Oct 2026 — reminders kept in-app only
- Removed the Email/Slack reminder feature (Reminder Settings in the top bar, the sender function, its data
  layer). Reminders stay inside the tool: Tasks, Dashboard and Pitch Reminders. Migration
  `0027_drop_notification_prefs.sql` removes its now-unused database table.

## Oct 2026 — suggestions round (purchases, MRR, permissions, reminders, filters, tests)

**Database (all applied):** `0022_foreign_key_indexes`, `0023_rebalance_weights_to_exactly_100`,
`0024_template_and_reassign_lead_admin_only`, `0025_reminder_preferences`, `0026_record_migration_history`.

- **Mark purchased / Added** asks Priced or Trial (+ monthly charge). The feature keeps a "Priced ₹X/mo" or "Trial"
  tag on the Adoption tab and My Portfolio; trials have "Add charges". Purchasing / adding charges no longer
  changes MRR directly.
- **MRR follows invoices**: Monthly invoice sets MRR; Pro-Rata invoice now ADDS its sub total to MRR until the
  next Monthly invoice.
- **Lost after Purchase** drops MRR by the feature's charge and logs a Contraction (Reports → Churn Report).
- **Edit / delete** invoices and Collections items (Lab → Collections tab); MRR moves only by what the change implies.
- **Adoption Template**: every weight group must total exactly 100% — red warning + one-click "Rescale to 100%";
  Branding Solutions rescaled to 100 (0023). Editing is CSM Lead / Admin only (view-only for CSMs).
- **Reassign CSM** is CSM Lead / Admin only.
- **Filters & paging**: Tasks (lab, type, open/done), Collections (lab, aging), Expansion (lab, status),
  Visits (lab), Lab History (activity type); long lists show 25 per page.
- **Login expiry** now returns to the sign-in screen instead of leaving a workspace whose saves fail.
- **Faster first load**: the PDF reader loads only when an invoice is uploaded (main download 1.24 MB → 0.81 MB).
- **Smoke tests**: `npm run test:e2e` (Playwright, demo mode). All lint warnings fixed (15 → 0).

## Oct 2026 — full-repo check (bug fixes)
- Dates were computed in UTC, so in India "today" was yesterday: new tasks defaulted to overdue, check-in/visit
  dates and follow-ups were a day off, and invoice due dates were saved one day early. New `lib/dates.js`;
  migration `0020_fix_invoice_due_dates.sql` repaired the 17 existing invoices (applied).
- Security: only the Admin can change a team member's role (Manage Users locks the field for Leads);
  migration `0021_protect_profiles_and_functions.sql` enforces it in the database (to be run).
- Adding a lab that the database rejected stayed on screen and showed "saved"; it now rolls back with an error.
- CSM reassignment / plan change now roll back on screen if the save fails.
- Renaming a team member now carries the new name to their labs; duplicate names are blocked.
- Reports → MRR Breakdown double-counted parent/child groups; it now uses the same group MRR as Dashboard.
- ROW (USD) labs: the "Added" cost box and payment log entries showed ₹; now show $.
- Tasks from a lab with no CSM assigned are given to the person logging them instead of nobody.
- Health-check rating limited to 0–10; Total Labs export now exports what's on screen, uses the editable
  Lab ID, adds Currency, and can't inject spreadsheet formulas. Removed dead code.

## Oct 2026 — display mode
- Light / System / Dark toggle in the top bar (remembered per browser; System follows the OS setting live).
  Hard-coded white/grey colours were moved onto theme variables so every screen follows the chosen mode.

## Oct 2026 — feedback batch 2 (12 items)

**Database:** migrations `0018_pitch_lost_stages_drop_partial.sql` and `0019_rebalance_template_weights.sql`
(scales template weights to exactly 100%, ratios and scores unchanged) — both applied to the live database.

### Adoption Template
- Module weights total ≤ 100%; each module's parameter weights total ≤ 100%. Edits that would exceed are
  refused. Over-limit data (modules were 118%; Registration/Inventory/Operations/Master Config/Branding
  parameters over 100%) was rebalanced to exactly 100% by migration 0019, keeping every ratio.
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
