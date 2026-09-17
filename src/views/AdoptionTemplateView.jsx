import { useEffect, useState } from "react";
import { slugifyModuleKey } from "../lib/catalog";
import { planIncludesModule, planIncludesParam } from "../lib/plans";

const TYPE_OPTIONS = [
  { value: "M", label: "Mandatory" },
  { value: "O", label: "Optional" },
];
const CATEGORY_OPTIONS = ["Adoption", "Expansion"];

export default function AdoptionTemplateView({
  modules, plans,
  onAddModule, onUpdateModule, onDeleteModule,
  onAddModuleParam, onUpdateModuleParam, onDeleteModuleParam,
  onToggleModule, onToggleParam,
}) {
  const [selectedKey, setSelectedKey] = useState(modules[0]?.key || null);
  const selectedModule = modules.find((m) => m.key === selectedKey) || null;

  // draft = a locally-editable copy of the selected module (name/weight/description/params),
  // re-synced only when the selection changes — so our own optimistic saves (which update
  // the `modules` prop) don't fight with whatever the user is mid-typing.
  const [draft, setDraft] = useState(null);
  const [paramError, setParamError] = useState("");
  const [expandedParam, setExpandedParam] = useState(null); // param name whose per-Plan chips are open

  useEffect(() => {
    setParamError("");
    setExpandedParam(null);
    if (!selectedModule) { setDraft(null); return; }
    setDraft({
      key: selectedModule.key,
      name: selectedModule.name,
      icon: selectedModule.icon,
      weight: selectedModule.weight,
      description: selectedModule.description || "",
      params: selectedModule.params.map((p) => ({ ...p, _origName: p.name })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const [addingModule, setAddingModule] = useState(false);
  const [newModName, setNewModName] = useState("");
  const [newModKey, setNewModKey] = useState("");
  const [newModKeyTouched, setNewModKeyTouched] = useState(false);
  const [newModIcon, setNewModIcon] = useState("🧩");
  const [newModWeight, setNewModWeight] = useState("10");
  const [newModError, setNewModError] = useState("");

  const totalModuleWeight = modules.reduce((sum, m) => sum + (Number(m.weight) || 0), 0);

  function openAddModule() {
    setAddingModule(true);
    setNewModName(""); setNewModKey(""); setNewModKeyTouched(false); setNewModIcon("🧩"); setNewModWeight("10"); setNewModError("");
  }

  function submitAddModule() {
    const name = newModName.trim();
    const key = newModKey.trim();
    const weight = Number(newModWeight);
    if (!name) return setNewModError("Name is required.");
    if (!key) return setNewModError("Key is required.");
    if (modules.some((m) => m.key === key)) return setNewModError(`A module with key "${key}" already exists.`);
    if (!Number.isFinite(weight) || weight <= 0) return setNewModError("Weight must be a positive number.");
    onAddModule({ key, name, icon: newModIcon.trim() || "🧩", weight, description: "" });
    setAddingModule(false);
    setSelectedKey(key);
  }

  async function handleDeleteModuleClick() {
    if (!draft) return;
    if (!window.confirm(`Delete the "${draft.name}" module? This fails safely if labs already have Collections recorded against it.`)) return;
    const ok = await onDeleteModule(draft.key, draft.name);
    if (ok) {
      const remaining = modules.filter((m) => m.key !== draft.key);
      setSelectedKey(remaining[0]?.key || null);
    }
  }

  function handleModuleFieldChange(field, value) {
    setDraft((d) => ({ ...d, [field]: value }));
  }
  function handleModuleFieldBlur(field) {
    if (!draft) return;
    const value = field === "weight" ? (Number(draft.weight) || 1) : draft[field];
    if (field === "weight" && value !== draft.weight) setDraft((d) => ({ ...d, weight: value }));
    onUpdateModule(draft.key, { [field]: value });
  }

  function updateDraftParam(idx, patch) {
    setDraft((d) => ({ ...d, params: d.params.map((p, i) => (i === idx ? { ...p, ...patch } : p)) }));
  }

  function persistParamRow(idx, overridePatch = {}) {
    const row = { ...draft.params[idx], ...overridePatch };
    const name = (row.name || "").trim();
    if (!name) return;
    const dupe = draft.params.some((p, i) => i !== idx && p.name.trim().toLowerCase() === name.toLowerCase());
    if (dupe) { setParamError(`"${name}" already exists on ${draft.name}.`); return; }
    setParamError("");
    const weight = Number(row.weight) || 1;
    if (row._isNew) {
      onAddModuleParam({ moduleKey: draft.key, name, type: row.type, weight, category: row.category });
      updateDraftParam(idx, { name, weight, _isNew: false, _origName: name });
    } else {
      onUpdateModuleParam(draft.key, row._origName, { newName: name !== row._origName ? name : undefined, type: row.type, weight, category: row.category });
      updateDraftParam(idx, { name, weight, _origName: name });
    }
  }

  function addParamRow() {
    setDraft((d) => ({ ...d, params: [...d.params, { name: "", type: "O", weight: 10, category: "Expansion", _isNew: true }] }));
  }

  function deleteParamRow(idx) {
    const row = draft.params[idx];
    if (row._isNew) { setDraft((d) => ({ ...d, params: d.params.filter((_, i) => i !== idx) })); return; }
    if (!window.confirm(`Delete parameter "${row.name}"? This won't affect adoption already recorded for labs.`)) return;
    onDeleteModuleParam(draft.key, row.name);
    setDraft((d) => ({ ...d, params: d.params.filter((_, i) => i !== idx) }));
  }

  const paramWeightTotal = draft ? draft.params.reduce((s, p) => s + (Number(p.weight) || 0), 0) : 0;
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
            <button className="icon-btn" title="Add module" onClick={openAddModule}>+</button>
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
                <input className="tw-input" type="number" min="1" value={newModWeight} onChange={(e) => setNewModWeight(e.target.value)} title="Weight" />
              </div>
              {newModError && <div style={{ color: "var(--bad)", fontSize: 11.5, marginBottom: 6 }}>{newModError}</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary" style={{ flex: 1, padding: "6px 0", fontSize: 12 }} onClick={submitAddModule}>Save</button>
                <button className="btn btn-ghost" style={{ flex: 1, padding: "6px 0", fontSize: 12 }} onClick={() => setAddingModule(false)}>Cancel</button>
              </div>
            </div>
          )}
          <div className="tmpl-list">
            {modules.map((m) => (
              <div
                key={m.key}
                className={`tmpl-list-row${m.key === selectedKey ? " selected" : ""}`}
                onClick={() => setSelectedKey(m.key)}
              >
                <span>{m.icon}</span>
                <span className="tlname">{m.name}</span>
                <span className="tlweight">{m.weight}%</span>
              </div>
            ))}
          </div>
          <div className="tmpl-list-foot">
            <span>Total weightage</span>
            <span><b>{totalModuleWeight}%</b></span>
          </div>
        </div>

        <div className="tmpl-config-card">
          {!draft ? (
            <div className="empty-params">No modules yet — add one on the left to get started.</div>
          ) : (
            <>
              <div className="tmpl-config-head">
                <div>
                  <h3>Module Configuration — {draft.name}</h3>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {draft.params.length} parameter{draft.params.length === 1 ? "" : "s"} · {paramWeightTotal}% allocated within this module
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ color: "var(--bad)", borderColor: "var(--bad-border)" }} onClick={handleDeleteModuleClick}>
                  Delete Module
                </button>
              </div>

              <div className="tmpl-field-row">
                <div className="tmpl-field">
                  <label>Module Name</label>
                  <input value={draft.name} onChange={(e) => handleModuleFieldChange("name", e.target.value)} onBlur={() => handleModuleFieldBlur("name")} />
                </div>
                <div className="tmpl-field">
                  <label>Weightage (% of overall score)</label>
                  <input type="number" min="1" value={draft.weight} onChange={(e) => handleModuleFieldChange("weight", e.target.value)} onBlur={() => handleModuleFieldBlur("weight")} />
                </div>
              </div>
              <div className="tmpl-field" style={{ marginBottom: 16 }}>
                <label>Description (optional)</label>
                <textarea
                  placeholder="What this module covers, for other CSMs reading the template…"
                  value={draft.description}
                  onChange={(e) => handleModuleFieldChange("description", e.target.value)}
                  onBlur={() => handleModuleFieldBlur("description")}
                />
              </div>

              <h4 style={{ margin: "0 0 4px", fontSize: 12.5 }}>Adoption Parameters</h4>
              <p style={{ fontSize: 11.5, color: "var(--text-faint)", margin: "0 0 10px", lineHeight: 1.5 }}>
                Mandatory parameters drive the Mandatory Completion score; Optional ones only count toward Overall
                Adoption. Category decides how a lab experiences the feature: Adoption is base-plan, tracked purely
                on rollout status; Expansion is an add-on, pitched in My Portfolio until bought. Click "Plans" on a
                row to include/exclude it for specific Plans that already have this module.
              </p>

              <div className="tparam-table-head">
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
                  <div key={p._isNew ? `new-${idx}` : p._origName}>
                    <div className="tparam-row">
                      <select style={{ width: 98 }} className="tw-input" value={p.type} onChange={(e) => { updateDraftParam(idx, { type: e.target.value }); persistParamRow(idx, { type: e.target.value }); }}>
                        {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input
                        className="tname-input pname"
                        placeholder="Parameter name"
                        value={p.name}
                        autoFocus={p._isNew}
                        onChange={(e) => updateDraftParam(idx, { name: e.target.value })}
                        onBlur={() => persistParamRow(idx)}
                      />
                      <select style={{ width: 104 }} className="tw-input" value={p.category} onChange={(e) => { updateDraftParam(idx, { category: e.target.value }); persistParamRow(idx, { category: e.target.value }); }}>
                        {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input
                        className="tw-input"
                        style={{ width: 50 }}
                        type="number"
                        min="1"
                        value={p.weight}
                        onChange={(e) => updateDraftParam(idx, { weight: e.target.value })}
                        onBlur={() => persistParamRow(idx)}
                      />
                      <button
                        className="mark-purchased"
                        style={{ width: 50, textAlign: "left", opacity: p._isNew ? 0.4 : 1, cursor: p._isNew ? "default" : "pointer" }}
                        disabled={p._isNew}
                        onClick={() => setExpandedParam((k) => (k === (p._origName || p.name) ? null : (p._origName || p.name)))}
                      >
                        {p._isNew ? "—" : `${includedCount}/${plansWithSelectedModule.length}`}
                      </button>
                      <button className="icon-btn" title="Delete parameter" onClick={() => deleteParamRow(idx)}>×</button>
                    </div>
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
              {paramError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{paramError}</div>}
              <div style={{ textAlign: "right", fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
                Parameters total: {paramWeightTotal}%
              </div>
            </>
          )}
        </div>

        <div>
          {draft && (
            <div className="rules-card">
              <h3>Apply Rules</h3>
              <div className="rules-sub">
                Choose which Plans include {draft.name} by default. It doesn't override a lab's own Adoption tab —
                labs still get exceptions from their own scope.
              </div>
              <div className="rules-section">
                <div className="rlabel">Plans</div>
                {plans.map((pl) => (
                  <label key={pl.id} className="rule-row">
                    <input type="checkbox" checked={planIncludesModule(pl, draft.key)} onChange={() => onToggleModule(pl.id, draft.key)} />
                    <span className="rmain">{pl.name}</span>
                  </label>
                ))}
              </div>
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
    </div>
  );
}
