import { supabase } from "../supabaseClient";

// The Adoption Template catalog — every module and parameter that exists in the product,
// the shared master every Plan draws its default scope from. Modules and parameters are
// created here (Adoption Template screen); which of them a Plan gets by default is then
// set on the Plans screen (or at creation time, see addModule/addModuleParam below) —
// and a lab's actual adoption can still be further customized per-lab on top of that via
// scope_overrides / param_scope_overrides, independent of this catalog.
export async function fetchCatalog() {
  const [{ data: mods, error: e1 }, { data: params, error: e2 }] = await Promise.all([
    supabase.from("modules").select("key,name,icon,weight").order("weight", { ascending: false }),
    supabase.from("module_params").select("module_key,name,type,weight,category"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return mods.map((m) => ({
    ...m,
    params: params
      .filter((p) => p.module_key === m.key)
      .map((p) => ({ name: p.name, type: p.type, weight: p.weight, category: p.category })),
  }));
}

export function slugifyModuleKey(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

export async function addModule({ key, name, icon, weight }) {
  const { error } = await supabase.from("modules").insert({ key, name, icon, weight });
  if (error) throw error;
}

export async function addModuleParam({ moduleKey, name, type, weight, category }) {
  const { error } = await supabase
    .from("module_params")
    .insert({ module_key: moduleKey, name, type, weight, category });
  if (error) throw error;
}
