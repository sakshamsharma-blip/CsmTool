-- Manual expansion deals get a title and an optional module (decision Nov 5 2026), so they can sit beside purchased features
-- in one list on Expansion → Deals & Purchases. Feature purchases already have both (label, module_key).
-- Only adds two empty, optional columns: no existing row or policy changes. Deleting a module keeps its deals. Safe to re-run.
-- Run once, in the Supabase SQL Editor, BEFORE deploying the app and connector code that reads them.

alter table public.expansion_opportunities add column if not exists title text;
alter table public.expansion_opportunities add column if not exists module_key text references public.modules(key) on delete set null;

insert into supabase_migrations.schema_migrations (version, name)
values ('0046', 'expansion_deal_title_module') on conflict (version) do nothing;
