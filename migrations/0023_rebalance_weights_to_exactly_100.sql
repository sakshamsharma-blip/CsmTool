-- Rule (Oct 2026): every weight group — all modules together, and each module's parameters — totals EXACTLY
-- 100%. Migration 0019 fixed the groups that were OVER 100; this fixes any group that is UNDER 100 too (at the
-- time of writing only Branding Solutions, whose 6 parameters totalled 55%), using the same method: every
-- weight in the group is multiplied by one factor (ratios kept, so adoption scores don't change), rounded to
-- hundredths, with leftover hundredths going to the largest remainders so the group sums to exactly 100.00.
-- Groups already at 100, and empty/all-zero groups, are untouched. Safe to re-run.
-- Run once, in the Supabase SQL Editor.

begin;

with t as (select sum(weight) tot from public.modules having sum(weight) > 0 and sum(weight) <> 100),
r as (
  select m.key, floor(m.weight * 100 / t.tot * 100) base_c,
         (m.weight * 100 / t.tot * 100) - floor(m.weight * 100 / t.tot * 100) frac
  from public.modules m, t
),
s as (select r.*, 10000 - sum(base_c) over () leftover, row_number() over (order by frac desc, key) rn from r)
update public.modules m
set weight = (s.base_c + case when s.rn <= s.leftover then 1 else 0 end) / 100.0
from s where s.key = m.key;

with tot as (
  select module_key, sum(weight) t from public.module_params group by module_key
  having sum(weight) > 0 and sum(weight) <> 100
),
r as (
  select p.module_key, p.name, floor(p.weight * 100 / tot.t * 100) base_c,
         (p.weight * 100 / tot.t * 100) - floor(p.weight * 100 / tot.t * 100) frac
  from public.module_params p join tot using (module_key)
),
s as (
  select r.*, 10000 - sum(base_c) over (partition by module_key) leftover,
         row_number() over (partition by module_key order by frac desc, name) rn
  from r
)
update public.module_params p
set weight = (s.base_c + case when s.rn <= s.leftover then 1 else 0 end) / 100.0
from s where p.module_key = s.module_key and p.name = s.name;

commit;
