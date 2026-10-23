import { supabase } from "../supabaseClient";

// The Adoption Template catalog — every module and parameter that exists in the product,
// the shared master every Plan draws its default scope from. Authored on the Adoption
// Template screen (Module Builder); which of these a Plan gets by default is set right
// there too (Apply Rules) — there's no separate Plans management screen — and a lab's
// actual adoption can still be further customized per-lab on top of that via
// scope_overrides / param_scope_overrides, independent of this catalog.
export async function fetchCatalog() {
  // Modules come back in the order set by dragging them in the Module Builder (sort_order, migration 0028).
  // If that column doesn't exist yet, fall back to the old heaviest-first order so the app still loads.
  let modsRes = await supabase.from("modules").select("key,name,icon,weight,description,sort_order")
    .order("sort_order", { ascending: true, nullsFirst: false }).order("weight", { ascending: false });
  if (modsRes.error && /sort_order/.test(modsRes.error.message || "")) {
    modsRes = await supabase.from("modules").select("key,name,icon,weight,description").order("weight", { ascending: false });
  }
  // description = the parameter's explanation, edited via ⓘ in the Module Builder and shown as ⓘ next to the
  // parameter on every lab's Adoption tab. Parameters come back in their dragged order (sort_order, migration
  // 0038); before that column exists, in creation order.
  let paramsRes = await supabase.from("module_params").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
  if (paramsRes.error && /sort_order/.test(paramsRes.error.message || "")) {
    paramsRes = await supabase.from("module_params").select("*").order("id", { ascending: true });
  }
  const { data: mods, error: e1 } = modsRes;
  const { data: params, error: e2 } = paramsRes;
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

export async function addModule({ key, name, icon, weight, description, sortOrder }) {
  const row = { key, name, icon, weight, description: description || null };
  if (sortOrder != null) row.sort_order = sortOrder; // new modules go to the bottom of the list
  const { error } = await supabase.from("modules").insert(row);
  if (error) throw error;
}

// Saves the Module Builder's order (array of module keys, top to bottom) as sort_order 1..n.
export async function reorderModules(keysInOrder) {
  const results = await Promise.all(keysInOrder.map((key, i) => supabase.from("modules").update({ sort_order: i + 1 }).eq("key", key)));
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
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

// Saves one module's parameter order (array of names, top to bottom) as sort_order 1..n (migration 0038).
export async function reorderModuleParams(moduleKey, namesInOrder) {
  const results = await Promise.all(namesInOrder.map((name, i) =>
    supabase.from("module_params").update({ sort_order: i + 1 }).eq("module_key", moduleKey).eq("name", name)));
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

// A weight as typed: blank/invalid → 0. Zero is allowed (a module or parameter can count for nothing).
export function weightValue(w) {
  const n = Number(w);
  return w === "" || w == null || !Number.isFinite(n) ? 0 : Math.max(0, n);
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
