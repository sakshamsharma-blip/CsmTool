# Changelog

Newest first. Add an entry whenever a batch of work is finished (CLAUDE.md asks for this).

## Oct 2026 — new modules In plan by default, Resource regions
**Database (applied):** `0041_module_plans_resource_region.sql`.
- A new module is added to every Plan when it's created, so its Adoption-category parameters show **In plan** by
  default for every lab (untick a Plan in Apply Rules if needed). 0041 does the same for the two modules created
  before this (Contract / Order Form, Finance Management); anything a CSM set by hand is kept.
- Resources: new **Region** field (All regions / Domestic / ROW), shown as a column, with a region filter.

## Oct 26 2026 — Live stages, stage analytics, Feedback & NPS round 2
**Database (applied):** `0040_live_stages_testimonial_dates.sql`.
- **Live stages:** In plan is now To-Do → In Discussion / Demo → Trial → Onboarding / Setup → Live 1 → Live 2 → Live 3
  → Live 4 → Adopted, strictly one step at a time (Lead / Admin can step back). Each Live step unlocks a week after
  the previous one; Adopted unlocks a month after Live 1 and needs an adoption note. Not Required / Not Applicable /
  Did Not Meet Requirements can still be set from any stage. Scores: Live 1–4 = 92 / 94 / 96 / 98.
- **Expansion:** "Onboarding / Setup" removed (onboarding happens after Purchased); those add-ons moved to Trial.
- **Adoption tab:** four pies — Overall, Mandatory, In plan, Not in plan. Stages in shades of one colour (light =
  early, dark = adopted; Expansion orange; closed grey), % on each slice, centre = adoption score, a full legend with
  count and %, hover any slice for the exact stages and parameters, plus a count-per-stage table.
- **My Portfolio analytics:** KPI row (avg adoption, labs at 85%+, parameters adopted, in Live, add-ons to pitch,
  purchased), Labs by adoption band, Pitch pipeline, Adoption by module split by stage (weakest first, table view) —
  hover anything for the labs / features / parameters behind it. New "Live monitoring" list (which lab is in which
  Live step, and when the next step unlocks).
- **Feedback & NPS:** parent labs only; tabs Responses → Testimonials → Report; sources Google Form / Email / WhatsApp;
  "Given by" picked from the lab's POCs (or add one from the form); testimonials in the same table format with the
  date collected; Average NPS shown out of 10; By CSM adds total labs, labs with feedback and coverage; new By
  designation report; designation filter.
- **POC designation** is now a dropdown (with "Other…").
- **Rescale to 100% keeps what you set:** new or changed weights stay as typed and only the untouched ones are scaled,
  in their current ratio (e.g. 40/30/30 + a new 20 → 32/24/24/20). Shown first as an editable preview — parameters
  and modules alike (the "Make room" window when adding a module works the same way).
- **Financial Reports:** CSM share of total labs and total revenue.
- Fix: dropdowns inside popups (e.g. the lab picker when recording feedback) were cut off; popups now scroll.

## Oct 23 2026 — Feedback & NPS reworked
**Database (applied):** `0039_feedback_nps_responses.sql`.
- Feedback & NPS is now a place to RECORD responses collected offline (call, visit, Google Form, email, WhatsApp):
  NPS 0–10 and/or a 1–5 rating, who gave it (name, designation), source, comment and a supporting link.
- Tabs: Responses (edit / delete), Report (NPS score, promoters / passives / detractors, average rating, by CSM and
  by lab, CSV export), Testimonials. Filter by lab, CSM, source and date range.

## Oct 23 2026 — batch 5: new status lists, Tasks rework, Feedback & NPS, Resources
**Database (applied):** `0038_new_stages_feedback_resources.sql` — renames existing statuses (Not Started → To-Do,
In Progress → Onboarding / Setup, To Do → To-Do, Added → Purchased), lets a module be deleted while keeping its
Collections entries, adds parameter order, and the Feedback / Testimonials / Resources tables.
- **New status lists.** In plan: To-Do (default) · In Discussion / Demo · Trial · Onboarding / Setup · Adopted ·
  Not Required · Not Applicable · Did Not Meet Requirements. Not in plan: To-Do · Pitching · Trial · Onboarding /
  Setup · Purchased · Not Required · Not Applicable (+ Lost in Expansion / Lost after Purchase kept at the end, so the
  MRR drop and Contraction logging still work). Purchased moves the feature onto the In-plan list. Scores: In plan
  70 / 75 / 80 / 90 / 100, Not in plan 0 / 10 / 30 / 50; Not Required, Did Not Meet Requirements and Lost = 0; Not
  Applicable is left out of the score.
- **Lab Adoption tab:** two pies — In-Plan vs Not-in-Plan, Mandatory vs Optional — each with its adoption % and
  parameter count; a stage filter.
- **My Portfolio:** Avg Adoption by Module now shows, per module, the share of labs in each score band.
- **Tasks:** Adoption/Expansion items appear only once they're under way (not at To-Do), with lab, In-Plan /
  Not-in-Plan, item, days since started, status dropdown and "Remind me". Task list can be sorted by due date.
  Sidebar shows a green count of new tasks since you last opened Tasks.
- **Feedback & NPS** (new): Feedback (1–5 ratings) and Testimonials (video links by designation), filter by lab / CSM.
- **Resources** (new): team documents and training material, plus all module links.
- **Points of Contact** moved to its own tab on the lab page.
- **Adoption Template:** drag parameters to reorder; a weight can be 0; adding a module past 100% asks which modules
  to reduce; deleting a module no longer fails when Collections entries point at it (after 0038).
- **Total Labs:** sorted by MRR (high → low) by default, new column order, Consolidated / Per-Branch label removed,
  first columns frozen while scrolling sideways.
- **Financial Reports:** people with no labs aren't listed.
- **Dashboard:** Churn Count, MRR Churned, ARR Churned, MRR Contraction and MRR Churn % — overall, per CSM, and in
  the By CSM table.
- Smoke tests: 13.

## Oct 2026 — Support & Tickets → Flow
- The sidebar's "Support & Tickets" (previously greyed out as Planned) now opens Flow
  (https://creliohealthflow.vercel.app/) in a new tab.

## Oct 2026 — engagement, time spent, module links, billing periods
- **Invoice upload reading** is more tolerant ("Invoice#" / "Invoice No.", dd-mm-yyyy / "15-Oct-2026" dates, "Rs."
  amounts) and always says WHY a PDF couldn't be read (password-protected, damaged, scanned/no text, which fields
  are missing, or "the app was updated — refresh" with a Refresh button). Parsing lives in `lib/invoiceText.js`.
**Database (both applied):** `0036_engagement_type_and_module_resources.sql`; `0037_invoice_billing_periods.sql`.
- **Billing periods:** invoices can be Monthly, Quarterly, Half-yearly or Annual (or one-off Pro-Rata). MRR = sub
  total ÷ months covered; each invoice shows the period it covers and the lab shows "Billed up to". Upload defaults to
  the lab's Payment Cycle. Average MRR uses each invoice's per-month value.
- Log Check-in and Log Visit require **Proactive / Reactive**; editable on the visit detail.
- Lab page: **Time Spent** (sum of check-in durations) in the header; Lab History shows time spent (all / 30 days /
  this year) and Proactive / Reactive counts.
- "Tasks for Today" panel (Dashboard, My Portfolio) gets a lab filter (the Tasks page already had one).
- **Docs & training-video links per module**, shared across all labs — add/edit from the Adoption Template or any
  lab's Adoption tab (📚 badge on the module).

## Oct 2026 — fix: lost-after-purchase trials
- A feature marked "Lost after Purchase" no longer offers "Add charges" (Adoption tab, Collections tab) or a
  rollout status; it shows a "Lost after purchase" tag instead (also on My Portfolio).
- Same for a bought feature moved to "Lost in Expansion": it counts as lost (score 0, no charges / rollout).
  Bought features now only offer "Lost after Purchase" (which lowers MRR and logs a Contraction).

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
