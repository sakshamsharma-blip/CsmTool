# CSM Tool

Internal tool for CrelioHealth's Customer Success team — replaces the old Excel-based process for tracking diagnostic-lab clients (Customer Master, Plans, Adoption Template, CSM roster, and more to come).

## Tech stack

- **Frontend:** `app.html` — a single self-contained HTML/CSS/JS file. No framework, no build step, no `npm install`. Open it in a browser and it runs. This is a deliberate choice: it keeps the barrier to making a change as low as possible (see "Making changes" below).
- **Backend:** [Supabase](https://supabase.com) — hosted Postgres database, authentication, and an auto-generated REST API. There is no separate backend server to run or deploy; `app.html` talks to Supabase directly over HTTPS using the `supabase-js` library (loaded from a CDN, see the `<script src="...supabase-js...">` tag near the top of `app.html`).
- **Database schema + seed data:** `migrations/0001_init.sql` — run once against a fresh Supabase project (SQL Editor → paste → Run) to create every table, security policy, and the starting catalog/plans/CSM roster.

That's the whole stack. No servers to provision, no CI/CD pipeline required to ship a change (though one can be added — see Deploying below).

## Project structure

```
app.html                    ← the app. Edit this file to change anything.
migrations/0001_init.sql    ← original schema + seed data (already run once — don't re-run on a live project)
migrations/000N_*.sql       ← future schema changes go here, one file per change, in order (see below)
MIGRATION_PLAN.md           ← the build plan this was built from: what's wired to the database vs. still on demo
                               data, Supabase project setup steps, team onboarding steps
archive_prototype.html      ← the original design prototype (seeded/local-only, no database) — kept for
                               reference only, not the live app
```

## First-time setup (already done once, kept here for a new project / new teammate)

1. Create a Supabase project at supabase.com.
2. SQL Editor → paste `migrations/0001_init.sql` → Run.
3. Settings → API: copy the Project URL and `anon public` key.
4. Open `app.html`, find these two lines near the top of the `<script>` block, and fill them in:
   ```js
   const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE";
   const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";
   ```
   Until these are filled in, `app.html` runs in demo mode (seeded local data, nothing saved, no login) — safe to open anytime.
5. Authentication → Providers: enable Email.
6. Authentication → Users: invite each team member.
7. Once someone accepts their invite, link their login to their CSM roster row (SQL Editor):
   ```sql
   update profiles set auth_user_id = '<their-user-id-from-the-Users-tab>' where name = 'Their Name';
   ```

Full detail (including what's wired to the database today vs. still pending) is in `MIGRATION_PLAN.md`.

## Making changes

Because there's no build step, changing the app is just editing `app.html` directly — with a text editor, or by asking an AI coding tool (e.g. Claude Code) to make the change for you and describing what you want. There's nothing to compile or bundle; you edit the file, save it, and reload the browser to see the change.

**Rule of thumb:** all the screen logic and rendering (Labs, Plans, Adoption Template, CSM Setup, and the rest) lives in one `<script>` block in `app.html`. The functions that read/write Supabase are grouped together and named with a `db` prefix (`dbFetchLabs`, `dbInsertLab`, `dbUpdateLabCsm`, etc.) — if you're adding a new screen that needs to save data, follow that same pattern: add a table to a new migration file, add a `db*` function to read/write it, and wire it into the relevant render function.

**Changing the database schema:** don't edit `migrations/0001_init.sql` after it's been run once — instead add a new file `migrations/0002_your_change.sql` with just the new SQL (e.g. `alter table labs add column ...`), run that new file's contents in the Supabase SQL Editor, and commit it here so there's a record of every schema change over time, in order.

## Deploying (getting `app.html` in front of the team)

`app.html` is a static file — any static hosting works:

- **Simplest for now:** send the file directly (email, Slack, shared drive) and people open it locally in a browser. Works, but everyone needs the latest copy each time it changes.
- **Recommended:** connect this repo to a free static host like [Vercel](https://vercel.com) or [Netlify](https://netlify.com) — every push to this repo's main branch redeploys automatically, and the team always has the latest version at one URL. No configuration needed beyond pointing the host at this repo (there's no build command — it's just static files).

## Ownership note (why this is in a repo at all)

This repo and the Supabase project behind it should live under CrelioHealth-owned accounts (a company GitHub org, a company Supabase org), not a single person's personal account — so the CSM tool keeps working and stays maintainable regardless of who's actively working on it. If either currently lives under a personal account, moving it to a company one is worth doing early.
