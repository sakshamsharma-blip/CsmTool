# CSM Tool

Internal tool for CrelioHealth's Customer Success team — replaces the old Excel-based process for tracking diagnostic-lab clients (Customer Master, Plans, Adoption Template, CSM roster, and more to come).

## Tech stack

- **Frontend:** React + [Vite](https://vitejs.dev). Split into components (`src/components`, `src/views`) rather than one giant file — see Project structure below.
- **Backend:** [Supabase](https://supabase.com) — hosted Postgres database, authentication, and an auto-generated REST API. No separate backend server to run; the frontend talks to Supabase directly via `@supabase/supabase-js`.
- **Database schema + seed data:** `migrations/0001_init.sql`, then `migrations/0002_visits.sql`, then `migrations/0003_catalog_description.sql`, then `migrations/0004_collections_zoho.sql`, then `migrations/0005_checkins.sql`, then `migrations/0006_identity_linking.sql` — run once each, in order, against a fresh Supabase project (SQL Editor → paste → Run).

## Project structure

```
src/
  supabaseClient.js       ← creates the Supabase client from .env values
  lib/                    ← data layer: one file per domain (labs.js, plans.js, catalog.js, profiles.js,
                             collections.js), each just wraps the matching Supabase table(s) in a few plain functions
  lib/demoSeed.js          ← seed data used only when .env isn't configured yet (demo mode)
  hooks/useToast.js        ← small shared UI hook
  components/              ← reusable pieces: Sidebar, TopBar, Modal, Toast, LoginScreen, AddLabDrawer, etc.
  views/                   ← one file per screen: LabsView, PlansView, AdoptionTemplateView, CsmSetupView,
                             CollectionsView, LabDetailView, DashboardView, VisitsView, PortfolioView
  App.jsx                  ← wires it all together: auth state, data loading, which view is showing
  index.css                ← all styling (shared across every screen)
migrations/0001_init.sql   ← base schema + seed data — run once, in order, against your Supabase project
migrations/0002_visits.sql ← adds the visits table (Visits & Meetings) — run once, after 0001
migrations/0003_catalog_description.sql ← adds modules.description (Adoption Template) — run once, after 0002
migrations/0004_collections_zoho.sql ← adds collections_items.collected_at (Collections "Last Payment") — run once, after 0003
migrations/0005_checkins.sql ← adds visits columns used by Log Check-in (meeting details, discussion
                             topics, sentiment, flagged modules, action items) — run once, after 0004
migrations/0006_identity_linking.sql ← lets one person sign in with more than one email (e.g. their
                             @creliohealth.com alongside @livehealth.in) and land on the same
                             account/data — run once, after 0005. See GO_LIVE.md to link a second
                             email for someone.
migrations/000N_*.sql      ← future schema changes go here, one file per change, in order (see below)
GO_LIVE.md                 ← the current guide for going from demo mode to a real, deployed tool:
                             Supabase project setup, a real working check, and deployment steps
MIGRATION_PLAN.md          ← historical — the original build plan from when only a few screens were
                             wired up. Superseded by GO_LIVE.md for setup steps; kept for context.
archive_app_single_file.html   ← an earlier, fully working single-HTML-file version of this same app (no
                             build step, same features) — kept as a working reference/fallback, not the
                             version to develop further
archive_prototype.html     ← the original design prototype (seeded/local-only, no database) — historical
                             reference only
```

## Running it locally

```
npm install
cp .env.example .env       # then fill in your Supabase URL + anon key (see below)
npm run dev                # starts a local dev server with hot-reload
```

Without a `.env` file, the app still runs — it falls back to demo mode (seeded local data, no login, nothing saved) so it's always safe to open.

## First-time setup (Supabase project)

1. Create a Supabase project at supabase.com.
2. SQL Editor → paste `migrations/0001_init.sql` → Run. Then paste `migrations/0002_visits.sql` → Run (adds the `visits` table used by Visits & Meetings). Then paste `migrations/0003_catalog_description.sql` → Run (adds an optional description field used by the Adoption Template's Module Builder). Then paste `migrations/0004_collections_zoho.sql` → Run (adds a `collected_at` timestamp used by Collections' "Last Payment" column). Then paste `migrations/0005_checkins.sql` → Run (adds the meeting-detail columns used by Log Check-in). Then paste `migrations/0006_identity_linking.sql` → Run (lets someone sign in with more than one email and land on the same account).
3. Settings → API: copy the Project URL and `anon public` key into your `.env` file (see `.env.example`).
4. Authentication → Providers: enable Email.
5. Authentication → Users: invite each team member.
6. Once someone accepts their invite, link their login to their CSM roster row (SQL Editor):
   ```sql
   update profiles set auth_user_id = '<their-user-id-from-the-Users-tab>' where name = 'Their Name';
   ```

Full detail (Supabase project setup, a real working check before onboarding the team, and deployment) is
in `GO_LIVE.md`.

## Making changes

- **Adding to an existing screen** (e.g. a new field on Labs): edit the relevant file in `src/views/` or `src/components/`, and the matching function in `src/lib/` if it needs to read/write a new column.
- **Adding a new database-backed screen**: add a table via a new migration file (see below), add a small file to `src/lib/` with functions to read/write it (follow the pattern in `src/lib/labs.js`), add a view component in `src/views/`, and wire it into `src/App.jsx` (add a case to the view switch + a nav entry in `src/components/Sidebar.jsx`).
- **Changing the database schema:** don't edit `migrations/0001_init.sql` after it's been run once — add a new file `migrations/000N_your_change.sql` with just the new SQL, run its contents in the Supabase SQL Editor, and commit it here so there's a record of every schema change in order.
- This can all be done by hand, or by asking an AI coding tool (Claude Code, or similar) to make the change and describing what you want — the codebase is small and conventional enough (plain React, no exotic patterns) that a coding agent should be able to work in it without much extra context.

## Deploying

`npm run build` produces a static `dist/` folder — deploy it anywhere that serves static files. Easiest: connect this repo to [Vercel](https://vercel.com) or [Netlify](https://netlify.com) — both auto-detect Vite, auto-build (`npm run build`) and auto-deploy on every push to main. Set the two `VITE_SUPABASE_*` values from `.env.example` as environment variables in the host's project settings (not committed to the repo).

## Troubleshooting

**`sh: vite: command not found` (or `npm run dev` fails right after `npm install`)**

This is a known npm bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)), not something wrong with this repo. Vite installs a small platform-specific native binary as an "optional dependency" — if `package-lock.json` was generated on a different machine/OS than the one you're installing on, npm can resolve the wrong one (or fail partway through), leaving `vite` missing from `node_modules/.bin`. Fix:

```
rm -rf node_modules package-lock.json
npm install
npm run dev
```

This forces npm to resolve the correct native binary for your actual machine. If it still fails, check `node -v` (needs 18+) and make sure you're running the command from inside the `csm-tool-repo` folder (the one with `package.json` in it).

## Ownership note (why this is in a repo at all)

This repo and the Supabase project behind it should live under CrelioHealth-owned accounts (a company GitHub org, a company Supabase org), not a single person's personal account — so the CSM tool keeps working and stays maintainable regardless of who's actively working on it. If either currently lives under a personal account, moving it to a company one is worth doing early.
