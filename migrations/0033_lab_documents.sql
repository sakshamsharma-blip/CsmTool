-- Lab → Documents tab: a list of LINKS to a lab's documents (agreement, proposal, PO, …) stored elsewhere
-- (Google Drive, etc.) — type, name and URL. No files are uploaded or stored here. Same RLS shape as every
-- lab-owned table. Run once, in the Supabase SQL Editor. Safe to re-run.

create table if not exists public.lab_documents (
  id         uuid primary key default gen_random_uuid(),
  lab_id     text not null references public.labs(id) on delete cascade,
  doc_type   text not null,
  name       text not null,
  url        text not null,
  added_by   uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists lab_documents_lab_id_idx on public.lab_documents (lab_id);
create index if not exists lab_documents_added_by_idx on public.lab_documents (added_by);

alter table public.lab_documents enable row level security;
drop policy if exists "lab_documents_scoped" on public.lab_documents;
create policy "lab_documents_scoped" on public.lab_documents
  for all to authenticated
  using ((select public.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_documents.lab_id and l.csm_id = (select public.current_profile_id())
  ))
  with check ((select public.is_lead_or_admin()) or exists (
    select 1 from public.labs l where l.id = lab_documents.lab_id and l.csm_id = (select public.current_profile_id())
  ));

insert into supabase_migrations.schema_migrations (version, name)
values ('0033', 'lab_documents') on conflict (version) do nothing;
