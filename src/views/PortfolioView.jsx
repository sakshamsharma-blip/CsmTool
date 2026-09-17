import { useEffect, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtMoney, toINR, segmentFor } from "../lib/format";
import { computeLabRollup } from "../lib/labRollup";
import { fetchAllLabsAdoption, computeSavedLabScores } from "../lib/adoption";
import {
  fetchAllPitchStatus, getModulePitchStatus, getParamPitchStatus, markFeatureAdded,
  setModulePitchStatus, setParamPitchStatus, PITCH_STATUSES, PITCH_ACTIVE_STATUSES,
} from "../lib/pitch";
import { markModuleInScope as apiMarkModuleInScope } from "../lib/adoption";
import { fetchAllTasks, toggleTaskDone as apiToggleTaskDone, addTask as apiAddTask } from "../lib/tasks";
import { hasLeadAccess } from "../lib/roles";
import ScopeToggle from "../components/ScopeToggle";
import BarChart from "../components/BarChart";
import TasksPanel from "../components/TasksPanel";
import Modal from "../components/Modal";
import InfoTip from "../components/InfoTip";

const SEG_LABELS = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };

export default function PortfolioView({ labs, modules, plans, csmDirectory, currentCSM, idByName, onOpenLab, showToast }) {
  const isHead = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  const [scope, setScope] = useState("mine");
  const [csmFilter, setCsmFilter] = useState("");
  const csmNames = csmDirectory.map((c) => c.name);

  const [adoptionByLab, setAdoptionByLab] = useState({});
  const [pitchByLab, setPitchByLab] = useState({});
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  const [expandedLab, setExpandedLab] = useState(null);
  const [expandedModule, setExpandedModule] = useState(null);
  const [addedTarget, setAddedTarget] = useState(null); // {labId, moduleKey, paramName, level, label, existingParamState}
  const [addedTrial, setAddedTrial] = useState(false);
  const [addedAmount, setAddedAmount] = useState("");
  const [addedError, setAddedError] = useState(false);

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [adoption, pitch, tk] = await Promise.all([
        fetchAllLabsAdoption(), fetchAllPitchStatus(), fetchAllTasks({ ...invert(idByName) }),
      ]);
      setAdoptionByLab(adoption);
      setPitchByLab(pitch);
      setTasks(tk);
    } catch (err) {
      setError(err.message || "Failed to load portfolio data.");
    } finally {
      setLoading(false);
    }
  }
  function invert(m) { const out = {}; Object.entries(m).forEach(([name, id]) => { out[id] = name; }); return out; }

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — My Portfolio needs a database connected.</div>;
  }
  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading portfolio…</div>;
  if (error) return <div className="error-banner">Couldn't load portfolio — {error}</div>;

  const teamAll = isHead && scope === "team" && !csmFilter;
  const scopeCsm = isHead && scope === "team" ? (csmFilter || null) : currentCSM;
  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  function planOf(lab) { return plans.find((p) => p.id === lab.plan) || plans[0]; }
  function isModuleInScope(lab, moduleKey) {
    const a = adoptionByLab[lab.id];
    if (a && Object.prototype.hasOwnProperty.call(a.scope, moduleKey)) return a.scope[moduleKey];
    return planOf(lab).modules.includes(moduleKey);
  }
  function isParamInScope(lab, moduleKey, paramName) {
    const a = adoptionByLab[lab.id];
    const key = `${moduleKey}|${paramName}`;
    if (a && Object.prototype.hasOwnProperty.call(a.paramScope, key)) return a.paramScope[key];
    const plan = planOf(lab);
    if (!plan.modules.includes(moduleKey)) return false;
    const excluded = plan.excludedParams && plan.excludedParams[moduleKey];
    return !(excluded && excluded.includes(paramName));
  }
  function paramState(lab, moduleKey, paramName) {
    const a = adoptionByLab[lab.id];
    const key = `${moduleKey}|${paramName}`;
    return (a && a.paramState[key]) || { included: false, status: "Not Started", expValue: null, expStage: null };
  }

  // Pitch Pipeline — every Expansion feature (or whole out-of-scope module) in this portfolio, bucketed
  // by pitch status.
  const pitchCounts = { "To Do": 0, Pitching: 0, "In Progress": 0, Added: 0, "Not Required": 0 };
  rows.forEach((lab) => {
    modules.forEach((mod) => {
      const pf = pitchByLab[lab.id];
      if (!isModuleInScope(lab, mod.key)) {
        pitchCounts[getModulePitchStatus(pf, mod.key)]++;
        return;
      }
      mod.params.forEach((p) => {
        if (p.category !== "Expansion" || !isParamInScope(lab, mod.key, p.name)) return;
        pitchCounts[getParamPitchStatus(pf, mod.key, p.name, paramState(lab, mod.key, p.name).included)]++;
      });
    });
  });

  const moduleAvgs = modules.map((mod) => {
    const inScopeRows = rows.filter((lab) => isModuleInScope(lab, mod.key));
    if (!inScopeRows.length) return null;
    const avg = Math.round(inScopeRows.reduce((s, lab) => {
      const scores = computeSavedLabScores(modules, planOf(lab), adoptionByLab[lab.id]);
      const mr = scores.moduleResults.find((m) => m.mod.key === mod.key);
      return s + (mr ? mr.overallPct || 0 : 0);
    }, 0) / inScopeRows.length);
    return { label: mod.name, value: avg, color: avg >= 75 ? "var(--ok)" : avg >= 40 ? "var(--warn)" : "var(--bad)" };
  }).filter(Boolean).sort((a, b) => a.value - b.value);

  async function handleToggleDone(task) {
    try { await apiToggleTaskDone(task); await loadAll(); } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function handleAddTask(payload) {
    try { await apiAddTask({ ...payload, idByName }); await loadAll(); showToast(payload.owners.length > 1 ? `Task added for all ${payload.owners.length} CSMs.` : "Task added."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }

  async function handlePitchStatusChange(status, target) {
    if (status === "Added") {
      setAddedTarget(target); setAddedTrial(false); setAddedAmount(""); setAddedError(false);
      return;
    }
    try {
      const csmId = idByName[labsById[target.labId]?.csm];
      if (target.level === "module") await setModulePitchStatus(target.labId, target.moduleKey, status, csmId);
      else await setParamPitchStatus(target.labId, target.moduleKey, target.paramName, status, csmId);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function confirmMarkAdded() {
    const t = addedTarget;
    let amount = 0;
    if (!addedTrial) {
      amount = parseFloat(addedAmount);
      if (!amount || amount <= 0) { setAddedError(true); return; }
    }
    try {
      const csmId = idByName[labsById[t.labId]?.csm];
      await markFeatureAdded(t, amount, addedTrial, csmId);
      setAddedTarget(null);
      await loadAll();
      showToast(`${t.label} marked Added.`);
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function handleToggleScope(lab, moduleKey) {
    try {
      const wasInScope = isModuleInScope(lab, moduleKey);
      if (wasInScope) {
        // Un-scoping isn't part of this worklist's job (Adoption tab owns that edit) — nudge there instead.
        showToast("Untick scope from this lab's Adoption tab.");
        return;
      }
      await apiMarkModuleInScope(lab.id, moduleKey);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  const labOptions = [];
  computeLabRollup(labs).forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  return (
    <div>
      <h1 className="page-title">My Portfolio</h1>
      <p className="page-sub">Labs assigned to <b>{scopeLabel}</b> — open a lab's row to see which modules are worth pitching as an upsell after initial setup.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={csmNames} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, margin: "0 0 18px" }}>
        <div className="table-card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>Pitch Pipeline (Expansion features)</div>
          <BarChart labelWidth={95} data={[
            { label: "To Do", value: pitchCounts["To Do"], color: "var(--text-faint)" },
            { label: "Pitching", value: pitchCounts.Pitching, color: "var(--warn)" },
            { label: "In Progress", value: pitchCounts["In Progress"], color: "var(--accent)" },
            { label: "Added", value: pitchCounts.Added, color: "var(--ok)" },
            { label: "Not Required", value: pitchCounts["Not Required"], color: "var(--text-dim)" },
          ]} />
        </div>
        <div className="table-card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 12 }}>Avg Adoption by Module</div>
          <BarChart labelWidth={120} valueFmt={(v) => v + "%"} maxValue={100} data={moduleAvgs} />
        </div>
      </div>

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Tasks for Today</h3>
      <div style={{ marginBottom: 22 }}>
        <TasksPanel tasks={tasks} scopeCsm={teamAll ? null : scopeCsm} onToggleDone={handleToggleDone} onAddTask={handleAddTask}
          onOpenLab={onOpenLab} isHead={isHead} currentCSM={currentCSM} csmNames={csmNames} labOptions={labOptions} labsById={labsById} />
      </div>

      <h3 style={{ fontSize: 14, margin: "0 0 8px", display: "flex", alignItems: "center" }}>
        Labs
        <InfoTip>Modules already in scope break down by <b>Expansion</b>-category feature only — set a pitch status from its dropdown (To Do → Pitching → In Progress → Added → Not Required). Picking <b>Added</b> asks for the added cost (or trial/free), then moves the feature onto the Adoption tab and creates a Collections entry automatically. A module not yet in scope is pitched as a whole — picking Added there adds it to scope. To pull a module <i>out</i> of scope, use this lab's Adoption tab.</InfoTip>
      </h3>
      {!rows.length ? (
        <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No labs assigned to {scopeLabel} yet.</div>
      ) : rows.map((lab) => {
        const seg = segmentFor(toINR(lab.mrr, lab.region));
        const scores = computeSavedLabScores(modules, planOf(lab), adoptionByLab[lab.id]);
        const isOpen = expandedLab === lab.id;
        const ringColor = scores.overallPct >= 75 ? "var(--ok)" : scores.overallPct >= 40 ? "var(--warn)" : "var(--bad)";
        const toPitchCount = modules.reduce((sum, mod) => {
          const pf = pitchByLab[lab.id];
          if (!isModuleInScope(lab, mod.key)) return sum + (PITCH_ACTIVE_STATUSES.includes(getModulePitchStatus(pf, mod.key)) ? 1 : 0);
          return sum + mod.params.reduce((s2, p) => {
            if (p.category !== "Expansion" || !isParamInScope(lab, mod.key, p.name)) return s2;
            const st = getParamPitchStatus(pf, mod.key, p.name, paramState(lab, mod.key, p.name).included);
            return s2 + (PITCH_ACTIVE_STATUSES.includes(st) ? 1 : 0);
          }, 0);
        }, 0);

        return (
          <div key={lab.id} className="table-card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", cursor: "pointer" }}
              onClick={() => { setExpandedLab(isOpen ? null : lab.id); setExpandedModule(null); }}>
              <span style={{ width: 14, color: "var(--text-dim)", flex: "none" }}>{isOpen ? "▾" : "▸"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="lab-name clickable" style={{ fontWeight: 700, fontSize: 13.5 }} onClick={(e) => { e.stopPropagation(); onOpenLab(lab.id); }}>{lab.name}</div>
                <div style={{ fontSize: 11.3, color: "var(--text-dim)", marginTop: 1 }}>
                  {lab.id} · {lab.type} Lab{teamAll ? ` · ${lab.csm}` : ""} · <span className="seg-badge" style={{ background: seg.color }}>{seg.code}</span> {SEG_LABELS[seg.code]}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, flex: "none" }}>
                <div style={{ fontWeight: 700 }}>{fmtMoney(lab.mrr, lab.region)}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>MRR</div>
              </div>
              <span className={`status-pill status-${lab.status.replace(" ", "")}`} style={{ flex: "none" }}>{lab.status}</span>
              <div style={{ textAlign: "right", fontSize: 12, width: 52, flex: "none" }}>
                <div style={{ fontWeight: 700, color: ringColor }}>{Math.round(scores.overallPct)}%</div>
                <div style={{ color: "var(--text-dim)", fontSize: 10.5 }}>Adoption</div>
              </div>
              <span className="pitch-count-badge">{toPitchCount} to pitch</span>
            </div>
            {isOpen && (
              <>
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {scores.moduleResults.map(({ mod, overallPct, inScope }) => {
                    const pf = pitchByLab[lab.id];
                    if (!inScope) {
                      const modStatus = getModulePitchStatus(pf, mod.key);
                      return (
                        <div key={mod.key} className="module-row out-of-scope">
                          <div className="module-head" style={{ cursor: "default" }}>
                            <span className="mtoggle"></span>
                            <span>{mod.icon}</span>
                            <span className="mname">{mod.name}</span>
                            <span className="out-of-scope-tag">Not in scope — pitch as a new module</span>
                            <div className="bar-track"></div>
                            <select className="status-select" onClick={(e) => e.stopPropagation()}
                              value={modStatus}
                              onChange={(e) => handlePitchStatusChange(e.target.value, { labId: lab.id, moduleKey: mod.key, level: "module", label: mod.name })}>
                              {PITCH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>
                      );
                    }
                    const isModOpen = expandedModule === mod.key;
                    const pct = Math.round(overallPct || 0);
                    const barColor = pct >= 76 ? "var(--ok)" : pct >= 51 ? "var(--accent)" : pct >= 26 ? "var(--warn)" : "var(--bad)";
                    const expansionParams = mod.params.filter((p) => p.category === "Expansion");
                    const modToPitch = expansionParams.filter((p) => {
                      if (!isParamInScope(lab, mod.key, p.name)) return false;
                      return PITCH_ACTIVE_STATUSES.includes(getParamPitchStatus(pf, mod.key, p.name, paramState(lab, mod.key, p.name).included));
                    }).length;
                    return (
                      <div key={mod.key} className="module-row">
                        <div className="module-head" onClick={() => setExpandedModule(isModOpen ? null : mod.key)}>
                          <span className="mtoggle">{isModOpen ? "▾" : "▸"}</span>
                          <span>{mod.icon}</span>
                          <span className="mname">{mod.name}</span>
                          <span className="mtag">{pct}% adopted</span>
                          <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: barColor }}></div></div>
                          <span className="mpct">{pct}%</span>
                          {modToPitch > 0 && <span className="pitch-count-badge">{modToPitch} to pitch</span>}
                          <label className="scope-toggle" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked readOnly /> In scope
                          </label>
                        </div>
                        <div className={`module-body${isModOpen ? " open" : ""}`}>
                          {!expansionParams.length ? (
                            <div className="param-row" style={{ color: "var(--text-faint)", fontSize: 12 }}>No Expansion features in this module to pitch — everything here is base-plan Adoption, tracked on the Adoption tab.</div>
                          ) : expansionParams.map((p) => {
                            if (!isParamInScope(lab, mod.key, p.name)) {
                              return (
                                <div key={p.name} className="param-row" style={{ opacity: 0.55 }}>
                                  <span className={`param-type ${p.type}`}>{p.type === "M" ? "Mandatory" : "Optional"}</span>
                                  <span className="pname">{p.name}</span>
                                  <span className="out-of-scope-tag">Not applicable to this lab</span>
                                </div>
                              );
                            }
                            const st = paramState(lab, mod.key, p.name);
                            const pStatus = getParamPitchStatus(pf, mod.key, p.name, st.included);
                            return (
                              <div key={p.name} className="param-row">
                                <span className={`param-type ${p.type}`}>{p.type === "M" ? "Mandatory" : "Optional"}</span>
                                <span className="pname">{p.name}</span>
                                <span className={`status-chip st-${st.status.replace(/ /g, "")}`} style={{ cursor: "default" }}>{st.included ? st.status : "Not purchased"}</span>
                                <select className="status-select" onClick={(e) => e.stopPropagation()}
                                  value={pStatus}
                                  onChange={(e) => handlePitchStatusChange(e.target.value, { labId: lab.id, moduleKey: mod.key, paramName: p.name, level: "param", label: p.name, existingParamState: st })}>
                                  {PITCH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}

      <Modal
        open={!!addedTarget}
        title={addedTarget ? `Mark "${addedTarget.label}" as Added` : ""}
        onClose={() => setAddedTarget(null)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setAddedTarget(null) },
          { label: "Confirm Added", className: "btn-primary", onClick: confirmMarkAdded },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={addedTrial} onChange={(e) => setAddedTrial(e.target.checked)} /> This is a trial / free addition (no charge yet)
          </label>
        </div>
        {!addedTrial && (
          <div className="tmpl-field">
            <label>Added Monthly Cost (₹)</label>
            <input type="number" min="0" placeholder="e.g. 5000" value={addedAmount} onChange={(e) => setAddedAmount(e.target.value)}
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
          </div>
        )}
        {addedError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>Enter an amount, or mark this as trial/free.</div>}
      </Modal>
    </div>
  );
}
