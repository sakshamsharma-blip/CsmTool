import { useEffect, useState, useMemo } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtMoney, toINR, segmentFor } from "../lib/format";
import { computeLabRollup } from "../lib/labRollup";
import { fetchAllLabsAdoption, computeSavedLabScores, LIVE_STAGES } from "../lib/adoption";
import Paginated from "../components/Pager";
import {
  fetchAllPitchStatus, applyPitchStageChange, PITCH_OPEN_STATUSES, pitchOptionsFor,
} from "../lib/pitch";
import { fetchAllTasks, toggleTaskDone as apiToggleTaskDone, addTask as apiAddTask } from "../lib/tasks";
import { fetchAllCollectionsItems } from "../lib/collections";
import { fetchAllPurchases, mergeCharges } from "../lib/purchases";
import { filterLabsByLabType } from "../lib/labs";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import PortfolioCharts from "../components/PortfolioCharts";
import TasksPanel from "../components/TasksPanel";
import PitchStageModal from "../components/PitchStageModal";
import InfoTip from "../components/InfoTip";

const SEG_LABELS = { A: "Enterprise", B: "Premium", C: "Advance", D: "Standard", E: "Essential" };


export default function PortfolioView({ labs: allLabs, modules, plans, viewer, idByName, onOpenLab, onPatchLab, showToast }) {
  const { currentCSM } = viewer;
  const { isHead, scope, setScope, csmFilter, setCsmFilter, csmNames, teamNames, scopeCsm, teamAll, labType, setLabType } = useScopedCsm(viewer, "portfolio");
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);

  const [adoptionByLab, setAdoptionByLab] = useState({});
  const [pitchByLab, setPitchByLab] = useState({});
  const [tasks, setTasks] = useState([]);
  const [collItems, setCollItems] = useState([]); // for each purchased feature's Priced / Trial tag
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  const [expandedLab, setExpandedLab] = useState(null);
  const [expandedModule, setExpandedModule] = useState(null);
  // A pitch-stage change waiting for its confirm step (optional comment; Added also asks for the cost):
  // { target: {labId, moduleKey, paramName, level, label, existingParamState}, from, to }
  const [pending, setPending] = useState(null);

  async function loadAll() {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [adoption, pitch, tk, items, purchases] = await Promise.all([
        fetchAllLabsAdoption(), fetchAllPitchStatus(), fetchAllTasks({ ...invert(idByName) }), fetchAllCollectionsItems(),
        fetchAllPurchases().catch(() => []), // table may not exist before migration 0042
      ]);
      setCollItems(mergeCharges(purchases, items));
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

  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  function planOf(lab) { return plans.find((p) => p.id === lab.plan) || plans[0]; }
  // One score per lab under the v2 adoption model (lib/adoption.js) — every parameter resolved as In plan / Not
  // in plan (+ purchased, rollout status, pitch stage). Computed once here and reused below.
  const scoresByLab = {};
  rows.forEach((lab) => { scoresByLab[lab.id] = computeSavedLabScores(modules, planOf(lab), adoptionByLab[lab.id], pitchByLab[lab.id]); });
  const allParamsOf = (lab) => scoresByLab[lab.id].moduleResults.flatMap((m) => m.params);

  // Live monitoring — every In-plan / purchased parameter in Live 1–4, with how long it has been live (longest first).
  const liveRows = [];
  rows.forEach((lab) => scoresByLab[lab.id].moduleResults.forEach(({ mod, params }) => params.forEach((r) => {
    if (!(r.inPlan || r.purchased) || r.lost || !LIVE_STAGES.includes(r.status)) return;
    const st = r.state || {};
    const days = st.liveStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(st.liveStartedAt).getTime()) / 86400000)) : null;
    liveRows.push({
      labId: lab.id, labName: lab.name, module: mod.name, param: r.def.name, stage: r.status, liveSince: st.liveStartedAt, days,
    });
  })));
  liveRows.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  async function handleToggleDone(task) {
    try { await apiToggleTaskDone(task, idByName[currentCSM]); await loadAll(); } catch (err) { showToast(`⚠ ${err.message}`); }
  }
  async function handleAddTask(payload) {
    try { await apiAddTask({ ...payload, idByName }); await loadAll(); showToast(payload.owners.length > 1 ? `Task added for all ${payload.owners.length} CSMs.` : "Task added."); }
    catch (err) { showToast(`⚠ ${err.message}`); }
  }

  // Every stage change goes through the confirm step, so each one can carry an optional comment and is
  // logged to Lab History whether or not a comment was written.
  function handlePitchStatusChange(status, target) {
    if (status === target.fromStatus) return;
    // region rides along so the Added step asks for the cost in the lab's own currency (₹ or $).
    setPending({ target: { ...target, region: labsById[target.labId]?.region }, from: target.fromStatus, to: status });
  }
  async function confirmStageChange({ comment, amount, isTrial, due }) {
    const { target: t, from, to } = pending;
    try {
      const lab = labsById[t.labId];
      const res = await applyPitchStageChange(t, { from, to, comment, amount, isTrial, csmId: idByName[lab?.csm], labMrr: lab?.mrr, due });
      if (res.newMrr != null) onPatchLab?.(t.labId, { mrr: res.newMrr });
      setPending(null);
      showToast(res.message);
      await loadAll();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }


  const labOptions = [];
  computeLabRollup(labs).forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  return (
    <div>
      <h1 className="page-title">My Portfolio</h1>
      <p className="page-sub">Labs assigned to <b>{scopeLabel}</b> — open a lab's row to see which modules are worth pitching as an upsell after initial setup.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />

      <PortfolioCharts labs={rows} scoresByLab={scoresByLab} />

      <h3 style={{ fontSize: 14, margin: "18px 0 8px", display: "flex", alignItems: "center" }}>
        Live monitoring
        <InfoTip>Every In-plan (or purchased) parameter now in Live 1–4, lab by lab, longest in Live first. Move it on to Adopted from the lab's Adoption tab (or Tasks) whenever it's being used; that step asks for an adoption note.</InfoTip>
      </h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {LIVE_STAGES.map((st) => <span key={st} className="cat-tag cat-Adoption">{st}: {liveRows.filter((r) => r.stage === st).length}</span>)}
      </div>
      <div className="table-card" style={{ marginBottom: 18 }}>
        {!liveRows.length ? <div style={{ padding: "14px 18px", color: "var(--text-faint)", fontSize: 12.5 }}>Nothing is in Live right now.</div> : (
          <Paginated items={liveRows}>{(page) => (
            <div className="table-scroll"><table className="child-mini">
              <thead><tr><th>Lab</th><th>Module</th><th>Parameter</th><th>Stage</th><th>Live since</th><th>Days in Live</th></tr></thead>
              <tbody>{page.map((r) => (
                <tr key={`${r.labId}|${r.module}|${r.param}`}>
                  <td className="lab-name clickable" onClick={() => onOpenLab(r.labId)}>{r.labName}</td>
                  <td>{r.module}</td><td>{r.param}</td><td><b>{r.stage}</b></td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.liveSince ? new Date(r.liveSince).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}</td>
                  <td style={{ fontWeight: 700 }}>{r.days == null ? "—" : `${r.days}d`}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}</Paginated>
        )}
      </div>

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Tasks for Today</h3>
      <div style={{ marginBottom: 22 }}>
        <TasksPanel persistKey="portfolio" tasks={labType ? tasks.filter((t) => labsById[t.labId]) : tasks} scopeCsm={teamAll ? null : scopeCsm} onToggleDone={handleToggleDone} onAddTask={handleAddTask}
          onOpenLab={onOpenLab} isHead={isHead} currentCSM={currentCSM} csmNames={csmNames} labOptions={labOptions} labsById={labsById} />
      </div>

      <h3 style={{ fontSize: 14, margin: "0 0 8px", display: "flex", alignItems: "center" }}>
        Labs
        <InfoTip>Each module lists this lab's add-ons — the parameters marked <b>Not in plan</b> on its Adoption tab. Move them through the Expansion stages (To-Do → Pitching → Trial → Purchased, or Not Required / Not Applicable / Lost); every change needs a comment and is logged to Lab History. <b>Purchased</b> asks Priced or Trial, records the purchase on the Expansion tab and moves the feature onto the In-plan list. <b>Lost after Purchase</b> lowers MRR by the feature's charge. The adoption % uses the same 0–100 ladder as the lab's Adoption tab.</InfoTip>
      </h3>
      {!rows.length ? (
        <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No labs assigned to {scopeLabel} yet.</div>
      ) : rows.map((lab) => {
        const seg = segmentFor(toINR(lab.mrr, lab.region));
        const scores = scoresByLab[lab.id];
        const isOpen = expandedLab === lab.id;
        const ringColor = scores.overallPct >= 85 ? "var(--ok)" : scores.overallPct >= 70 ? "var(--accent)" : scores.overallPct >= 30 ? "var(--warn)" : "var(--bad)";
        const toPitchCount = allParamsOf(lab).filter((r) => !r.inPlan && !r.purchased && PITCH_OPEN_STATUSES.includes(r.pitch)).length;

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
                  {scores.moduleResults.map(({ mod, overallPct, params }) => {
                    const isModOpen = expandedModule === mod.key;
                    const pct = overallPct == null ? null : Math.round(overallPct);
                    const barColor = pct == null ? "var(--surface-3)" : pct >= 85 ? "var(--ok)" : pct >= 70 ? "var(--accent)" : pct >= 30 ? "var(--warn)" : "var(--bad)";
                    // This lab's add-ons in this module = its Not-in-plan parameters.
                    const addOns = params.filter((r) => !r.inPlan);
                    const modToPitch = addOns.filter((r) => !r.purchased && PITCH_OPEN_STATUSES.includes(r.pitch)).length;
                    return (
                      <div key={mod.key} className="module-row">
                        <div className="module-head" onClick={() => setExpandedModule(isModOpen ? null : mod.key)}>
                          <span className="mtoggle">{isModOpen ? "▾" : "▸"}</span>
                          <span>{mod.icon}</span>
                          <span className="mname">{mod.name}</span>
                          <span className="mtag">{params.length - addOns.length}/{params.length} in plan</span>
                          <div className="bar-track"><div className="bar-fill" style={{ width: `${pct || 0}%`, background: barColor }}></div></div>
                          <span className="mpct">{pct == null ? "—" : `${pct}%`}</span>
                          {modToPitch > 0 && <span className="pitch-count-badge">{modToPitch} to pitch</span>}
                        </div>
                        <div className={`module-body${isModOpen ? " open" : ""}`}>
                          {!addOns.length ? (
                            <div className="param-row" style={{ color: "var(--text-faint)", fontSize: 12 }}>Everything in this module is in {lab.name}'s plan — nothing to pitch. Rollout is tracked on the lab's Adoption tab.</div>
                          ) : addOns.map((r) => {
                            const p = r.def;
                            const lost = r.lost && r.purchased;
                            const charge = r.purchased && !lost ? collItems.find((i) => i.labId === lab.id && i.moduleKey === mod.key && i.paramName === p.name) : null;
                            return (
                              <div key={p.name} className="param-row">
                                <span className={`param-type ${p.type}`}>{p.type === "M" ? "Mandatory" : "Optional"}</span>
                                <span className="pname">{p.name}</span>
                                <span className={`status-chip ${r.status === "Adopted" ? "st-Adopted" : r.status === "To-Do" || !r.purchased ? "st-NotStarted" : "st-InProgress"}`} style={{ cursor: "default" }}>{lost ? "Lost after purchase" : r.purchased ? r.status : "Not purchased"}</span>
                                {charge && (charge.isTrial
                                  ? <span className="cat-tag cat-Warn" title="Add charges from this lab's Adoption tab">Trial</span>
                                  : <span className="cat-tag cat-Adoption">Priced {fmtMoney(charge.amount, lab.region)}/mo</span>)}
                                <select className="status-select" onClick={(e) => e.stopPropagation()}
                                  value={r.pitch}
                                  onChange={(e) => handlePitchStatusChange(e.target.value, { labId: lab.id, moduleKey: mod.key, paramName: p.name, level: "param", label: p.name, existingParamState: r.state, fromStatus: r.pitch })}>
                                  {pitchOptionsFor(r.purchased, r.pitch).map((st) => <option key={st} value={st}>{st}</option>)}
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

      {pending && (
        <PitchStageModal target={pending.target} fromStatus={pending.from} toStatus={pending.to} onClose={() => setPending(null)} onConfirm={confirmStageChange} />
      )}
    </div>
  );
}
