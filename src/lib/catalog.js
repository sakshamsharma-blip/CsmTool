import { supabase } from "../supabaseClient";

// The Adoption Template catalog — every module and parameter that exists in the product,
// the shared master every Plan draws its default scope from. Authored on the Adoption
// Template screen (Module Builder); which of these a Plan gets by default is set right
// there too (Apply Rules) — there's no separate Plans management screen — and a lab's
// actual adoption can still be further customized per-lab on top of that via
// scope_overrides / param_scope_overrides, independent of this catalog.
export async function fetchCatalog() {
  const [{ data: mods, error: e1 }, { data: params, error: e2 }] = await Promise.all([
    supabase.from("modules").select("key,name,icon,weight,description").order("weight", { ascending: false }),
    // description is a newer column (migration 0016) holding the Adoption Template's per-item
    // validation notes — not yet surfaced in the Module Builder UI, but round-tripped here so a
    // save through that screen doesn't silently drop it.
    supabase.from("module_params").select("module_key,name,type,weight,category,description"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return mods.map((m) => ({
    ...m,
    params: params
      .filter((p) => p.module_key === m.key)
      .map((p) => ({ name: p.name, type: p.type, weight: p.weight, category: p.category, description: p.description })),
  }));
}

export function slugifyModuleKey(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

export async function addModule({ key, name, icon, weight, description }) {
  const { error } = await supabase.from("modules").insert({ key, name, icon, weight, description: description || null });
  if (error) throw error;
}

export async function updateModule(key, { name, icon, weight, description }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (icon !== undefined) patch.icon = icon;
  if (weight !== undefined) patch.weight = weight;
  if (description !== undefined) patch.description = description || null;
  const { error } = await supabase.from("modules").update(patch).eq("key", key);
  if (error) throw error;
}

export async function deleteModule(key) {
  const { error } = await supabase.from("modules").delete().eq("key", key);
  if (error) throw error;
}

export async function addModuleParam({ moduleKey, name, type, weight, category, description }) {
  const { error } = await supabase
    .from("module_params")
    .insert({ module_key: moduleKey, name, type, weight, category, description: description || null });
  if (error) throw error;
}

// module_params has no surrogate id in this app's data model (demo + live) — (module_key, name)
// is the natural, unique key (enforced by a DB constraint), so updates/deletes address rows by it.
export async function updateModuleParam(moduleKey, name, { newName, type, weight, category, description }) {
  const patch = { type, weight, category };
  if (newName && newName !== name) patch.name = newName;
  if (description !== undefined) patch.description = description || null;
  const { error } = await supabase.from("module_params").update(patch).eq("module_key", moduleKey).eq("name", name);
  if (error) throw error;
}

export async function deleteModuleParam(moduleKey, name) {
  const { error } = await supabase.from("module_params").delete().eq("module_key", moduleKey).eq("name", name);
  if (error) throw error;
}

// ---- weights: every group (all modules, or one module's parameters) must total exactly 100 ----

// Sum rounded to 2 decimals, so 33.33 + 33.33 + 33.34 reads as exactly 100 (no floating-point dust).
export function weightTotal(items) {
  return Math.round(items.reduce((s, it) => s + (Number(it.weight) || 0), 0) * 100) / 100;
}

// Scales a list of weights by one factor so they total exactly 100.00, keeping every ratio. Rounds to
// hundredths and hands the leftover hundredths to the largest remainders (same method as migration 0019).
// Returns null when there's nothing to scale (empty list or all zero).
export function scaleWeightsTo100(weights) {
  const nums = weights.map((w) => Math.max(0, Number(w) || 0));
  const total = nums.reduce((s, w) => s + w, 0);
  if (!nums.length || total <= 0) return null;
  const raw = nums.map((w) => (w * 10000) / total); // in hundredths of a percent
  const base = raw.map(Math.floor);
  let leftover = 10000 - base.reduce((s, b) => s + b, 0);
  raw.map((r, i) => ({ i, frac: r - base[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach(({ i }) => { if (leftover > 0) { base[i] += 1; leftover -= 1; } });
  return base.map((b) => b / 100);
}
