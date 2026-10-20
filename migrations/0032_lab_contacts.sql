-- Points of contact (POCs) per lab: name + designation (+ optional phone/email). Managed from Lab Details and
-- offered as a dropdown under "Person Contacted" in Log Check-in (a new person can still be typed in, and saved
-- as a POC from there). Visible/editable by whoever can see the lab — same RLS shape as every lab-owned table.
-- Run once, in the Supabase SQL Editor. Safe to re-run.

create table if not exists public.lab_contacts (
  id          uuid primary key default gen_random_uuid(),
  lab_id      text not null references public.labs(id) on delete cascade,
  name        text not null,
  designation text,
  phone       text,
  email       text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists lab_contacts_lab_id_idx on public.lab_contacts (lab_id);
create index if not exists lab_contacts_created_by_idx on public.lab_contacts (created_by);

alter table public.lab_contacts enable row level security;
drop policy if exists "lab_contacts_scoped" on public.lab_contacts;
create policy "lab_contacts_scoped" on public.lab_contacts
  for all to authenticated
  using ((select public.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_contacts.lab_id and l.csm_id = (select public.current_profile_id())
  ))
  with check ((select public.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_contacts.lab_id and l.csm_id = (select public.current_profile_id())
  ));

insert into supabase_migrations.schema_migrations (version, name)
values ('0032', 'lab_contacts') on conflict (version) do nothing;
