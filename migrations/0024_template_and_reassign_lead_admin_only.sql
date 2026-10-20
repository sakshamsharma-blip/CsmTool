-- Decision (Oct 2026): editing the Adoption Template (modules, parameters, which Plans include them) and
-- reassigning a lab to another CSM are CSM Lead / Admin actions. The app already hides those controls from
-- plain CSMs; this makes the database enforce the same rule.
--
--  * modules, module_params, plans, plan_modules, plan_excluded_params: every signed-in user can still READ
--    (scoring, Plans and adoption need them everywhere); only Leads/Admins can insert/update/delete.
--  * labs.csm_id: only a Lead/Admin can CHANGE it (reassign). Creating a lab is unaffected. Changes made
--    without a signed-in app user (Supabase SQL Editor / service role) are not blocked.
-- The policies also wrap auth calls in (select …) so Postgres evaluates them once per query, not per row
-- (clears the advisor's "auth RLS initplan" warnings for these tables).
-- Run once, in the Supabase SQL Editor. Safe to re-run.

do $$
declare t text;
begin
  foreach t in array array['modules','module_params','plans','plan_modules','plan_excluded_params'] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write_lead_admin', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_lead_or_admin())) with check ((select public.is_lead_or_admin()))', t || '_write_lead_admin', t);
  end loop;
end $$;

create or replace function public.prevent_non_lead_reassign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.csm_id is distinct from old.csm_id and auth.uid() is not null and not public.is_lead_or_admin() then
    raise exception 'Only a CSM Lead or Admin can reassign a lab to another CSM.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists labs_reassign_lead_admin_only on public.labs;
create trigger labs_reassign_lead_admin_only
  before update of csm_id on public.labs
  for each row execute function public.prevent_non_lead_reassign();

revoke execute on function public.prevent_non_lead_reassign() from public, anon, authenticated;
