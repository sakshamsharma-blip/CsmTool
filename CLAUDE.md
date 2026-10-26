# CSM Tool — Project Context & Working Rules

This file is here so any Claude session (Cowork, Claude Code, etc.) working in this repo starts
with the same context and follows the same rules. Read it fully before making changes.
**Keep it current:** when a rule, decision, or the state of the product changes, update this file
(and `README.md` if it affects a newcomer's understanding) as part of the same piece of work.

## What this is

- An internal CrelioHealth tool for Customer Success Managers (CSMs) to track labs (clients):
  adoption of features, collections/MRR, expansion/upsell deals, visits, tasks, lab history.
- Live and in real use — not a prototype. Deployed at `csm-tool-two.vercel.app`.
- Repo: `git@github.com:sakshamsharma-blip/CsmTool.git`.
- Still actively being built out and fixed — expect ongoing changes, not a finished product.

## Stack & structure

- Vite + React 19, Supabase (Postgres + Auth + Row Level Security).
- `src/lib/*.js` — data-access functions, one file per table/domain (labs.js, collections.js,
  expansion.js, adoption.js, catalog.js, etc.).
- `src/views/*.jsx` — full pages (LabDetailView, CollectionsView, ExpansionView, etc.).
- `src/components/*.jsx` — shared widgets (modals, drawers, sidebar, top bar).
- `migrations/*.sql` — schema history. Each file is run once, in order, manually in Supabase's
  SQL Editor. **Never edit a migration that's already been run — always add a new numbered file.**
  - `0001_init.sql` is in the repo and creates the base tables (modules, module_params, plans,
    plan_modules, plan_excluded_params, profiles, labs, scope_overrides, param_scope_overrides,
    param_states, pitch_status, collections_items, tasks, activity_log). `profile_emails` and
    `profile_auth_links` come from `0006_identity_linking.sql`.
  - Migrations are run by hand in the SQL Editor; since 0026 each file also records itself in
    `supabase_migrations.schema_migrations`, so the applied list is visible there. The live schema is still
    the final source of truth if the repo and database ever seem to disagree — inspect it directly.

## Supabase

- Project name "CSM console", ref `fviorzjezigvjevlsdrv`, region ap-south-1.
- The same Supabase org also has two unrelated projects (`CSxProduct`, `iiet-staging`) — don't
  mix them up when picking a project ID.
- RLS is the real security boundary (tightened in migration 0012) — per-CSM visibility enforced
  via `private.is_lead_or_admin()` / `private.current_profile_id()` in policies (moved out of `public` by 0035), not just a UI-level role check.
  Any new table needs its own RLS policy written in that same tightened shape.
- If Supabase MCP tools are available in the session, use them to inspect the live schema/data —
  far safer than guessing at what live data looks like. Read-only inspection is fine any time;
  **applying a migration or writing data through MCP only when explicitly asked.**
- Supabase access is configured per Claude surface/session, not shared automatically.

## Core domain rules — how the business logic actually works

- **Money**: `fmtUSD`/`fmtINR` round via `Math.round`; `toINR`/`toUSD`/`nativeCurrency`/
  `fmtMoney(amount, lab.region)` convert between Domestic (INR) and ROW (USD). Labs can be in
  different native currencies — **always convert to INR before summing across labs**.
- `activity_log.source` only accepts `'system'` and `'checkin'` (a DB check constraint) —
  `'manual'` is rejected.
- **Parent/Child billing mode**: "Consolidated" = the parent's own `mrr` is the real number,
  children's are ignored. "Per-Branch" (default) = children's `mrr` summed, parent's own ignored.
  This governs whether a lab's MRR should even be directly editable.
- **Invoices & MRR** (Oct 2026): invoices are recurring — `Monthly` (1), `Quarterly` (3), `HalfYearly` (6),
  `Annual` (12 months) — or a one-off `ProRata`. A recurring invoice SETS the lab's MRR to sub total ÷ its months
  (₹60,000 half-yearly → MRR ₹10,000) and covers that many months from its invoice date (`coveredUntil`; shown as
  "Covers … till" and "Billed up to"). A `ProRata` invoice ADDS its sub total to the current MRR until the next
  recurring invoice. Upload defaults the type from the lab's Payment Cycle unless the PDF's "Invoice For …" line
  says otherwise. Helpers: `INVOICE_TYPES`, `monthlyEquivalent`, `coveredUntil` in `lib/invoices.js`. Editing or
  deleting an invoice moves MRR only by the difference that change implies (`invoiceImpliedMrr` in
  `lib/invoices.js`), so manual MRR edits / Lost-after-Purchase drops made since are kept.
- **Lab identity, split on purpose**: `labs.id` is the internal primary key, set once at creation,
  referenced by every other table's `lab_id` foreign key — it is never renamed. `labs.lab_code` is
  the separate, freely-editable, user-facing "Lab ID" (unique; case-sensitive at the DB level,
  checked case-insensitively in the UI) — this is what Add Lab, search, and Lab Details actually
  show and let you edit as "Lab ID."
- **Adoption model v2 (Oct 2026) — supersedes the old "in scope" rules below where they conflict.** Every lab
  sees the whole template (no module/parameter "In scope" switches). Per lab, per parameter: **In plan** (=
  Adoption, tracked by rollout status) or **Not in plan** (= Expansion: pitch stages → purchased → rollout).
  Default: In plan when the lab's Plan includes it AND its template category is Adoption (`param_states.in_plan`
  NULL = default). **Status lists (migrations 0038 + 0040)** — In plan (`param_states.status`, `STATUS_ORDER`):
  To-Do 70 · In Discussion / Demo 75 · Trial 80 · Onboarding / Setup 90 · Live 1 92 · Live 2 94 · Live 3 96 · Live 4
  98 · Adopted 100 · Not Required 0 · Not Applicable (left OUT of the score) · Did Not Meet Requirements 0. **The
  In-plan list is strictly one step forward** (`statusOptions` / `setParamStatus` in `lib/adoption.js`, used by the
  Adoption tab and Tasks): each Live step unlocks 7 days after the previous one (`param_states.status_changed_at`),
  Adopted unlocks 30 days after Live 1 started (`param_states.live_started_at`) and its comment is the adoption note;
  Not Required / Not Applicable / Did Not Meet Requirements can be set from any stage; only a CSM Lead / Admin can step
  back (UI-enforced, not a DB trigger). Not in plan (`pitch_status.status`, `PITCH_STATUSES`): To-Do 0 · Pitching 10 ·
  Trial 30 · Purchased · Not Required 0 · Not Applicable (left out) · Lost in Expansion 0 · Lost after Purchase 0
  (Expansion "Onboarding / Setup" removed Oct 26 2026; 0040 moved those rows to Trial). **Purchased moves the feature onto the In-plan
  list** (it starts at To-Do = 70 and climbs to Adopted 100; data-wise it stays `in_plan=false, included=true`).
  Old names (Not Started / In Progress / To Do / Added / Expansion Onboarding) are mapped on read (`normalizeStatus` /
  `normalizePitch`). Module = weighted avg of params; lab = weighted avg of modules. The Adoption tab shows four pies
  — Overall, Mandatory, In plan, Not in plan — sliced by stage group (`STAGE_GROUPS` / `EXPANSION_GROUPS` /
  `stageGroupOf`), slice = parameter COUNT, centre = weighted adoption score; hover a slice or legend row for the exact
  stages and parameters; "Show details" = count-per-stage table (`components/AdoptionPies.jsx`); plus a stage filter.
  My Portfolio analytics live in `components/PortfolioCharts.jsx`: KPI row, Labs by adoption band, Pitch pipeline and
  Adoption by module (stage-split bars, weakest first, chart/table toggle) — every mark has a hover card with the
  labs / parameters behind it (`lib/useChartTooltip.jsx` + `components/ChartTooltip.jsx`). A "Live monitoring" list
  shows every item in Live 1–4 by lab with when its next step unlocks. **Chart colours** are CSS variables
  (`--stg-plan-1…5` blue ramp for In-plan stages light→dark, `--stg-exp-1…3` orange for Expansion, `--stg-closed`
  grey, each with a `-ink` label colour) defined for light AND dark in `index.css`, validated as ordinal ramps. Every change
  on a lab's Adoption tab needs a comment and saves immediately (`param_changes` audit trail; newest comment
  shown under the parameter; click the name for the history). The Adoption tab lives in
  `components/LabAdoptionTab.jsx`. Log Check-in's Adoption Snapshot marks modules and/or parameters as
  *discussed* (`visits.flagged_modules` / `visits.discussed_params`) — it no longer creates follow-up tasks.
- **Engagement** (Oct 2026): every check-in / logged visit must be marked **Proactive** or **Reactive**
  (`visits.engagement`; older rows NULL). **Time spent on a lab** = sum of its check-ins' Duration
  (`lib/labEngagement.js`), shown on the lab page header and Lab History tiles with the Proactive/Reactive split.
- **Module docs & training links** (`module_resources`, `components/ModuleResources.jsx`): per MODULE, shared by
  all labs; anyone can add from the Adoption Template or a lab's Adoption tab; the adder or a Lead/Admin can
  edit/remove (DB-enforced).
- "Tasks for Today" (Dashboard / My Portfolio) and the Tasks page both have a lab filter.
- **Tasks page** (Oct 23 2026): lists every Adoption/Expansion item that is UNDER WAY — In plan: In Discussion /
  Demo, Trial, Onboarding / Setup, Live 1–4; Not in plan: Pitching, Trial (`buildActiveItemRows` in
  `lib/pitch.js`). Items at To-Do are NOT tasks. Each row: lab, In-Plan / Not-in-Plan, item, days since it got under
  way (from `param_changes`), status dropdown, "Remind me" (creates a `tasks.type='reminder'` task). The task list
  can be sorted by due date. Sidebar Tasks shows a green unread count of the signed-in person's tasks created since
  they last opened Tasks (`lib/taskNotifications.js`, remembered per browser).
- **Feedback & NPS** (sidebar, `views/FeedbackView.jsx`, `lib/feedback.js`, tables `lab_feedback` / `lab_testimonials`):
  labs give feedback OFFLINE (Google Form, Email, WhatsApp — the sources offered) and the CSM records each response
  manually — NPS 0–10 and/or rating 1–5 (at least one), given by (picked from the lab's POCs, or a new POC added from
  the form), source, comment, optional supporting link. PARENT labs only (child-lab rows count under the parent).
  Tabs in order: Responses, Testimonials (same format, with `collected_on` date — 0040), Report (Average NPS out of
  10, promoters 9–10 / passives 7–8 / detractors 0–6, avg rating; By CSM with total labs + labs with feedback +
  coverage; By designation; By lab; CSV export). Filters: lab, CSM scope, designation, source, date range.
- **POC designation** is a dropdown (`POC_DESIGNATIONS` in `lib/labContacts.js`, `components/DesignationSelect.jsx`,
  with "Other…" to type one); older free-text values are kept until edited. Used on Points of Contact, Log Check-in
  and the Feedback "+ Add POC".
- **SearchSelect** renders its list in a portal on `<body>` (fixed, re-measured every frame while open) so popups
  and scrolling cards can't clip it. Modals scroll when taller than the screen.
- **Financial Reports → MRR Breakdown** starts with "CSM share of the book": labs handled and MRR handled per CSM as %
  of the whole company.
- **Resources** (sidebar, `views/ResourcesView.jsx`, table `resources`): team-wide docs / training links + a
  roll-up of every module's links. Each resource has a **Region** — All / Domestic / ROW (0041); the region filter
  for Domestic or ROW also shows "All regions" resources.
- **Total Labs**: default sort MRR high → low (in INR); columns Lab ID, Lab Name, Type, CSM Name, MRR, Segment,
  Region, Status, Health, Lab Health, City, State, Country; the first columns stay frozen when scrolling sideways.
  No Consolidated / Per-Branch label in the list (it lives on the lab's Child Labs tab).
- **Dashboard churn tiles** (overall and per CSM): Churn Count, MRR Churned, ARR Churned, MRR Contraction, MRR
  Churn % (= MRR Churned ÷ current Total MRR of the view), all time from `churn_log`, by the lab's CSM.
- Financial Reports hides people with no labs.
- **Adoption vs Expansion (per lab)**: In plan = Adoption (tracked only by rollout status, never pitched);
  Not in plan = Expansion (pitched through To Do → Pitching → In Progress → Added → Not Required, plus the
  terminal Lost in Expansion / Lost after Purchase). The template's category is only the DEFAULT; each lab's
  CSM sets In plan / Not in plan per parameter on the lab's Adoption tab (adoption model v2 above).
- **Rollout status** of an In-plan or purchased parameter is Not Started / In Progress / Adopted (scored
  70 / 85 / 100 — see the v2 ladder above). "Partially Adopted" was removed (migration 0018).
- **Mandatory vs Optional** (Adoption Template, per parameter): the lab's *Mandatory* score uses only
  Mandatory parameters; the overall *Adoption score* uses all of them. Both use the same v2 ladder and
  weighting (parameters by parameter weight within a module; modules by module weight).
- **Weights total exactly 100%**: all module weights together, and all parameter weights inside one
  module, must each total exactly 100%. A weight may be **0**. Adding a module that would push the total past 100
  opens "Make room" (other modules pre-reduced proportionally, editable). Parameters can be dragged into order
  (`module_params.sort_order`, saved with Save Changes). Deleting a module keeps its Collections entries (FK set
  null, 0038). Edits are allowed while working (e.g. adding a parameter), but any
  group that isn't 100 shows a red warning with "Rescale to 100%". **Rescale keeps what you touched** (decision
  Oct 26 2026): parameters added or whose weight was changed in the current draft — and, for modules, modules added or
  re-weighted this visit — stay exactly as set (🔒); the untouched ones are scaled in their current ratio to fill the
  rest (`rescaleKeeping` in `lib/catalog.js`; e.g. 40/30/30 + new 20 → 32/24/24/20). It opens an editable preview
  first (parameters apply to the draft; modules apply on Apply). Nothing is rescaled automatically. Only a CSM Lead / Admin can edit the template (view-only for CSMs; DB: 0024).
- **Pitch-stage changes** (My Portfolio, Tasks → Pitch Reminders, and each lab's own Adoption tab —
  all three go through `applyPitchStageChange` in `lib/pitch.js`, so they always agree) open a confirm
  dialog with a **required** comment, and every change is written to Lab History as a check-in-sourced
  entry and to the parameter's own history (`param_changes`). "Lost in Expansion" only records the outcome (and is not offered once a feature has been bought; a bought feature already at either Lost stage counts as lost — score 0, no charges/rollout). "Lost after Purchase" also drops the lab's MRR by
  the feature's charge (its newest priced Collections entry) and logs a Contraction in the churn log
  (Financial Reports); the next recurring invoice resets MRR.
- **Visits & Meetings = offline visits only** (type "Visit"). A past visit is logged to Lab
  History; a future one is *planned* as a task (`tasks.type = 'planned-visit'`, due on the visit
  date, owned by the lab's CSM). Calls/emails/WhatsApp/notes are logged only via Log Check-in.
- **Log Check-in → Tasks**: each action item becomes a task (`type = 'action-item'`) and the next
  follow-up date becomes a follow-up task (the only one carrying `source_visit_id`, so editing the visit keeps
  it in sync). Adoption Snapshot ticks only mark what was *discussed* — they create no tasks.
- **Searchable dropdowns**: every lab picker (parents *and* children), country and state uses
  `components/SearchSelect.jsx` (type to filter). Any new picker should use it too.
- **MRR editing**: any lab (parent or child) can have its own MRR edited in Lab Details. Which
  value is *counted* still follows billing mode — Consolidated = the parent's own MRR (set by the
  group's recurring invoice), Per-Branch = sum of the children. ARR = MRR × 12 everywhere.
- **Total Labs and Dashboard tiles**: Total Labs, Parent Labs (Clients), Child Labs.
- **Due dates & overdue** (Oct 2026): due date = LAST day to pay = start date + credit days − 1 (`dueDateFor` in
  `lib/dates.js`). Invoice Oct 1 + 7 credit days → due Oct 7; Oct 8 = 1 day overdue. Collections items use the
  same rule from their added date. Migration 0029 shifted existing invoice due dates.
- **Adoption Template editing**: changes to a module (name, weight, description) and its parameters (type,
  category, weight, name, description, add/remove) are a DRAFT until "Save Changes"; "Discard" reverts. Plan
  ticks ("Apply Rules"/"Plans") and the module-total Rescale still apply straight away. Modules are ordered by
  `modules.sort_order` (drag ⠿ or ▲▼ in the Module Builder) and labs show them in that order. Module and
  parameter descriptions show as ⓘ on each lab's Adoption tab.
- **Pitch stage comment is mandatory** (every stage change, incl. Mark purchased).
- **Visits & Meetings**: the "Next Visit" on a logged visit becomes a planned visit (Upcoming); planned visits can
  be edited (date, purpose). City column + city filter on both lists.
- **Labs**: `yearly_visits_required` (required when adding a Parent lab, optional for Child). Total Labs has
  Country / State / City type-to-filter dropdowns and a City column.
- **Points of contact** (`lab_contacts`, their own "Points of Contact" tab on the lab page) feed Log Check-in's "Person Contacted"
  (pick or type; a new name can be saved as a POC). **Documents** tab per lab = links only (`lab_documents`).
- Check-in types include **GMeet**. The old "Reports" screen is now **Financial Reports**.
- **Dates**: build `YYYY-MM-DD` strings with `lib/dates.js` (`todayISO`, `addDaysISO`, `daysFromTodayISO`) —
  never `toISOString().slice(0, 10)`, which is UTC and gives yesterday's date in India.
- **Display mode**: Light / System / Dark toggle in the top bar (`lib/theme.js`, saved per browser). Colours must
  come from the CSS variables in `index.css` (`var(--surface)`, `--surface-2/3`, `--text`, …) — never hard-code
  `#fff` or light greys for backgrounds, or that spot stays white in dark mode. Dark values live under
  `:root[data-theme="dark"]`.
- **Plans** are a real named entity (LIMS Starter/Growth/Advance/Premium/Enterprise), each with a
  default module/param set. **A newly created module joins every Plan** (`handleAddModule` in App.jsx), so its
  Adoption-category parameters default to In plan; a Lead / Admin can untick Plans in "Apply Rules". A lab's Plan only decides each parameter's DEFAULT In plan / Not in plan; the lab's
  CSM can change any parameter (with a comment) without renaming or forking the Plan.
- **Purchasing an Expansion feature** ("Added" stage, or "Mark purchased" on the Adoption tab) asks
  **Priced or Trial** (+ monthly charge if priced), marks it purchased (it stays Not in plan, now tracked by
  rollout status), creates a Collections entry and logs to Lab History. The feature then shows a "Priced ₹X/mo" or "Trial" tag (Adoption tab, My
  Portfolio); a trial has "Add charges". Neither purchasing nor adding charges changes MRR — invoices do.
- **Lab History** (`activity_log`) is meant to capture everything that happens to a lab, whether
  logged manually (a check-in) or as a side effect of any other action anywhere in the app.
- **CSM scoping**: every CSM sees only their own labs by default; a Lead/Admin can switch to
  "Team View" and filter by CSM. This pattern (`useScopedCsm`) is used consistently across
  Dashboard, My Portfolio, Collections, Expansion, Visits, and Tasks — any new portfolio-wide
  screen should follow it too.

## Development workflow rules

1. **Research before writing code.** Ground every change in the actual current code — grep/read
   the real files, and check the live Supabase schema directly when it matters — rather than
   assuming or guessing.
2. **Ask before anything ambiguous or genuinely high-consequence** — schema changes touching a
   primary key, money/financial logic, anything that could corrupt real customer data. Don't ask
   for routine, clearly-scoped changes — just build them and move fast.
3. **Verify before calling anything done.** `npm run build`, `npm run lint` and `npm run test:e2e` should be clean —
   don't introduce new warnings (pre-existing ones in the codebase are fine to leave). Use a
   Playwright smoke pass for anything touching a core flow or the adoption-scoring engine.
4. **Migrations**: one new file per schema change, `migrations/NNNN_description.sql`, sequential
   numbering, never edit an already-run migration. Default is that the file gets run manually in
   Supabase's SQL Editor — only apply it directly via Supabase MCP tools if explicitly asked to.
5. Prefer a migration design that's **provably safe against existing data** over one that merely
   seems likely to work, especially when you can't directly verify what the live data looks like
   — this runs on real customer data, not a sandbox.
6. **Keep the docs current.** Update this file and `README.md` when behaviour, rules, structure or
   status change — don't let them drift from the code.

## Git / commit / deploy rules (confirmed Oct 2026)

- **Default is code changes only.** Write/edit files directly in the repo. Do **not** run
  `git add`, `git commit`, or `git push` unless explicitly asked to, in that specific moment.
- Staging, committing, and pushing is the owner's call — he does it himself unless he says
  otherwise. Approval for one commit/push doesn't carry over to the next.
- Pushing to `main` deploys to Vercel (auto-build on push), so a push is a production release.
  Never push without being told to.
- Claude sessions have no access to Vercel itself (no CLI/connector) and no `gh` CLI; git over SSH
  works from the owner's machine.
- (Historical context: earlier Claude sessions running in a sandboxed cloud container couldn't
  push at all — SSH was blocked. That restriction doesn't apply to a session running directly on
  his own machine, but the "don't commit/push unless asked" rule applies regardless.)

## Where things stand (as of Oct 2026)

- **Fully built & live**: Customer Master (labs, add/list, parent-child hierarchy), Adoption
  Template (seeded from the real module/param catalog), Plans, My Portfolio, Collections
  (invoice upload, Mark Fully Collected, trial→chargeable conversion, direct MRR editing that
  respects billing mode, Average MRR card), Dashboard, Tasks, Visits & Meetings, Expansion (deal
  tracking with Onboarding/Pipeline/Lost/Live MRR + Live ARR tiles), editable Lab Name and Lab ID.
- **Still conceptual / not real yet**: Zoho Books sync for Collections (currently simulated/
  manual), full Plan CRUD beyond toggling module/param membership, KPI Management,
  Automation (still "Planned" and greyed out in the sidebar). **Support & Tickets** is a sidebar link that opens
  Flow (https://creliohealthflow.vercel.app/, the CS ↔ Product escalation tracker) in a new tab.
- Latest migration: `0041_module_plans_resource_region.sql`; **0001–0041 are all applied** (Oct 2026). After 0035 the RLS helpers are `private.current_profile_id()`, `private.is_lead_or_admin()`,
  `private.is_admin()` (not API-exposed) — new policies must call those, not `public.*`. Applied
  migrations are now listed in `supabase_migrations.schema_migrations` — when you run a new file, also add its row
  there (see the note at the top of 0026).
- Leaked-password protection is NOT on — it needs Supabase's Pro plan.
- **Roles**: only the Admin can change a team member's role (UI locks the field; DB trigger in 0021).
- Template weights: 0019 scaled the over-100 groups to 100; 0023 scales any remaining group (Branding
  Solutions, 55%) to exactly 100. Weights are stored with 2 decimals (e.g. 8.47).
- **Reassign CSM** is Lead/Admin only (UI hides it for CSMs; DB trigger in 0024).
- **Reminders live in the app only** (decision, Oct 2026): Tasks, Dashboard "Tasks for Today" and Pitch
  Reminders. No email or Slack sending — the earlier Email/Slack reminder feature was removed from the code, and
  its `notification_prefs` table was dropped by migration 0027 (applied).
- **Filters & paging**: Tasks (lab/type/status), Collections (lab/aging), Expansion (lab/status), Visits
  (lab) and Lab History (type) have filters; long lists page 25 at a time (`components/Pager.jsx`).
- **Tests**: `npm run test:e2e` runs the Playwright smoke tests in `tests/` against demo mode (no database).

## If you're a different Claude session reading this

If another Claude session (e.g. a Cowork session) might be working on this same repo at the same
time: avoid editing the same files simultaneously, and pull the latest commit before starting so
you're not working from a stale copy.
