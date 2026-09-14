import { supabase } from "../supabaseClient";

export async function fetchPlans() {
  const [{ data: plans, error: e1 }, { data: pm, error: e2 }, { data: pep, error: e3 }] = await Promise.all([
    supabase.from("plans").select("id,name").order("name"),
    supabase.from("plan_modules").select("plan_id,module_key"),
    supabase.from("plan_excluded_params").select("plan_id,module_key,param_name"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  return plans.map((p) => {
    const modules = pm.filter((r) => r.plan_id === p.id).map((r) => r.module_key);
    const excludedParams = {};
    pep.filter((r) => r.plan_id === p.id).forEach((r) => {
      (excludedParams[r.module_key] = excludedParams[r.module_key] || []).push(r.param_name);
    });
    return { id: p.id, name: p.name, modules, excludedParams };
  });
}

export function planIncludesParam(plan, moduleKey, paramName) {
  if (!plan.modules.includes(moduleKey)) return false;
  const excluded = plan.excludedParams && plan.excludedParams[moduleKey];
  return !(excluded && excluded.includes(paramName));
}

export async function setPlanModule(planId, moduleKey, included) {
  const { error } = included
    ? await supabase.from("plan_modules").upsert({ plan_id: planId, module_key: moduleKey }, { onConflict: "plan_id,module_key" })
    : await supabase.from("plan_modules").delete().eq("plan_id", planId).eq("module_key", moduleKey);
  if (error) throw error;
}

export async function setPlanExcludedParam(planId, moduleKey, paramName, excluded) {
  const { error } = excluded
    ? await supabase.from("plan_excluded_params").upsert(
        { plan_id: planId, module_key: moduleKey, param_name: paramName },
        { onConflict: "plan_id,module_key,param_name" }
      )
    : await supabase.from("plan_excluded_params").delete().eq("plan_id", planId).eq("module_key", moduleKey).eq("param_name", paramName);
  if (error) throw error;
}
