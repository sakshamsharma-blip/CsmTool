import { useState } from "react";
import { slugifyModuleKey } from "../lib/catalog";
import { planIncludesModule } from "../lib/plans";
import Modal from "../components/Modal";

const CATEGORY_OPTIONS = ["Adoption", "Expansion"];
const TYPE_OPTIONS = [
  { value: "M", label: "Mandatory" },
  { value: "O", label: "Optional" },
];

export default function AdoptionTemplateView({ modules, plans, onAddModule, onAddModuleParam }) {
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [modName, setModName] = useState("");
  const [modKey, setModKey] = useState("");
  const [modKeyTouched, setModKeyTouched] = useState(false);
  const [modIcon, setModIcon] = useState("🧩");
  const [modWeight, setModWeight] = useState("10");
  const [modPlanIds, setModPlanIds] = useState([]);
  const [modError, setModError] = useState("");

  const [addParamForModule, setAddParamForModule] = useState(null); // module object or null
  const [paramName, setParamName] = useState("");
  const [paramType, setParamType] = useState("O");
  const [paramWeight, setParamWeight] = useState("10");
  const [paramCategory, setParamCategory] = useState("Expansion");
  const [paramExcludedPlanIds, setParamExcludedPlanIds] = useState([]); // plans (that have the module) unchecked = excluded
  const [paramError, setParamError] = useState("");

  function openAddModule() {
    setModName(""); setModKey(""); setModKeyTouched(false); setModIcon("🧩"); setModWeight("10");
    setModPlanIds([]); setModError("");
    setAddModuleOpen(true);
  }

  function handleModNameChange(v) {
    setModName(v);
    if (!modKeyTouched) setModKey(slugifyModuleKey(v));
  }

  function toggleModPlan(planId) {
    setModPlanIds((ids) => (ids.includes(planId) ? ids.filter((id) => id !== planId) : [...ids, planId]));
  }

  function submitAddModule() {
    const name = modName.trim();
    const key = modKey.trim();
    const weight = Number(modWeight);
    if (!name) return setModError("Module name is required.");
    if (!key) return setModError("Module key is required.");
    if (modules.some((m) => m.key === key)) return setModError(`A module with key "${key}" already exists.`);
    if (!Number.isFinite(weight) || weight <= 0) return setModError("Weight must be a positive number.");
    onAddModule({ key, name, icon: modIcon.trim() || "🧩", weight, planIds: modPlanIds });
    setAddModuleOpen(false);
  }

  function openAddParam(mod) {
    setParamName(""); setParamType("O"); setParamWeight("10"); setParamCategory("Expansion");
    setParamExcludedPlanIds([]); setParamError("");
    setAddParamForModule(mod);
  }

  function toggleParamPlan(planId) {
    setParamExcludedPlanIds((ids) => (ids.includes(planId) ? ids.filter((id) => id !== planId) : [...ids, planId]));
  }

  function submitAddParam() {
    const name = paramName.trim();
    const weight = Number(paramWeight);
    if (!name) return setParamError("Parameter name is required.");
    if (addParamForModule.params.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return setParamError(`"${name}" already exists on ${addParamForModule.name}.`);
    }
    if (!Number.isFinite(weight) || weight <= 0) return setParamError("Weight must be a positive number.");
    onAddModuleParam({
      moduleKey: addParamForModule.key,
      name,
      type: paramType,
      weight,
      category: paramCategory,
      excludePlanIds: paramExcludedPlanIds,
    });
    setAddParamForModule(null);
  }

  const plansWithModule = addParamForModule ? plans.filter((p) => planIncludesModule(p, addParamForModule.key)) : [];
  const plansWithoutModule = addParamForModule ? plans.filter((p) => !planIncludesModule(p, addParamForModule.key)) : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h1 className="page-title">Adoption Template</h1>
          <p className="page-sub">
            The shared catalog every Plan draws from — every module and parameter that exists in the product, its
            weighting, and its Adoption/Expansion category. Which of these a lab actually gets by default is decided
            per-Plan (here, at creation, or later on the Plans screen) — and a lab's real, day-to-day adoption can
            still differ from its Plan on top of that, since every lab has its own custom scope on the Adoption tab.
          </p>
        </div>
        <button className="btn btn-primary" style={{ flex: "none" }} onClick={openAddModule}>+ Add Module</button>
      </div>

      {modules.map((mod) => (
        <div key={mod.key} className="side-card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{mod.icon} {mod.name}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Weight {mod.weight}</span>
              <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => openAddParam(mod)}>
                + Add Parameter
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {mod.params.map((p) => (
              <span key={p.name} className={`cat-tag cat-${p.category}`} title={`${p.type === "M" ? "Mandatory" : "Optional"} · weight ${p.weight}`}>
                {p.name}
              </span>
            ))}
            {mod.params.length === 0 && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>No parameters yet.</span>}
          </div>
        </div>
      ))}

      <Modal
        open={addModuleOpen}
        title="Add Module"
        onClose={() => setAddModuleOpen(false)}
        actions={[
          { label: "Cancel", onClick: () => setAddModuleOpen(false) },
          { label: "Add Module", className: "btn-primary", onClick: submitAddModule },
        ]}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Name <span className="req">*</span></label>
            <input value={modName} onChange={(e) => handleModNameChange(e.target.value)} placeholder="e.g. Referral Portal" autoFocus />
          </div>
          <div className="field">
            <label>Key (unique, internal) <span className="req">*</span></label>
            <input value={modKey} onChange={(e) => { setModKey(slugifyModuleKey(e.target.value)); setModKeyTouched(true); }} placeholder="e.g. referralportal" />
          </div>
          <div className="field">
            <label>Icon (emoji)</label>
            <input value={modIcon} onChange={(e) => setModIcon(e.target.value)} />
          </div>
          <div className="field">
            <label>Weight <span className="req">*</span></label>
            <input type="number" value={modWeight} onChange={(e) => setModWeight(e.target.value)} min="1" />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Include in these Plans (optional)</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 8 }}>
            You can skip this and add it to Plans later — a lab's actual adoption can still differ from its Plan regardless.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {plans.map((p) => (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 400 }}>
                <input type="checkbox" checked={modPlanIds.includes(p.id)} onChange={() => toggleModPlan(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
        </div>
        {modError && <div style={{ color: "var(--danger, #d92d20)", fontSize: 12.5, marginTop: 10 }}>{modError}</div>}
      </Modal>

      <Modal
        open={!!addParamForModule}
        title={addParamForModule ? `Add Parameter — ${addParamForModule.name}` : ""}
        onClose={() => setAddParamForModule(null)}
        actions={[
          { label: "Cancel", onClick: () => setAddParamForModule(null) },
          { label: "Add Parameter", className: "btn-primary", onClick: submitAddParam },
        ]}
      >
        {addParamForModule && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Name <span className="req">*</span></label>
                <input value={paramName} onChange={(e) => setParamName(e.target.value)} placeholder="e.g. Referral Tracking" autoFocus />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={paramType} onChange={(e) => setParamType(e.target.value)}>
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Weight <span className="req">*</span></label>
                <input type="number" value={paramWeight} onChange={(e) => setParamWeight(e.target.value)} min="1" />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={paramCategory} onChange={(e) => setParamCategory(e.target.value)}>
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Plans</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 8 }}>
                By default this parameter is included in every Plan that already has {addParamForModule.name}. Uncheck
                a plan to exclude it there. (A lab's actual adoption can still be customized further on its own Adoption tab.)
              </div>
              {plansWithModule.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No Plan currently includes {addParamForModule.name}.</div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {plansWithModule.map((p) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 400 }}>
                    <input type="checkbox" checked={!paramExcludedPlanIds.includes(p.id)} onChange={() => toggleParamPlan(p.id)} />
                    {p.name}
                  </label>
                ))}
              </div>
              {plansWithoutModule.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>
                  Doesn't apply to: {plansWithoutModule.map((p) => p.name).join(", ")} (module not in these Plans)
                </div>
              )}
            </div>
            {paramError && <div style={{ color: "var(--danger, #d92d20)", fontSize: 12.5, marginTop: 10 }}>{paramError}</div>}
          </>
        )}
      </Modal>
    </div>
  );
}
