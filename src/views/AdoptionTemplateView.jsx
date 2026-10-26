import { useEffect, useState } from "react";
import { slugifyModuleKey, rescaleKeeping, weightTotal, weightValue } from "../lib/catalog";
import Modal from "../components/Modal";
import { planIncludesModule, planIncludesParam } from "../lib/plans";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fetchModuleResources } from "../lib/moduleResources";
import ModuleResources from "../components/ModuleResources";

const TYPE_OPTIONS = [
  { value: "M", label: "Mandatory" },
  { value: "O", label: "Optional" },
];
const CATEGORY_OPTIONS = ["Adoption", "Expansion"];
// Weights are percentages of a whole: all modules together, and all parameters inside one module, must
// each total exactly 100%. Edits are allowed while someone is working (e.g. adding a new parameter), but any
// total that isn't 100 is flagged in red with "Rescale to 100%". Rescale KEEPS the weights you just added or
// changed and scales the untouched ones in their current ratio to fill the rest (rescaleKeeping in lib/catalog.js),
// shown first as an editable preview. Nothing is rescaled without that click.
const TARGET_TOTAL = 100;

export default function AdoptionTemplateView({
  modules, plans,
  onAddModule, onUpdateModule, onDeleteModule,
  onAddModuleParam, onUpdateModuleParam, onDeleteModuleParam,
  onToggleModule, onToggleParam, onReorderModules, onReorderModuleParams,
  canEdit = true,
  myProfileId, isHead, showToast,
}) {
  // Shared docs / training links per module — anyone can add one here (even in view-only mode), see ModuleResources.
  const [resources, setResources] = useState([]);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return undefined;
    let cancelled = false;
    fetchModuleResources().then((r) => { if (!cancelled) setResources(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [selectedKey, setSelectedKey] = useState(modules[0]?.key || null);
  const selectedModule = modules.find((m) => m.key === selectedKey) || null;

  // draft = a locally-editable copy of the selected module (name/weight/description/params). NOTHING in it is
  // saved until "Save Changes" (decision, Oct 2026) — type, category, weight, name, description, added and
  // removed parameters all wait for that click, and "Discard" throws them away. Each param keeps `_orig` (its
  // saved values) so the save only sends what actually changed.
  const [draft, setDraft] = useState(null);
  const [paramError, setParamError] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedParam, setExpandedParam] = useState(null); // param name whose per-Plan chips are open
  const [descOpen, setDescOpen] = useState({}); // row index -> description box open
  const [paramDrag, setParamDrag] = useState(null);     // index of the parameter row being dragged
  const [paramDragOver, setParamDragOver] = useState(null);
  // Rescale preview: { kind: "params" | "modules", title, intro, rows: [{ key, label, old, value, fixed }],
  // newModule? (being added, fixed, not editable), error? }
  const [rescale, setRescale] = useState(null);
  // Modules whose weight was added or changed in this visit — Rescale keeps those as they are.
  const [touchedModules, setTouchedModules] = useState([]);

  function draftFrom(mod) {
    if (!mod) return null;
    return {
      key: mod.key,
      name: mod.name,
      icon: mod.icon,
      weight: mod.weight,
      description: mod.description || "",
      params: mod.params.map((p) => ({ ...p, description: p.description || "", _origName: p.name, _orig: { ...p, description: p.description || "" } })),
    };
  }

  useEffect(() => {
    setParamError("");
    setExpandedParam(null);
    setDescOpen({});
    setDraft(draftFrom(selectedModule));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const [addingModule, setAddingModule] = useState(false);
  const [newModName, setNewModName] = useState("");
  const [newModKey, setNewModKey] = useState("");
  const [newModKeyTouched, setNewModKeyTouched] = useState(false);
  const [newModIcon, setNewModIcon] = useState("🧩");
  const [newModWeight, setNewModWeight] = useState("10");
  const [newModError, setNewModError] = useState("");

  const totalModuleWeight = weightTotal(modules);
  const modulesOff = totalModuleWeight !== TARGET_TOTAL;

  // ---- unsaved-changes tracking ----
  const paramChanged = (p) => !p._isNew && !p._deleted && (
    p.name.trim() !== p._orig.name || p.type !== p._orig.type || p.category !== p._orig.category
    || weightValue(p.weight) !== weightValue(p._orig.weight) || (p.description || "").trim() !== (p._orig.description || "").trim()
  );
  // Parameter order changed by dragging (compares the saved parameters' order only).
  const orderChanged = !!draft && !!selectedModule && (() => {
    const now = draft.params.filter((p) => !p._isNew && !p._deleted).map((p) => p._origName);
    const was = selectedModule.params.map((p) => p.name).filter((n) => now.includes(n));
    return now.some((n, i) => n !== was[i]);
  })();
  const isDirty = !!draft && !!selectedModule && (
    draft.name.trim() !== selectedModule.name
    || weightValue(draft.weight) !== weightValue(selectedModule.weight)
    || (draft.description || "").trim() !== (selectedModule.description || "").trim()
    || draft.params.some((p) => (p._isNew && p.name.trim()) || p._deleted || paramChanged(p))
    || orderChanged
  );
  function confirmLeave() {
    return !isDirty || window.confirm(`You have unsaved changes to ${draft.name}. Discard them?`);
  }
  function selectModule(key) {
    if (key === selectedKey || !confirmLeave()) return;
    setSelectedKey(key);
  }

  function openAddModule() {
    if (!confirmLeave()) return;
    setAddingModule(true);
    setNewModName(""); setNewModKey(""); setNewModKeyTouched(false); setNewModIcon("🧩"); setNewModWeight("10"); setNewModError("");
  }

  function submitAddModule() {
    const name = newModName.trim();
    const key = newModKey.trim();
    const weight = Number(newModWeight || 0);
    if (!name) return setNewModError("Name is required.");
    if (!key) return setNewModError("Key is required.");
    if (modules.some((m) => m.key === key)) return setNewModError(`A module with key "${key}" already exists.`);
    if (!Number.isFinite(weight) || weight < 0 || weight > TARGET_TOTAL) return setNewModError(`Weight must be between 0 and ${TARGET_TOTAL}.`);
    const mod = { key, name, icon: newModIcon.trim() || "🧩", weight, description: "" };
    // No room left? Ask how much to take off the other modules (pre-filled proportionally) instead of
    // leaving the total over 100.
    if (weight > 0 && totalModuleWeight + weight > TARGET_TOTAL + 0.001 && modules.length) {
      openModuleRescale(mod);
      return;
    }
    finishAddModule(mod);
  }
  function finishAddModule(mod) {
    onAddModule(mod);
    setTouchedModules((t) => [...t, mod.key]);
    setAddingModule(false);
    setSelectedKey(mod.key);
  }

  // ---- Rescale to 100%: keep what was just added / changed, scale the rest in ratio, preview first ----
  function buildRows(items, fixedFlags, extraFixed = 0) {
    const { next, error } = rescaleKeeping([...items.map((x) => x.weight), extraFixed], [...fixedFlags, extraFixed > 0]);
    return { rows: items.map((x, i) => ({ ...x, value: String(next ? next[i] : x.weight), fixed: fixedFlags[i] })), error };
  }
  function openParamRescale() {
    const live = draft.params.map((p, i) => ({ p, i })).filter(({ p }) => !p._deleted);
    const items = live.map(({ p, i }) => ({ key: String(i), label: p.name || "(new parameter)", old: p._isNew ? null : weightValue(p._orig.weight), weight: weightValue(p.weight) }));
    const fixed = live.map(({ p }) => !!p._isNew || weightValue(p.weight) !== weightValue(p._orig.weight));
    const { rows, error } = buildRows(items, fixed);
    setRescale({ kind: "params", title: `Rescale ${draft.name}'s parameters to ${TARGET_TOTAL}%`, rows, error });
  }
  // Module weights: the ones added / changed this visit (and the open module's unsaved weight) stay; the rest scale.
  function openModuleRescale(newModule) {
    const draftChanged = draft && !newModule && weightValue(draft.weight) !== weightValue(selectedModule?.weight);
    const items = modules.map((m) => ({
      key: m.key, label: `${m.icon || ""} ${m.name}`.trim(), old: weightValue(m.weight),
      weight: draftChanged && m.key === draft.key ? weightValue(draft.weight) : weightValue(m.weight),
    }));
    const fixed = modules.map((m) => touchedModules.includes(m.key) || (draftChanged && m.key === draft.key));
    const { rows, error } = buildRows(items, fixed, newModule ? newModule.weight : 0);
    setRescale({
      kind: "modules", newModule, rows, error,
      title: newModule ? `Make room for ${newModule.name} (${newModule.weight}%)` : `Rescale module weights to ${TARGET_TOTAL}%`,
    });
  }
  function applyRescale() {
    const { kind, rows, newModule } = rescale;
    if (kind === "params") {
      setDraft((d) => {
        const params = d.params.slice();
        rows.forEach((r) => { params[Number(r.key)] = { ...params[Number(r.key)], weight: weightValue(r.value) }; });
        return { ...d, params };
      });
    } else {
      rows.forEach((r) => {
        const m = modules.find((x) => x.key === r.key);
        const w = weightValue(r.value);
        if (m && w !== weightValue(m.weight)) onUpdateModule(m.key, { weight: w });
      });
      if (draft) {
        const own = rows.find((r) => r.key === draft.key);
        if (own) setDraft((d) => ({ ...d, weight: weightValue(own.value) }));
      }
      if (newModule) finishAddModule(newModule);
    }
    setRescale(null);
  }

  async function handleDeleteModuleClick() {
    if (!draft) return;
    if (!window.confirm(`Delete the "${draft.name}" module and its parameters for every lab? Collections entries recorded against it are kept (they just lose the link to the module). This can't be undone.`)) return;
    const ok = await onDeleteModule(draft.key, draft.name);
    if (ok) {
      const remaining = modules.filter((m) => m.key !== draft.key);
      setSelectedKey(remaining[0]?.key || null);
    }
  }

  // ---- module order: drag a row (or use ▲ ▼); the order is saved and every lab's Adoption tab follows it ----
  const [dragKey, setDragKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  function moveModule(fromKey, toIndex) {
    const keys = modules.map((m) => m.key);
    const from = keys.indexOf(fromKey);
    if (from < 0 || toIndex < 0 || toIndex >= keys.length || from === toIndex) return;
    keys.splice(from, 1);
    keys.splice(toIndex, 0, fromKey);
    onReorderModules?.(keys);
  }

  function updateDraft(patch) {
    setDraft((d) => ({ ...d, ...patch }));
  }
  function updateDraftParam(idx, patch) {
    setDraft((d) => ({ ...d, params: d.params.map((p, i) => (i === idx ? { ...p, ...patch } : p)) }));
  }

  // Drag a parameter row (or ▲▼) to reorder it — saved with Save Changes like every other draft edit.
  function moveParam(from, to) {
    if (from == null || to < 0 || to >= draft.params.length || from === to) return;
    setDraft((d) => { const params = [...d.params]; const [row] = params.splice(from, 1); params.splice(to, 0, row); return { ...d, params }; });
    setDescOpen({});
  }

  function addParamRow() {
    // New parameters default to Adoption — a lab's CSM decides per lab whether it's in their plan.
    setDraft((d) => ({ ...d, params: [...d.params, { name: "", type: "O", weight: 10, category: "Adoption", description: "", _isNew: true }] }));
  }

  function deleteParamRow(idx) {
    const row = draft.params[idx];
    if (row._isNew) { setDraft((d) => ({ ...d, params: d.params.filter((_, i) => i !== idx) })); return; }
    updateDraftParam(idx, { _deleted: !row._deleted }); // toggled; removed for real on Save Changes
  }

  function discardChanges() {
    setParamError("");
    setDescOpen({});
    setDraft(draftFrom(selectedModule));
  }

  async function saveChanges() {
    if (!draft || !selectedModule) return;
    const live = draft.params.filter((p) => !p._deleted && !(p._isNew && !p.name.trim()));
    const names = live.map((p) => p.name.trim().toLowerCase());
    if (live.some((p) => !p.name.trim())) { setParamError("Every parameter needs a name."); return; }
    const dupe = names.find((n, i) => names.indexOf(n) !== i);
    if (dupe) { setParamError(`Two parameters are named "${dupe}" — names must be unique within a module.`); return; }
    if (!draft.name.trim()) { setParamError("The module needs a name."); return; }
    setParamError("");
    setSaving(true);
    try {
      const modPatch = {};
      if (draft.name.trim() !== selectedModule.name) modPatch.name = draft.name.trim();
      if (weightValue(draft.weight) !== weightValue(selectedModule.weight)) modPatch.weight = weightValue(draft.weight);
      if ((draft.description || "").trim() !== (selectedModule.description || "").trim()) modPatch.description = draft.description.trim();
      if (Object.keys(modPatch).length) await onUpdateModule(draft.key, modPatch);
      if (modPatch.weight !== undefined) setTouchedModules((t) => (t.includes(draft.key) ? t : [...t, draft.key]));

      for (const p of draft.params) {
        if (p._deleted && !p._isNew) await onDeleteModuleParam(draft.key, p._origName);
      }
      for (const p of draft.params) {
        if (paramChanged(p)) {
          const name = p.name.trim();
          await onUpdateModuleParam(draft.key, p._origName, {
            newName: name !== p._origName ? name : undefined,
            type: p.type, weight: weightValue(p.weight), category: p.category, description: (p.description || "").trim(),
          });
        }
      }
      for (const p of draft.params) {
        if (p._isNew && p.name.trim()) {
          await onAddModuleParam({ moduleKey: draft.key, name: p.name.trim(), type: p.type, weight: weightValue(p.weight), category: p.category, description: (p.description || "").trim() });
        }
      }
      // Save the parameter order whenever it was dragged or a parameter was added (new ones go where they sit).
      const finalNames = live.map((p) => p.name.trim());
      if (orderChanged || draft.params.some((p) => p._isNew && p.name.trim())) await onReorderModuleParams?.(draft.key, finalNames);
      // Everything now matches what was saved.
      setDraft((d) => ({
        ...d,
        name: d.name.trim(),
        weight: weightValue(d.weight),
        params: d.params
          .filter((p) => !p._deleted && !(p._isNew && !p.name.trim()))
          .map((p) => {
            const clean = { name: p.name.trim(), type: p.type, weight: weightValue(p.weight), category: p.category, description: (p.description || "").trim() };
            return { ...clean, _origName: clean.name, _orig: clean };
          }),
      }));
    } finally {
      setSaving(false);
    }
  }

  const liveParams = draft ? draft.params.filter((p) => !p._deleted) : [];
  const paramWeightTotal = weightTotal(liveParams);
  const paramsOff = liveParams.length > 0 && paramWeightTotal !== TARGET_TOTAL;

  const plansWithSelectedModule = draft ? plans.filter((p) => planIncludesModule(p, draft.key)) : [];

  return (
    <div>
      <h1 className="page-title">Adoption Template</h1>
      <p className="page-sub">
        The shared catalog every Plan draws from — every module and parameter that exists in the product, its
        weighting, and its Adoption/Expansion category. Adding or removing a parameter here changes what exists for
        every Plan to include or exclude — it doesn't rewrite adoption statuses already recorded per lab. Which of
        these a lab actually gets by default is decided per-Plan (Apply Rules, right) — a lab's real day-to-day
        adoption can still differ from that on its own Adoption tab.
      </p>

      <div className="tmpl-layout">
        <div className="tmpl-list-card">
          <div className="tmpl-list-head">
            <h3>Module Builder</h3>
            {canEdit && <button className="icon-btn" title="Add module" onClick={openAddModule}>+</button>}
          </div>
          {addingModule && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <input
                className="tname-input"
                style={{ width: "100%", marginBottom: 6 }}
                placeholder="Module name"
                value={newModName}
                autoFocus
                onChange={(e) => { setNewModName(e.target.value); if (!newModKeyTouched) setNewModKey(slugifyModuleKey(e.target.value)); }}
              />
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <input className="tw-input" style={{ width: 44 }} value={newModIcon} onChange={(e) => setNewModIcon(e.target.value)} title="Icon" />
                <input
                  className="tname-input"
                  style={{ flex: 1, fontWeight: 400, fontSize: 12 }}
                  placeholder="key"
                  value={newModKey}
                  onChange={(e) => { setNewModKey(slugifyModuleKey(e.target.value)); setNewModKeyTouched(true); }}
                />
                <input className="tw-input" type="number" min="0" value={newModWeight} onChange={(e) => setNewModWeight(e.target.value)} title="Weight" />
              </div>
              {newModError && <div style={{ color: "var(--bad)", fontSize: 11.5, marginBottom: 6 }}>{newModError}</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary" style={{ flex: 1, padding: "6px 0", fontSize: 12 }} onClick={submitAddModule}>Save</button>
                <button className="btn btn-ghost" style={{ flex: 1, padding: "6px 0", fontSize: 12 }} onClick={() => setAddingModule(false)}>Cancel</button>
              </div>
            </div>
          )}
          {canEdit && modules.length > 1 && (
            <div style={{ padding: "6px 14px", fontSize: 11, color: "var(--text-faint)", borderBottom: "1px solid var(--border)" }}>
              Drag ⠿ (or use ▲ ▼) to reorder — labs show modules in this order.
            </div>
          )}
          <div className="tmpl-list">
            {modules.map((m, i) => (
              <div
                key={m.key}
                className={`tmpl-list-row${m.key === selectedKey ? " selected" : ""}${dragOverKey === m.key && dragKey !== m.key ? " drag-over" : ""}`}
                onClick={() => selectModule(m.key)}
                draggable={canEdit}
                onDragStart={(e) => { setDragKey(m.key); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (dragKey) { e.preventDefault(); setDragOverKey(m.key); } }}
                onDragLeave={() => setDragOverKey((k) => (k === m.key ? null : k))}
                onDrop={(e) => { e.preventDefault(); if (dragKey) moveModule(dragKey, i); setDragKey(null); setDragOverKey(null); }}
                onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
              >
                {canEdit && <span className="drag-handle" title="Drag to reorder">⠿</span>}
                <span>{m.icon}</span>
                <span className="tlname">{m.name}</span>
                <span className="tlweight">{m.weight}%</span>
                {canEdit && (
                  <span className="reorder-btns" onClick={(e) => e.stopPropagation()}>
                    <button type="button" title="Move up" disabled={i === 0} onClick={() => moveModule(m.key, i - 1)}>▲</button>
                    <button type="button" title="Move down" disabled={i === modules.length - 1} onClick={() => moveModule(m.key, i + 1)}>▼</button>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="tmpl-list-foot">
            <span>Total weightage</span>
            <span><b style={{ color: modulesOff ? "var(--bad)" : undefined }}>{totalModuleWeight}%</b> / {TARGET_TOTAL}%</span>
          </div>
          {modulesOff && (
            <div style={{ padding: "8px 14px 12px", fontSize: 11.5, color: "var(--bad)", lineHeight: 1.45 }}>
              Module weights total {totalModuleWeight}% — they must total exactly {TARGET_TOTAL}%.
              {canEdit && (
                <button className="btn btn-ghost" style={{ display: "block", marginTop: 6, fontSize: 11.5, padding: "5px 10px" }} onClick={() => openModuleRescale(null)}>
                  Rescale to {TARGET_TOTAL}%
                </button>
              )}
            </div>
          )}
        </div>

        <div className="tmpl-config-card">
          {!canEdit && (
            <div className="info-banner" style={{ marginBottom: 12 }}>
              View only — only a CSM Lead or Admin can edit the Adoption Template.
            </div>
          )}
          {draft && SUPABASE_CONFIGURED && (
            <ModuleResources moduleKey={draft.key} moduleName={draft.name} resources={resources} myProfileId={myProfileId} isHead={isHead}
              showToast={showToast} onChanged={async () => setResources(await fetchModuleResources())} />
          )}
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {!draft ? (
            <div className="empty-params">No modules yet — add one on the left to get started.</div>
          ) : (
            <>
              <div className="tmpl-config-head">
                <div>
                  <h3>Module Configuration — {draft.name}</h3>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {liveParams.length} parameter{liveParams.length === 1 ? "" : "s"} · {paramWeightTotal}% of {TARGET_TOTAL}% allocated within this module
                  </div>
                </div>
                {canEdit && (
                  <button className="btn btn-ghost" style={{ color: "var(--bad)", borderColor: "var(--bad-border)" }} onClick={handleDeleteModuleClick}>
                    Delete Module
                  </button>
                )}
              </div>

              <div className="tmpl-field-row">
                <div className="tmpl-field">
                  <label>Module Name</label>
                  <input value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} />
                </div>
                <div className="tmpl-field">
                  <label>Weightage (% of overall score — all modules = {TARGET_TOTAL}%)</label>
                  <input type="number" min="0" step="any" max={TARGET_TOTAL} value={draft.weight} onChange={(e) => updateDraft({ weight: e.target.value })} />
                </div>
              </div>
              <div className="tmpl-field" style={{ marginBottom: 16 }}>
                <label>Description (optional)</label>
                <textarea
                  placeholder="What this module covers — shown as an ⓘ next to the module on every lab's Adoption tab"
                  value={draft.description}
                  onChange={(e) => updateDraft({ description: e.target.value })}
                />
              </div>

              <h4 style={{ margin: "0 0 4px", fontSize: 12.5 }}>Adoption Parameters</h4>
              <p style={{ fontSize: 11.5, color: "var(--text-faint)", margin: "0 0 10px", lineHeight: 1.5 }}>
                Mandatory parameters drive the Mandatory Completion score; Optional ones only count toward Overall
                Adoption. Category is the default — Adoption (base plan) or Expansion (add-on). Click "Plans" on a row
                to include/exclude it for specific Plans; ⓘ adds a description shown on labs. Drag ⠿ to reorder
                (labs follow this order). A weight can be 0. Edits here are saved only when you click Save Changes.
              </p>

              <div className="tparam-table-head">
                {canEdit && <span style={{ width: 16 }}></span>}
                <span style={{ width: 98 }}>Type</span>
                <span className="pname">Parameter Name</span>
                <span style={{ width: 104 }}>Category</span>
                <span style={{ width: 50 }}>Wt.</span>
                <span style={{ width: 50 }}>Plans</span>
                <span style={{ width: 22 }}></span>
              </div>
              {draft.params.length === 0 && <div className="empty-params">No parameters yet — add one below.</div>}
              {draft.params.map((p, idx) => {
                const includedCount = plansWithSelectedModule.filter((pl) => planIncludesParam(pl, draft.key, p._origName || p.name)).length;
                return (
                  <div key={p._isNew ? `new-${idx}` : p._origName} style={p._deleted ? { opacity: 0.45 } : undefined}
                    className={paramDragOver === idx && paramDrag !== idx ? "drag-over" : undefined}
                    onDragOver={(e) => { if (paramDrag != null) { e.preventDefault(); setParamDragOver(idx); } }}
                    onDrop={(e) => { e.preventDefault(); moveParam(paramDrag, idx); setParamDrag(null); setParamDragOver(null); }}>
                    <div className="tparam-row" style={p._isNew || paramChanged(p) ? { background: "var(--accent-dim)" } : undefined}>
                      {canEdit && (
                        <span className="drag-handle" title="Drag to reorder (or Alt+↑/↓ on this handle)" draggable tabIndex={0}
                          onDragStart={(e) => { setParamDrag(idx); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => { setParamDrag(null); setParamDragOver(null); }}
                          onKeyDown={(e) => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); moveParam(idx, idx - 1); } if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); moveParam(idx, idx + 1); } }}
                          style={{ width: 16, cursor: "grab" }}>⠿</span>
                      )}
                      <select style={{ width: 98 }} className="tw-input" value={p.type} disabled={p._deleted} onChange={(e) => updateDraftParam(idx, { type: e.target.value })}>
                        {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input
                        className="tname-input pname"
                        placeholder="Parameter name"
                        value={p.name}
                        autoFocus={p._isNew}
                        disabled={p._deleted}
                        style={p._deleted ? { textDecoration: "line-through" } : undefined}
                        onChange={(e) => updateDraftParam(idx, { name: e.target.value })}
                      />
                      <button type="button" className="icon-btn" title={p.description ? "Edit description" : "Add a description (shown as ⓘ on labs)"} disabled={p._deleted}
                        style={{ color: p.description ? "var(--accent)" : "var(--text-faint)" }}
                        onClick={() => setDescOpen((o) => ({ ...o, [idx]: !o[idx] }))}>ⓘ</button>
                      <select style={{ width: 104 }} className="tw-input" value={p.category} disabled={p._deleted} onChange={(e) => updateDraftParam(idx, { category: e.target.value })}>
                        {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        className="tw-input"
                        style={{ width: 50 }}
                        type="number"
                        min="0"
                        step="any"
                        max={TARGET_TOTAL}
                        value={p.weight}
                        disabled={p._deleted}
                        onChange={(e) => updateDraftParam(idx, { weight: e.target.value })}
                      />
                      <button
                        className="mark-purchased"
                        style={{ width: 50, textAlign: "left", opacity: p._isNew ? 0.4 : 1, cursor: p._isNew ? "default" : "pointer" }}
                        disabled={p._isNew}
                        onClick={() => setExpandedParam((k) => (k === (p._origName || p.name) ? null : (p._origName || p.name)))}
                      >
                        {p._isNew ? "—" : `${includedCount}/${plansWithSelectedModule.length}`}
                      </button>
                      <button className="icon-btn" title={p._deleted ? "Undo remove" : "Remove parameter (on Save Changes)"} onClick={() => deleteParamRow(idx)}>{p._deleted ? "↺" : "×"}</button>
                    </div>
                    {descOpen[idx] && !p._deleted && (
                      <div style={{ padding: "2px 0 10px 108px" }}>
                        <textarea
                          rows="2"
                          className="tw-input"
                          style={{ width: "100%", textAlign: "left", resize: "vertical" }}
                          placeholder="What this parameter means — shown as ⓘ next to it on every lab's Adoption tab"
                          value={p.description || ""}
                          onChange={(e) => updateDraftParam(idx, { description: e.target.value })}
                        />
                      </div>
                    )}
                    {expandedParam === (p._origName || p.name) && !p._isNew && (
                      <div style={{ padding: "4px 0 10px 84px" }}>
                        {plansWithSelectedModule.length === 0 ? (
                          <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>No Plan currently includes {draft.name}.</div>
                        ) : (
                          <div className="rule-chip-row">
                            {plansWithSelectedModule.map((pl) => (
                              <label key={pl.id} className="rule-chip">
                                <input
                                  type="checkbox"
                                  checked={planIncludesParam(pl, draft.key, p._origName || p.name)}
                                  onChange={() => onToggleParam(pl.id, draft.key, p._origName || p.name)}
                                />
                                {pl.name}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12.5 }} onClick={addParamRow}>+ Add Parameter</button>
              {canEdit && (
                <div className={isDirty ? "info-banner" : undefined} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14, flexWrap: "wrap", ...(isDirty ? {} : { fontSize: 11.5, color: "var(--text-faint)" }) }}>
                  <span>{isDirty ? <><b>Unsaved changes</b> — nothing is saved until you click Save Changes.</> : "All changes saved."}</span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} disabled={!isDirty || saving} onClick={discardChanges}>Discard</button>
                    <button className="btn btn-primary" style={{ fontSize: 12, padding: "6px 12px" }} disabled={!isDirty || saving} onClick={saveChanges}>{saving ? "Saving…" : "Save Changes"}</button>
                  </span>
                </div>
              )}
              {paramError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{paramError}</div>}
              <div style={{ textAlign: "right", fontSize: 11.5, color: paramsOff ? "var(--bad)" : "var(--text-faint)", marginTop: 6 }}>
                Parameters total: {paramWeightTotal}% / {TARGET_TOTAL}%
              </div>
              {paramsOff && (
                <div style={{ color: "var(--bad)", fontSize: 11.5, marginTop: 4, textAlign: "right" }}>
                  {draft.name}'s parameters total {paramWeightTotal}% — they must total exactly {TARGET_TOTAL}%.
                  {canEdit && (
                    <button className="btn btn-ghost" style={{ marginLeft: 8, fontSize: 11.5, padding: "4px 10px" }} onClick={openParamRescale}>
                      Rescale to {TARGET_TOTAL}%
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          </fieldset>
        </div>

        <div>
          {draft && (
            <div className="rules-card">
              <h3>Apply Rules</h3>
              <div className="rules-sub">
                Choose which Plans include {draft.name} by default. It doesn't override a lab's own Adoption tab —
                labs still get exceptions from their own scope.
              </div>
              <fieldset disabled={!canEdit} className="rules-section" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <div className="rlabel">Plans</div>
                {plans.map((pl) => (
                  <label key={pl.id} className="rule-row">
                    <input type="checkbox" checked={planIncludesModule(pl, draft.key)} onChange={() => onToggleModule(pl.id, draft.key)} />
                    <span className="rmain">{pl.name}</span>
                  </label>
                ))}
              </fieldset>
              <div className="rules-match">
                <span>Plans including this module</span>
                <b>{plansWithSelectedModule.length} of {plans.length}</b>
              </div>
              <div className="rules-note">
                A new parameter added above is included by default in every Plan that already has this module — use
                the "Plans" count on its row to exclude it from specific Plans instead.
              </div>
            </div>
          )}
        </div>
      </div>

      {rescale && (() => {
        const total = weightTotal(rescale.rows.map((r) => ({ weight: r.value }))) + (rescale.newModule ? rescale.newModule.weight : 0);
        const ok = Math.abs(total - TARGET_TOTAL) < 0.005;
        const what = rescale.kind === "params" ? "parameters" : "modules";
        return (
          <Modal open title={rescale.title} onClose={() => setRescale(null)} actions={[
            { label: "Cancel", className: "btn-ghost", onClick: () => setRescale(null) },
            ...(rescale.newModule ? [{ label: "Add without adjusting", className: "btn-ghost", onClick: () => { finishAddModule(rescale.newModule); setRescale(null); } }] : []),
            { label: rescale.newModule ? "Apply & add module" : rescale.kind === "params" ? "Apply to draft" : "Apply", className: "btn-primary", onClick: applyRescale, disabled: !ok },
          ]}>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>
              🔒 = {rescale.newModule ? "the new module and " : ""}{what} you added or changed — kept as you set them. The others are
              scaled in their current ratio to fill the rest. Change any number before applying.
              {rescale.kind === "params" && " This updates the draft; click Save Changes to keep it."}
            </div>
            {rescale.error && <div className="warn-banner" style={{ marginBottom: 10 }}>{rescale.error}</div>}
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              <div className="rescale-row rescale-head"><span>{rescale.kind === "params" ? "Parameter" : "Module"}</span><span>Now</span><span>New</span></div>
              {rescale.newModule && (
                <div className="rescale-row"><span>🔒 {rescale.newModule.icon} {rescale.newModule.name} <i>(new)</i></span><span>—</span><b>{rescale.newModule.weight}%</b></div>
              )}
              {rescale.rows.map((r, idx) => (
                <div key={r.key} className="rescale-row">
                  <span>{r.fixed ? "🔒 " : ""}{r.label}{r.old == null ? <i> (new)</i> : null}</span>
                  <span>{r.old == null ? "—" : `${r.old}%`}</span>
                  <input className="tw-input" type="number" min="0" step="any" value={r.value}
                    onChange={(e) => setRescale((x) => ({ ...x, rows: x.rows.map((y, j) => (j === idx ? { ...y, value: e.target.value } : y)) }))} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: ok ? "var(--ok)" : "var(--bad)" }}>
              Total: {Math.round(total * 100) / 100}% / {TARGET_TOTAL}%
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
