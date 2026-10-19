-- Brings the Adoption Template back inside the 100% rule (all module weights together <= 100, and each
-- module's parameter weights together <= 100) by scaling every weight in an over-limit group by the same
-- factor, so the RATIOS between weights stay exactly as they were.
--
-- Why this doesn't change any lab's adoption score: a module's score is (weighted progress / total weight)
-- over its parameters, and a lab's score is the same calculation across modules, so multiplying every weight
-- in a group by one constant cancels out. The only difference is rounding to 2 decimals (at most +/-0.005
-- per weight), which moves a score by far less than 0.01 of a percentage point.
--
-- At the time of writing this fixes:
--   * modules .............. total 118  -> 100
--   * registration ......... 200 -> 100      * inventory ... 200 -> 100
--   * operations ........... 212 -> 100      * branding .... 200 -> 100
--   * masterconfig ......... 126 -> 100
-- Groups already at or under 100 are not touched (e.g. brandingsolutions, which totals 55).
--
-- Each group is rounded to hundredths and the leftover hundredths go to the largest remainders, so the
-- result sums to exactly 100.00. Two modules that were equal can therefore differ by 0.01 (e.g. 8.48 vs 8.47).
--
-- Safe to re-run: once a group totals 100 it no longer matches "total > 100", so a second run changes nothing.
-- Run once, in the Supabase SQL Editor.

begin;

-- 1. Module weights (only if the modules together exceed 100)
with t as (select sum(weight) tot from public.modules having sum(weight) > 100),
r as (
  select m.key, floor(m.weight * 100 / t.tot * 100) base_c,
         (m.weight * 100 / t.tot * 100) - floor(m.weight * 100 / t.tot * 100) frac
  from public.modules m, t
),
s as (
  select r.*, 10000 - sum(base_c) over () leftover,
         row_number() over (order by frac desc, key) rn
  from r
)
update public.modules m
set weight = (s.base_c + case when s.rn <= s.leftover then 1 else 0 end) / 100.0
from s
where s.key = m.key;

-- 2. Parameter weights, per module (only modules whose parameters exceed 100)
with tot as (
  select module_key, sum(weight) t from public.module_params group by module_key having sum(weight) > 100
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
from s
where p.module_key = s.module_key and p.name = s.name;

commit;
