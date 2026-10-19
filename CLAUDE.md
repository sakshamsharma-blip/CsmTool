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
  - Migrations were run by hand, so Supabase's migration-tracking table is empty
    (`list_migrations` returns nothing). The live schema is still the final source of truth if
    the repo and database ever seem to disagree — inspect it directly rather than guessing.

## Supabase

- Project name "CSM console", ref `fviorzjezigvjevlsdrv`, region ap-south-1.
- The same Supabase org also has two unrelated projects (`CSxProduct`, `iiet-staging`) — don't
  mix them up when picking a project ID.
- RLS is the real security boundary (tightened in migration 0012) — per-CSM visibility enforced
  via `is_lead_or_admin()` / `current_profile_id()` in policies, not just a UI-level role check.
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
- **Invoices**: `invoice_type = 'Monthly'` updates the lab's MRR; `'ProRata'` is a one-off top-up
  that never touches MRR.
- **Lab identity, split on purpose**: `labs.id` is the internal primary key, set once at creation,
  referenced by every other table's `lab_id` foreign key — it is never renamed. `labs.lab_code` is
  the separate, freely-editable, user-facing "Lab ID" (unique; case-sensitive at the DB level,
  checked case-insensitively in the UI) — this is what Add Lab, search, and Lab Details actually
  show and let you edit as "Lab ID."
- **Adoption vs Expansion**: Adoption = base-plan features, always in scope, tracked only on
  rollout status, never pitched/sold. Expansion = paid add-ons, pitched/sold through a 7-stage
  vocabulary (To Do → Pitching → In Progress → Added → Not Required, plus the two terminal
  stages Lost in Expansion and Lost after Purchase). A module/param's category is a deliberate
  one-time choice made on the Adoption Template — never inferred per lab.
- **Adoption status** of a parameter is Not Started (0%) / In Progress (25%) / Adopted (100%).
  "Partially Adopted" was removed (migration 0018 moves existing rows to In Progress).
- **Mandatory vs Optional** (Adoption Template, per parameter): Mandatory parameters drive the
  *Mandatory Completion* score; Optional ones only count toward *Overall Adoption*. A module's
  score is the weighted % of its in-scope parameters; a lab's score is the module scores weighted
  by module weight over that lab's in-scope modules only.
- **Weights are percentages of 100**: all module weights together, and all parameter weights
  inside one module, may each total at most 100%. The Adoption Template refuses edits that would
  push a total past 100 (data already over 100 is flagged in red, never silently rewritten).
- **Pitch-stage changes** (My Portfolio, Tasks → Pitch Reminders, and each lab's own Adoption tab —
  all three edit the same `pitch_status` rows, so they must always agree) always open a confirm dialog
  with an *optional* comment, and every change is written to Lab History as a check-in-sourced
  entry (`activity_log.source = 'checkin'`, `details.pitch` = from/to/comment). The two Lost
  stages only record the outcome — they never change scope, Collections or MRR.
- **Visits & Meetings = offline visits only** (type "Visit"). A past visit is logged to Lab
  History; a future one is *planned* as a task (`tasks.type = 'planned-visit'`, due on the visit
  date, owned by the lab's CSM). Calls/emails/WhatsApp/notes are logged only via Log Check-in.
- **Log Check-in → Tasks**: each action item becomes a task (`type = 'action-item'`), the next
  follow-up date becomes a follow-up task, and each flagged module a training follow-up task. Only
  the follow-up task carries `source_visit_id` (editing the visit keeps that one in sync).
- **Searchable dropdowns**: every lab picker (parents *and* children), country and state uses
  `components/SearchSelect.jsx` (type to filter). Any new picker should use it too.
- **MRR editing**: any lab (parent or child) can have its own MRR edited in Lab Details. Which
  value is *counted* still follows billing mode — Consolidated = the parent's own MRR (set by the
  group's Monthly invoice), Per-Branch = sum of the children. ARR = MRR × 12 everywhere.
- **Total Labs and Dashboard tiles**: Total Labs, Parent Labs (Clients), Child Labs.
- **Plans** are a real named entity (LIMS Starter/Growth/Advance/Premium/Enterprise), each with a
  default module/param scope. A lab's actual scope can deviate from its Plan's defaults, but
  deviating never renames or forks the Plan — it only produces a deviation note, logged to Lab
  History.
- Marking an Expansion feature "Added" moves it into the lab's adopted scope, creates an itemized
  Collections entry, and logs to Lab History — trial/free items still get logged (at ₹0 / flagged
  trial), never skipped.
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
3. **Verify before calling anything done.** `npm run build` and `npm run lint` should be clean —
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
  manual), full Plan CRUD beyond toggling module/param membership, Support & Tickets, Feedback &
  NPS, KPI Management, Automation (all still "Planned" and greyed out in the sidebar).
- Latest migration: `0019_rebalance_template_weights.sql` (0018 and 0019 are both applied).
- Template weights were over 100 (modules 118%; Registration/Inventory/Operations/Master Config/Branding
  parameters 126–212%); `0019_rebalance_template_weights.sql` scaled them to exactly 100 keeping every
  ratio (scores unchanged) — applied Oct 2026. Weights are stored as decimals (2 places), so they may
  show as e.g. 8.47. Branding Solutions' parameters total 55 (under the limit, left as is).

## If you're a different Claude session reading this

If another Claude session (e.g. a Cowork session) might be working on this same repo at the same
time: avoid editing the same files simultaneously, and pull the latest commit before starting so
you're not working from a stale copy.
