# CSM Tool

An internal CrelioHealth tool for the Customer Success team. It replaces the old Excel-based process
for tracking diagnostic-lab clients: which features each lab has adopted, what they pay (MRR),
upsell/expansion deals, visits and check-ins, follow-up tasks, and a full history per lab.

It is **live and in daily use** at `csm-tool-two.vercel.app`, and still being actively built out.

> Working on this with an AI assistant? Read [CLAUDE.md](CLAUDE.md) first — it holds the business
> rules, workflow rules (including git/commit rules) and current status. Keep both files up to date
> as the project changes.

## What it does

| Area | What it's for |
| --- | --- |
| **Customer Master (Labs)** | Every lab, with Plan, CSM owner, region, parent/child hierarchy, editable Lab Name and Lab ID |
| **Adoption Template** | The catalog of modules/parameters; each is Adoption (base plan) or Expansion (paid add-on), Mandatory or Optional. Module weights total exactly 100%, and so do each module's parameter weights (one-click Rescale). Editable by CSM Leads / Admins |
| **Plans** | LIMS Starter/Growth/Advance/Premium/Enterprise, each with a default scope |
| **My Portfolio / Dashboard** | A CSM's own labs and KPIs; Leads/Admins can switch to Team View |
| **Collections** | Invoices (PDF upload with auto-extraction), MRR, payments, trial→chargeable conversion |
| **Adoption (per lab)** | Each parameter is In plan (To-Do → In Discussion / Demo → Trial → Onboarding / Setup → Live 1–4 → Adopted, forward only, skipping allowed, no waiting times, or Not Required / Not Applicable / Did Not Meet Requirements) or Not in plan (To-Do → Pitching → Trial → Purchased, or Not Required / Not Applicable / Lost). A purchased add-on moves onto the In-plan list. Every change needs a comment |
| **Expansion** | Deal tracking with Pipeline/Lost/Live MRR; add-on pitches are worked from My Portfolio, Tasks and each lab's Adoption tab |
| **Visits & Meetings** | Offline (in-person) visits only: log a past visit, or plan a future one (becomes a task) |
| **Log Check-in** | Calls, visits, emails, WhatsApp, notes — with sentiment, flagged modules and action items; action items and follow-ups become tasks |
| **Tasks** | Follow-ups, action items, reminders, plus every Adoption / Expansion item that is under way (past To-Do) with days open and a status dropdown. Sort by due date; a WhatsApp-style counter on the sidebar shows new tasks |
| **Feedback & NPS** | CSMs record feedback collected via Google Form, email or WhatsApp (NPS 0–10, 1–5 rating, given by a lab POC, comment, link) and testimonial videos; report by CSM, designation and lab (parent labs) |
| **Resources** | The team's common documents and training material, plus every module's docs/training links |
| **Lab History** | Activity log of everything that happens to a lab |
| **Health, churn, reports** | Health tracking, stage tags, churn logging, reports |

**Not real yet:** Zoho Books sync (Collections simulates it), full Plan CRUD, KPI Management, Automation (greyed
out as "Planned" in the sidebar). Support & Tickets opens Flow, a separate tool.

## Who can see what

Roles are CSM, CS Lead and Admin. A CSM sees only their own labs; Leads and Admins see everyone. Only Leads/Admins
can edit the Adoption Template, reassign labs and manage the team; only the Admin can change someone's role.
This is enforced in the database with Row Level Security (migration 0012), not just in the UI. A
person can have two login emails (@livehealth.in and @creliohealth.com) that land on one profile.

## Tech stack

- **Frontend:** React 19 + [Vite](https://vitejs.dev)
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth and Row Level Security. There is no
  separate server; the browser talks to Supabase through `@supabase/supabase-js`.
- **Hosting:** Vercel, auto-deploying on every push to `main`.

## Project structure

```
src/
  supabaseClient.js   creates the Supabase client from env values
  lib/                data-access layer, one file per domain (labs, collections, expansion,
                      adoption, catalog, plans, visits, tasks, invoices, ...) plus shared helpers
                      (format.js, fx.js, roles.js, useScopedCsm.js)
  views/              one file per screen (LabsView, LabDetailView, CollectionsView, ExpansionView, ...)
  components/         shared pieces (Sidebar, TopBar, Modal, drawers, SearchSelect = type-to-filter dropdown,
                      PitchStageModal = stage-change confirm with optional comment, ...)
  App.jsx             auth state, data loading, which view is showing
  index.css           all styling
migrations/           numbered SQL files = the full history of the database schema (0001 ... latest)
GO_LIVE.md            setup, verification and deployment guide
MIGRATION_PLAN.md     historical — original build plan, superseded by GO_LIVE.md
CLAUDE.md             context and working rules for AI sessions (and a good summary for humans)
archive_*.html        earlier single-file versions, kept only as reference
```

## Running it locally

```
npm install
cp .env.example .env.local     # fill in the Supabase URL and anon key (Supabase → Settings → API)
npm run dev
```

Without env values the app starts in **demo mode** (seeded local data, no login, nothing saved).
Never commit `.env` / `.env.local`.

Checks before shipping a change: `npm run build`, `npm run lint` and `npm run test:e2e` (Playwright smoke
tests in `tests/`, run against demo mode — first time: `npx playwright install chromium`) should all pass.

## Database changes

- Schema lives in `migrations/`. Never edit a migration that has already been run — add a new file
  `migrations/NNNN_description.sql` (next sequential number) with only the new SQL.
- Migrations are run by hand, in order, in the Supabase **SQL Editor**, then committed to the repo.
- Every new table needs Row Level Security policies in the same shape as migration 0012
  (`is_lead_or_admin()` / `current_profile_id()`).
- The live Supabase project ("CSM console") is the final source of truth if the repo and the database
  ever disagree.
- The data is real customer data. Prefer migrations that are provably safe against existing rows.

## Key business rules (short version — full list in CLAUDE.md)

- Always convert to INR before summing money across labs (Domestic = INR, ROW = USD).
- Parent/Child billing: **Consolidated** uses the parent's MRR; **Per-Branch** sums the children's.
- A *Monthly* invoice sets a lab's MRR; a *ProRata* invoice adds to it until the next Monthly invoice.
- Purchasing a feature (Priced or Trial) creates a Collections entry but doesn't change MRR; "Lost after
  Purchase" lowers MRR by that feature's charge and logs a Contraction.
- `labs.id` is the permanent internal key; `labs.lab_code` is the editable, user-facing "Lab ID".
- Adoption features are always in scope; Expansion features are pitched and sold.
- `activity_log.source` accepts only `'system'` and `'checkin'`.

## Deploying

Pushing to `main` triggers an automatic Vercel build and deploy, so a push is a production release.
The two env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in Vercel's project
settings, not in the repo. After a deploy, confirm the site isn't silently in demo mode (that means
the env vars are missing). See `GO_LIVE.md` for the full verification checklist.

## Troubleshooting

**`sh: vite: command not found` right after `npm install`** — a known npm bug with platform-specific
optional dependencies ([npm/cli#4828](https://github.com/npm/cli/issues/4828)):

```
rm -rf node_modules package-lock.json
npm install
npm run dev
```

Needs Node 18+, and the command must be run from the folder containing `package.json`.

## Ownership

The repo (currently under a personal GitHub account) and the Supabase project should eventually live
under CrelioHealth-owned accounts so the tool survives any one person's availability.
