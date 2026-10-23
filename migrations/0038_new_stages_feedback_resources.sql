-- Oct 2026 batch 5. Run once, in the Supabase SQL Editor. Safe to re-run.
--
-- 1. New status lists (decision, Oct 23 2026).
--    In plan  (param_states.status): To-Do · In Discussion / Demo · Trial · Onboarding / Setup · Adopted ·
--             Not Required · Not Applicable · Did Not Meet Requirements
--    Not in plan (pitch_status.status): To-Do · Pitching · Trial · Onboarding / Setup · Purchased · Not Required ·
--             Not Applicable · Lost in Expansion · Lost after Purchase
--    Existing rows are renamed, nothing is deleted:
--      Not Started → To-Do, In Progress → Onboarding / Setup (both lists), To Do → To-Do, Added → Purchased.
--
-- 2. Deleting a module from the Adoption Template failed when a Collections entry pointed at it. The Collections
--    entry is a money record and is KEPT (it has its own label); only its link to the deleted module is cleared.
--
-- 2b. module_params.sort_order — parameters can be dragged into order in the Module Builder; labs follow it.
--
-- 3. Feedback & NPS: lab_feedback (CSM-entered 1–5 ratings) and lab_testimonials (video links per lab, by
--    designation). Same RLS shape as other lab-owned tables: a CSM sees/edits their own labs, Lead/Admin all.
--
-- 4. resources: common documents / training material for the whole team (sidebar → Resources). Anyone signed in
--    can read and add; the adder or a Lead/Admin can edit/remove (same rules as module_resources).

-- ---- 1. statuses ----
alter table public.param_states drop constraint if exists param_states_status_check;
update public.param_states set status = 'To-Do' where status = 'Not Started';
update public.param_states set status = 'Onboarding / Setup' where status in ('In Progress', 'Partially Adopted');
alter table public.param_states alter column status set default 'To-Do';
alter table public.param_states add constraint param_states_status_check check (status in (
  'To-Do', 'In Discussion / Demo', 'Trial', 'Onboarding / Setup', 'Adopted',
  'Not Required', 'Not Applicable', 'Did Not Meet Requirements',
  -- legacy names, still accepted so a browser tab opened before the update can't fail a save; the app reads
  -- them as To-Do / Onboarding / Setup.
  'Not Started', 'In Progress'));

alter table public.pitch_status drop constraint if exists pitch_status_status_check;
update public.pitch_status set status = 'To-Do' where status = 'To Do';
update public.pitch_status set status = 'Onboarding / Setup' where status = 'In Progress';
update public.pitch_status set status = 'Purchased' where status = 'Added';
alter table public.pitch_status add constraint pitch_status_status_check check (status in (
  'To-Do', 'Pitching', 'Trial', 'Onboarding / Setup', 'Purchased', 'Not Required', 'Not Applicable',
  'Lost in Expansion', 'Lost after Purchase',
  'To Do', 'In Progress', 'Added'));  -- legacy names (see above); read as To-Do / Onboarding / Setup / Purchased

-- ---- 2. module delete keeps Collections entries ----
alter table public.collections_items drop constraint if exists collections_items_module_key_fkey;
alter table public.collections_items add constraint collections_items_module_key_fkey
  foreign key (module_key) references public.modules(key) on delete set null on update cascade;

-- ---- 2b. parameter order inside a module (drag ⠿ in the Module Builder). Existing order kept (by id). ----
alter table public.module_params add column if not exists sort_order integer;
update public.module_params mp set sort_order = x.rn
from (select id, row_number() over (partition by module_key order by id) as rn from public.module_params) x
where mp.id = x.id and mp.sort_order is null;

-- ---- 3. feedback & testimonials ----
create table if not exists public.lab_feedback (
  id            uuid primary key default gen_random_uuid(),
  lab_id        text not null references public.labs(id) on delete cascade,
  rating        int  not null check (rating between 1 and 5),
  comment       text,
  feedback_date date not null default current_date,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists lab_feedback_lab_id_idx on public.lab_feedback (lab_id);
create index if not exists lab_feedback_created_by_idx on public.lab_feedback (created_by);

create table if not exists public.lab_testimonials (
  id          uuid primary key default gen_random_uuid(),
  lab_id      text not null references public.labs(id) on delete cascade,
  person_name text,
  designation text not null,
  video_url   text not null,
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists lab_testimonials_lab_id_idx on public.lab_testimonials (lab_id);
create index if not exists lab_testimonials_created_by_idx on public.lab_testimonials (created_by);

alter table public.lab_feedback enable row level security;
alter table public.lab_testimonials enable row level security;
drop policy if exists "lab_feedback_scoped" on public.lab_feedback;
create policy "lab_feedback_scoped" on public.lab_feedback
  for all to authenticated
  using ((select private.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_feedback.lab_id and l.csm_id = (select private.current_profile_id())
  ))
  with check ((select private.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_feedback.lab_id and l.csm_id = (select private.current_profile_id())
  ));
drop policy if exists "lab_testimonials_scoped" on public.lab_testimonials;
create policy "lab_testimonials_scoped" on public.lab_testimonials
  for all to authenticated
  using ((select private.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_testimonials.lab_id and l.csm_id = (select private.current_profile_id())
  ))
  with check ((select private.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_testimonials.lab_id and l.csm_id = (select private.current_profile_id())
  ));

-- ---- 4. team resources ----
create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  url         text not null,
  kind        text not null default 'Document' check (kind in ('Document', 'Training', 'Other')),
  description text,
  added_by    uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists resources_added_by_idx on public.resources (added_by);
alter table public.resources enable row level security;
drop policy if exists "resources_read" on public.resources;
drop policy if exists "resources_insert" on public.resources;
drop policy if exists "resources_update" on public.resources;
drop policy if exists "resources_delete" on public.resources;
create policy "resources_read" on public.resources for select to authenticated using (true);
create policy "resources_insert" on public.resources
  for insert to authenticated with check (added_by = (select private.current_profile_id()));
create policy "resources_update" on public.resources
  for update to authenticated
  using ((select private.is_lead_or_admin()) or added_by = (select private.current_profile_id()))
  with check ((select private.is_lead_or_admin()) or added_by = (select private.current_profile_id()));
create policy "resources_delete" on public.resources
  for delete to authenticated
  using ((select private.is_lead_or_admin()) or added_by = (select private.current_profile_id()));

insert into supabase_migrations.schema_migrations (version, name)
values ('0038', 'new_stages_feedback_resources') on conflict (version) do nothing;
