-- Wipe test data before onboarding the real team — run this ONCE, right before go-live, not a
-- routine migration. Safe to re-run (truncating an already-empty table is a no-op), but there's
-- no undo: this permanently deletes every lab and everything hanging off a lab (visits/check-ins,
-- tasks, activity/Lab History, pitch status, collections items, invoices, adoption
-- scope/state overrides) that was added while testing.
--
-- Deliberately NOT touched — this is real configuration, not test data:
--   modules, module_params        (the Adoption Template catalog)
--   plans, plan_modules, plan_excluded_params   (the 5 real Plans)
--   profiles                      (the real CSM/CS Lead roster — names/roles stay)
--   profile_emails, profile_auth_links          (identity-linking config)
--
-- After this runs, every screen that lists labs will be empty (My Portfolio, Total Labs,
-- Collections, Tasks, Visits & Meetings, Dashboard) — exactly the state you want before the
-- team starts adding real labs.

truncate table
  invoices,
  collections_items,
  pitch_status,
  param_states,
  param_scope_overrides,
  scope_overrides,
  activity_log,
  tasks,
  labs
cascade;
