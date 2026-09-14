# Go live — Supabase setup, verification, and deployment

> Written September 2026, once the app had grown past `MIGRATION_PLAN.md`'s original "Monday scope" (that
> doc is now historical — kept for the original rollout story, not as the current checklist). This is the
> current, accurate guide for turning the app from demo mode into the real tool the team uses.

## 0. Where things stand today

Every screen in the app is already wired to read/write real Supabase data the moment a database is
connected — Labs (Customer Master), Plans, Adoption Template, CSM Setup, Dashboard, My Portfolio,
Collections, Visits & Meetings, and Log Check-in. None of that is "coming later" — it all runs on
`src/lib/*.js` data-access functions that call Supabase directly. **The only thing missing is a real
Supabase project to point it at.** Right now, with no `.env.local`, the app runs in demo mode: seeded
local data, no login, nothing saved — safe to click around, but not real.

Two things are worth knowing before you flip the switch:

- The **"DEMO MODE" banner** and the various **"Demo mode — X needs a database connected"** placeholders
  are conditional on whether Supabase env vars are set (`SUPABASE_CONFIGURED` in `src/supabaseClient.js`).
  You don't need to remove them by hand — the moment real credentials are in place, they stop rendering
  on their own.
- The **"ZOHO BOOKS SYNC — CONCEPT" badge** on the Collections screens is *not* conditional — it's there
  because Collections currently *simulates* a Zoho Books reconciliation (marks items Matched/Conflict
  against the lab's owed amount) rather than calling the real Zoho API. That's a deliberate, separate
  decision: either leave the badge up front so nobody mistakes it for a live integration, or treat wiring
  the real Zoho Books API as its own follow-on project and revisit the label then. Tell me which and I'll
  make the change — I'd rather you make that call than have me quietly relabel a feature that isn't real yet.

## 1. Create the Supabase project and run the schema

1. Create a project at [supabase.com](https://supabase.com) (pick a region close to your team — likely
   Mumbai/Singapore for a Pune/India-based team).
2. **SQL Editor → New query**, then paste and run each migration file **in this exact order** — each one
   depends on the tables the previous one created:
   1. `migrations/0001_init.sql` — base schema: `modules`, `module_params`, `plans`, `plan_modules`,
      `plan_excluded_params`, `profiles`, `labs`, `scope_overrides`, `param_scope_overrides`,
      `param_states`, `pitch_status`, `collections_items`, `tasks`, `activity_log` — plus seed data (13
      modules/49 params, 5 Plans, 7 CSM directory entries).
   2. `migrations/0002_visits.sql` — adds the `visits` table (Visits & Meetings).
   3. `migrations/0003_catalog_description.sql` — adds `modules.description` (Adoption Template's Module
      Builder).
   4. `migrations/0004_collections_zoho.sql` — adds `collections_items.collected_at` (Collections' "Last
      Payment" column).
   5. `migrations/0005_checkins.sql` — adds the meeting-detail columns Log Check-in needs (duration,
      location, person contacted, discussion topics, sentiment, flagged modules, action items).
3. **Settings → API**: copy the **Project URL** and the **`anon` public** key — you'll need both in step 3.
4. **Authentication → Providers**: enable **Email**. Password is the right choice here (not magic link) —
   the login page now has a working "Forgot your password?" link that needs password auth to make sense.
5. **Authentication → Users → Invite user**: invite each CSM/CS Lead by their real email.
6. **Link each invite to their `profiles` row** — the schema seeds `profiles` (the CSM roster) without
   `auth_user_id`, so the roster can exist before anyone's signed up. Once someone accepts their invite,
   in the SQL Editor:
   ```sql
   update profiles set auth_user_id = '<their-user-id-from-the-Users-tab>' where name = 'Rahul Barge';
   ```
   Repeat per person. Until this is set for someone, they can sign in but the app won't be able to match
   their login to a CSM roster row.

## 2. Point the app at it and do a real working check

1. In the project (locally, or wherever you're running it from): `cp .env.example .env.local`, then fill
   in the two values from step 1.3:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
2. `npm run dev` and open it. You should land on the new sign-in page (not the demo-mode UI) — if you
   still see demo mode, double check `.env.local` is in the project root and you restarted `npm run dev`
   after creating it (Vite only reads env files at startup).
3. Sign in as one of the people you invited and linked in step 1.6.
4. Do the real working check before trusting it with the team:
   - [ ] The "DEMO MODE" banner and every "Demo mode — X" placeholder are gone.
   - [ ] Add a lab (or edit one), reload the page — it's still there.
   - [ ] Change a lab's Plan or reassign its CSM, reload — it's still there.
   - [ ] Log a check-in on a lab, confirm it shows up in that lab's Lab History and that a flagged
     module created a follow-up task on the Portfolio/Dashboard.
   - [ ] Sign in as the same person from a second browser (or an incognito window) — both sessions see
     the same data, and an edit in one shows up in the other after a refresh (confirms you're really
     hitting Supabase, not something cached locally).
   - [ ] Browser console is clean — no red errors — on load and on each screen.
   - [ ] "Forgot your password?" on the login page actually sends a reset email (Supabase's default
     reset-email template works out of the box; customize it under Authentication → Email Templates if
     you want CrelioHealth branding on it).

If all of that holds, the backend is real and live for that one signed-in person — repeat the invite +
link step for the rest of the team when you're ready to bring them on.

## 3. Deploy it

`npm run build` produces a static `dist/` folder. Easiest path: connect this repo to
[Vercel](https://vercel.com) or [Netlify](https://netlify.com) — both auto-detect Vite, auto-build on
every push to `main`, and auto-deploy. In the host's project settings, set the same two env vars as
`.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — never commit `.env.local` itself.

Before sharing the deployed URL with the team, repeat the step 2.4 checklist once against the deployed
site (not just `localhost`) — a misconfigured env var on the host is the most common way a deploy quietly
falls back to demo mode.

## 4. After go-live

- Tighten Row-Level Security once this is more than an internal trial — right now every signed-in user
  can read/write every table (matches how the team already works day to day, but worth revisiting once
  there's a real Lead-vs-CSM permission distinction to enforce, e.g. only a Lead can reassign a lab's CSM
  or edit CSM Setup).
- Decide the Zoho badge question from section 0 whenever real Zoho Books API access is in scope.
- This repo and the Supabase project behind it should live under CrelioHealth-owned accounts, not a
  personal one — see the "Ownership note" at the bottom of `README.md`.
