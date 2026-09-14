# CSM Tool — from prototype to a real, deployed app

> ## ⚡ UPDATE — the app is now built. Read this box, then do 3 things.
>
> Everything below this box was written when only the database schema existed. Since then, **`app.html` has been built** — a real, Supabase-wired version of the tool (login, Labs, Plans, Adoption Template, and a new CSM Setup screen), verified end-to-end against a mocked backend with zero console errors. It is NOT yet connected to your actual Supabase project — that takes 3 steps, roughly 10 minutes:
>
> 1. **Create the Supabase project** (if you haven't) and run `supabase_schema.sql` in its SQL Editor — one paste, one click.
> 2. **Open `app.html`**, find the two lines near the top of its `<script>` block (`SUPABASE_URL` / `SUPABASE_ANON_KEY`), and paste in your project's values from Settings → API. Until you do this, `app.html` runs exactly like the old demo prototype — safe to open anytime, nothing breaks.
> 3. **Enable Email auth** in Supabase (Authentication → Providers) and invite your 7 teammates (Authentication → Users → Invite). Once each accepts, link their login to their roster row: `update profiles set auth_user_id = '<their-uid>' where name = 'Aditi';` (repeat per person — see Step 1.6 below).
>
> That's it — once those 3 things are done, share `app.html` with the team and it's real: logins, shared data, everything they add persists. The rest of this document is the original build plan/checklist, kept for reference (what's wired vs. not, verification steps, what to build next).
>
> **What's live in `app.html` today:** sign-in, Labs (add/list — Customer Master), Plans (view + toggle module/param membership), Adoption Template (view), and CSM Setup (new — add/edit team roster). Also fixed a small pre-existing bug along the way: the Add Lab form's City field was typed in but never actually saved — it now is.
> **What's still demo-data-only** (unchanged from the prototype, not required for Monday): Dashboard, My Portfolio, Collections, Tasks, Lab History, Visits & Meetings. These still render and are clickable, but nothing entered there is saved yet.

**Goal:** by Monday, the team can start using the real (not prototype) tool for: adding labs, working with Plans, working with the Adoption Template (modules/params), and setting up labs and CSMs — with everything actually saved, not just living in one browser tab.

**Stack:** Supabase (Postgres + Auth + auto-generated REST API + Realtime) as the backend, `prototype.html`'s existing UI as the frontend, wired together with the `supabase-js` client library. Built with Claude Code, by you.

This doc is the spec/checklist for that build. It assumes you'll drive Claude Code yourself, feeding it this plan plus `prototype.html` and `supabase_schema.sql` as context.

---

## Is Supabase + Claude Code realistic for Monday? Yes, with scope discipline

Supabase removes the two slowest parts of a normal backend build: you don't write auth endpoints (Supabase Auth handles signup/login/sessions), and you don't write CRUD API endpoints (every table you create is instantly a REST + Realtime endpoint via its auto-generated API, callable straight from `supabase-js`). What's left is: run the schema (already done — see below), and rewire `prototype.html`'s in-memory arrays to read/write through `supabase-js` instead. That's a realistic weekend build **if you keep Monday's scope to exactly the four things you named** and treat the rest of the app (Dashboard, Portfolio, Collections, Tasks, Check-ins, Visits) as "still works on demo data / lands next week." Trying to wire all ~10 views by Monday is the actual risk, not the stack choice.

---

## Step 0 — What's already done

`supabase_schema.sql` (in this folder) is a complete, **tested** Postgres schema:

- 14 tables covering the catalog (`modules`, `module_params`), plans (`plans`, `plan_modules`, `plan_excluded_params`), people (`profiles`), labs (`labs`, plus `scope_overrides` / `param_scope_overrides` for per-lab deviations from a Plan), adoption state (`param_states`, `pitch_status`), and the modules you'll add later (`collections_items`, `tasks`, `activity_log`).
- Row-Level Security enabled on every table with a permissive "any signed-in user can read/write everything" policy — matching how the team already works (fully shared visibility), flagged in the file as the one thing worth tightening once this is more than an internal trial.
- Seed data generated **directly from `prototype.html`'s live `MODULES`, `PLANS`, and `CSM_DIRECTORY` objects** (not hand-typed), so what loads on day one matches exactly what the team has been reviewing: 13 modules / 49 params, all 5 Plans with their per-plan excluded params, all 7 CSM directory entries.
- I ran this file against a throwaway Postgres instance end-to-end (schema + RLS policies + every seed insert) and confirmed it executes with zero errors before handing it to you — it's not just generated, it's verified to actually run.

**Your first move Monday-eve or now:** create a Supabase project, open the SQL Editor, paste in `supabase_schema.sql`, run it once. Done — your database exists.

---

## Step 1 — Supabase project setup

1. Create a project at supabase.com (pick a region close to your team).
2. SQL Editor → paste `supabase_schema.sql` → Run.
3. Settings → API: copy the Project URL and the `anon` public key — these go in the frontend.
4. Authentication → Providers: enable Email (magic link or password, your call — magic link is less setup since there's no "forgot password" flow to build).
5. Authentication → Users: invite your 7 team members by email (or let them self-register if you enable signups — for an internal tool of 7 people, manually inviting is simpler and safer).
6. **Link each invite to its `profiles` row.** The schema deliberately seeded `profiles` (the CSM roster) *without* `auth_user_id` set, so the roster could exist before anyone had signed up. Once each person accepts their invite, run:
   ```sql
   update profiles set auth_user_id = '<their-auth-uid-from-the-Users-tab>' where name = 'Aditi';
   ```
   for each of the 7. (A tiny admin screen to do this via a dropdown is a nice-to-have, not a Monday requirement — doing it by hand in the SQL editor once per person is fine.)

---

## Step 2 — Wire the frontend: the "thin adapter" strategy

The lowest-risk path is **don't rewrite the UI.** `prototype.html`'s rendering code (`renderPlansView`, `renderAdoptionTemplateView`, `renderTable`, `renderLabDetailsTab`, etc.) already works and has been reviewed by leadership — keep all of it. The only thing that changes is *where the data comes from*.

Concretely:

1. Add the `supabase-js` script tag and initialize a client with your Project URL + anon key.
2. Find every place `prototype.html` currently does `MODULES.push(...)`, `LABS.find(...)`, mutates an in-memory array, etc. — the data currently lives in a handful of top-level JS arrays/objects (`MODULES`, `PLANS`, `LABS`, `CSM_DIRECTORY`, and the various state maps like `paramStates`, `scopeOverrides`).
3. Replace direct array mutation with a small data-access layer: functions like `async function saveLab(lab)`, `async function loadLabs()`, `async function togglePlanParam(...)` that call `supabase.from('labs').upsert(...)` / `.select()` etc., then re-run the existing `render*()` functions with the fresh data. The render functions themselves don't need to know Supabase exists — they just need the same shaped JS objects they get today.
4. On page load: fetch `modules`, `module_params`, `plans`, `plan_modules`, `plan_excluded_params`, `profiles`, and `labs` from Supabase, reconstruct the same in-memory shapes the prototype already uses (a `PLANS` array with a nested `excludedParams` object, etc.), then call the existing `renderAll()`.
5. Auth gate: wrap the app in a simple check — if no active Supabase session, show a login form (email + magic link / password); once signed in, load data as above.

This is meaningfully less rewrite than it sounds, because the hard part (the actual screens, the scoring logic, the Plan-driven default-scope rules you had me fix earlier) is done and stays untouched. You're building a data layer underneath a UI that already exists, not rebuilding the UI.

---

## Step 3 — Monday-scope checklist

Ship exactly these four, fully wired to Supabase (read + write, multi-user, persisted):

- [ ] **Sign in** — Supabase Auth email login gating the app.
- [ ] **Labs (Customer Master)** — the existing lab list/table/filters (`renderTable`, `renderFilters`, `renderTiles`) reading from `labs`; the existing add/edit lab form writing to `labs` via `supabase.from('labs').upsert(...)`.
- [ ] **Plans screen** (`renderPlansView`) — reading `plans` / `plan_modules` / `plan_excluded_params`; your per-param toggle (`togglePlanParam`) writing back to `plan_excluded_params` (insert to exclude, delete to re-include).
- [ ] **Adoption Template / modules & params catalog** (`renderAdoptionTemplateView`) — reading `modules` / `module_params`. If this screen is view-only today, it can stay view-only Monday; only wire writes here if the team needs to add new modules/params before Monday (unlikely — that catalog rarely changes).
- [ ] **CSM setup — new, not in the prototype today.** `CSM_DIRECTORY` is currently a hardcoded array in `prototype.html`; there is no screen to add/edit a CSM. Since you explicitly want CSM setup live Monday, this needs a small new screen: a list of `profiles` with name + role (Lead/CSM), and an add/edit form writing to `profiles`. This is genuinely new UI (maybe 30–40 lines), not just a rewiring of something that exists — budget real time for it, it's the one item on this list that isn't "swap the data source."

Explicitly **not** required Monday (existing prototype UI, leave on demo/seed data or hide behind a "coming soon" for now): Dashboard, My Portfolio, Collections reconciliation, Tasks, Check-ins/Activity History, Visits & Meetings. Wire these one at a time in the following weeks — the schema already has tables ready for all of them (`collections_items`, `tasks`, `activity_log`), so it's the same thin-adapter pattern each time, not new schema design.

---

## Step 4 — Verify before onboarding

Before you put this in front of the team Monday:

- [ ] Two people signed in from two different browsers/sessions both see the same lab list, and an edit by one shows up for the other on refresh (confirms writes are actually hitting Supabase, not local state).
- [ ] Adding a lab, changing its Plan, and toggling a Plan param all survive a hard page reload.
- [ ] The CSM setup screen's `profiles` list matches the 7 people who received Auth invites, and each has `auth_user_id` linked (Step 1.6).
- [ ] Browser console is clean (no red errors) on load and on each of the four Monday screens.

---

## After Monday

Work through the remaining views (Dashboard → Portfolio → Collections → Tasks → Check-ins/History → Visits) one at a time using the same thin-adapter pattern: point each screen's existing render function at real Supabase data instead of the seeded arrays. `activity_log.details` (jsonb) is already shaped to hold the check-in form's structured fields, and `collections_items` / `tasks` already have the columns the existing Collections and Tasks panels expect — the schema was designed against the full prototype, not just the Monday slice, so nothing here needs to be redesigned later.

Also worth doing once things are live and stable: tighten RLS from "any authenticated user can do anything" to something role-aware (e.g. only a Lead can reassign a lab's CSM), now that real auth sessions exist to check roles against.
