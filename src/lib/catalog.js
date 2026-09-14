import { supabase } from "../supabaseClient";

// The Adoption Template catalog — every module and parameter that exists in the product.
// Read-only in this app (matches app.html — editing the catalog isn't wired yet).
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
