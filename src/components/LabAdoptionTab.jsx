import { useEffect, useMemo, useState } from "react";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtMoney, nativeCurrency } from "../lib/format";
import {
  STATUS_ORDER, fetchLabAdoption, computeLabScores, fetchParamChanges, setParamInPlan, setParamStatus, statusOptions,
} from "../lib/adoption";
import { fetchLabPitchStatus, applyPitchStageChange, pitchOptionsFor, PITCH_STATUSES } from "../lib/pitch";
import { fetchAllCollectionsItems, convertItemToChargeable } from "../lib/collections";
import Modal from "./Modal";
import InfoTip from "./InfoTip";
import PitchStageModal from "./PitchStageModal";
import ModuleResources from "./ModuleResources";
import AdoptionPies from "./AdoptionPies";
import { fetchModuleResources } from "../lib/moduleResources";

const field = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };
const pct = (v) => (v == null ? "—" : `${Math.round(v)}%`);
const barColor = (v) => (v == null ? "var(--surface-3)" : v >= 85 ? "var(--ok)" : v >= 70 ? "var(--accent)" : v >= 30 ? "var(--warn)" : "var(--bad)");

// A lab's Adoption tab (adoption model v2 — see lib/adoption.js). Every module and parameter of the template is
// listed in the template's order. Per parameter the CSM sets In plan / Not in plan; In-plan (and purchased)
// parameters move through the In-plan statuses, Not-in-plan ones through the Expansion stages until purchased.
// EVERY change asks for a comment and saves immediately; the newest comment shows under the parameter and
// clicking the parameter name opens its full audit trail.
export default function LabAdoptionTab({ lab, modules, plans, idByName, currentCSM, myProfileId, isHead, showToast, onPatchLab, onChanged }) {
  const plan = plans.find((p) => p.id === lab.plan) || plans[0];
  const csmId = idByName?.[currentCSM] || idByName?.[lab.csm];
  const nameById = useMemo(() => Object.fromEntries(Object.entries(idByName || {}).map(([n, id]) => [id, n])), [idByName]);

  const [adoption, setAdoption] = useState(SUPABASE_CONFIGURED ? null : { paramState: {} });
  const [pitch, setPitch] = useState({});
  const [changes, setChanges] = useState([]);
  const [collItems, setCollItems] = useState([]);
  const [resources, setResources] = useState([]); // shared docs / training links per module
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);
  const [openModules, setOpenModules] = useState({});
  // Stage filter: "" = everything, otherwise "plan:<status>" (In-plan / purchased track) or "exp:<stage>".
  const [stageFilter, setStageFilter] = useState("");

  const [pendingComment, setPendingComment] = useState(null); // { title, change, apply(comment) }
  const [pendingPitch, setPendingPitch] = useState(null);     // { target, from, to }
  const [trailFor, setTrailFor] = useState(null);             // resolved param whose audit trail is open
  const [chargeItem, setChargeItem] = useState(null);         // trial Collections item getting charges

  async function reload(alsoCollections = false) {
    const [a, p, ch, items] = await Promise.all([
      fetchLabAdoption(lab.id),
      fetchLabPitchStatus(lab.id),
      fetchParamChanges(lab.id).catch(() => []), // audit-trail table may not exist before migration 0034
      alsoCollections || !collItems.length ? fetchAllCollectionsItems().then((all) => all.filter((i) => i.labId === lab.id)) : Promise.resolve(collItems),
    ]);
    setAdoption(a); setPitch(p); setChanges(ch); setCollItems(items);
  }
  // The parent renders this with key={lab.id}, so a different lab always starts from a fresh component.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    let cancelled = false;
    Promise.all([
      fetchLabAdoption(lab.id),
      fetchLabPitchStatus(lab.id),
      fetchParamChanges(lab.id).catch(() => []),
      fetchAllCollectionsItems().then((all) => all.filter((i) => i.labId === lab.id)),
      fetchModuleResources().catch(() => []), // table may not exist before migration 0036
    ])
      .then(([a, p, ch, items, res]) => { if (!cancelled) { setAdoption(a); setPitch(p); setChanges(ch); setCollItems(items); setResources(res); } })
      .catch((err) => { if (!cancelled) setError(err.message || "Failed to load adoption data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lab.id]);

  const scores = useMemo(() => computeLabScores(modules, plan, adoption, pitch), [modules, plan, adoption, pitch]);

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading adoption data…</div>;
  if (error) return <div className="error-banner">Couldn't load adoption data — {error}</div>;

  const latestByParam = {};
  changes.forEach((c) => { const k = `${c.moduleKey}|${c.paramName}`; if (!latestByParam[k]) latestByParam[k] = c; });
  const charge = (moduleKey, paramName) => collItems.find((i) => i.moduleKey === moduleKey && i.paramName === paramName) || null;

  const all = scores.moduleResults.flatMap((m) => m.params);
  const onPlanTrack = (r) => (r.inPlan || r.purchased) && !r.lost;
  const matchesStage = (r) => {
    if (!stageFilter) return true;
    const [track, value] = [stageFilter.slice(0, stageFilter.indexOf(":")), stageFilter.slice(stageFilter.indexOf(":") + 1)];
    return track === "plan" ? onPlanTrack(r) && r.status === value : !onPlanTrack(r) && !r.inPlan && r.pitch === value;
  };

  async function afterChange(message, alsoCollections) {
    await reload(alsoCollections);
    onChanged?.();
    if (message) showToast(message);
  }

  // ---- the three kinds of change ----
  function askInPlan(r, inPlan) {
    if (r.inPlan === inPlan) return;
    setPendingComment({
      title: `${r.def.name}: ${inPlan ? "Not in plan → In plan" : "In plan → Not in plan"}`,
      hint: inPlan ? "It becomes part of this lab's plan (Adoption) and is tracked by rollout status." : "It becomes an add-on (Expansion) that can be pitched and purchased.",
      apply: async (comment) => { await setParamInPlan(lab.id, r, inPlan, comment, csmId); await afterChange(`${r.def.name} is now ${inPlan ? "In plan" : "Not in plan"}.`); },
    });
  }
  function askStatus(r, status) {
    if (r.status === status) return;
    setPendingComment({
      title: `${r.def.name}: ${r.status} → ${status}`,
      label: status === "Adopted" ? "Adoption note — how it's being used after the month of Live monitoring" : undefined,
      hint: status === "Live 1" ? "Live starts a month of monitoring: Live 2, 3 and 4 each unlock a week after the previous one, and Adopted 30 days after Live 1." : undefined,
      apply: async (comment) => { await setParamStatus(lab.id, r, status, comment, csmId, { canStepBack: isHead }); await afterChange(`${r.def.name}: ${status}.`); },
    });
  }
  function askPitch(r, to, mod) {
    if (r.pitch === to) return;
    setPendingPitch({
      target: { labId: lab.id, moduleKey: mod.key, paramName: r.def.name, level: "param", label: r.def.name, existingParamState: r.state, region: lab.region },
      from: r.pitch, to,
    });
  }
  async function confirmPitch({ comment, amount, isTrial }) {
    const { target, from, to } = pendingPitch;
    try {
      const res = await applyPitchStageChange(target, { from, to, comment, amount, isTrial, csmId, labMrr: lab.mrr });
      if (res.newMrr != null) onPatchLab?.(lab.id, { mrr: res.newMrr });
      setPendingPitch(null);
      await afterChange(res.message, to === "Purchased" || to === "Lost after Purchase");
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  return (
    <div>
      <div className="adopt-score-head">
        <span>Adoption score <b>{Math.round(scores.overallPct)}%</b> · Mandatory <b>{Math.round(scores.mandatoryPct)}%</b></span>
        <InfoTip>Out of 100 = everything purchased and fully adopted. Per parameter: In plan / purchased → To-Do 70, In Discussion / Demo 75, Trial 80, Onboarding / Setup 90, Live 1 92, Live 2 94, Live 3 96, Live 4 98, Adopted 100. Not in plan → To-Do 0, Pitching 10, Trial 30; Purchased moves it onto the In-plan list (70). Not Required, Did Not Meet Requirements and Lost = 0; Not Applicable is left out of the score. Modules average their parameters (by weight); the lab averages its modules (by weight). The In-plan list moves one step at a time: each Live step unlocks 7 days after the previous one, and Adopted 30 days after Live 1 started.</InfoTip>
      </div>
      <AdoptionPies moduleResults={scores.moduleResults} />

      <div className="adopt-note" style={{ margin: "0 0 12px" }}>
        {lab.name} is on <b>{plan?.name || "—"}</b>. Every template parameter is listed; mark each <b>In plan</b> or <b>Not in plan</b>.
        Every change asks for a comment and saves straight away. Click a parameter's name to see its history.
      </div>

      <div className="filters" style={{ marginBottom: 12 }}>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="Filter by stage">
          <option value="">All stages</option>
          <optgroup label="In plan / purchased">
            {STATUS_ORDER.map((st) => <option key={st} value={`plan:${st}`}>{st}</option>)}
          </optgroup>
          <optgroup label="Not in plan">
            {PITCH_STATUSES.filter((st) => st !== "Purchased").map((st) => <option key={st} value={`exp:${st}`}>{st}</option>)}
          </optgroup>
        </select>
        {stageFilter && <span className="clear" onClick={() => setStageFilter("")}>Clear filter</span>}
        {stageFilter && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{all.filter(matchesStage).length} parameter(s)</span>}
      </div>

      {scores.moduleResults.map(({ mod, params: allParams, overallPct }) => {
        const params = allParams.filter(matchesStage);
        if (stageFilter && !params.length) return null;
        const isOpen = !!openModules[mod.key] || !!stageFilter;
        const inPlanCount = params.filter((r) => r.inPlan).length;
        return (
          <div key={mod.key} className="module-row">
            <div className="module-head" onClick={() => setOpenModules((o) => ({ ...o, [mod.key]: !o[mod.key] }))}>
              <span className="mtoggle">{isOpen ? "▾" : "▸"}</span>
              <span>{mod.icon}</span>
              <span className="mname">{mod.name}{mod.description ? <InfoTip label={`About ${mod.name}`}>{mod.description}</InfoTip> : null}</span>
              <span className="mtag">{stageFilter ? `${params.length} match` : `${inPlanCount}/${params.length} in plan`}</span>
              {resources.some((r) => r.moduleKey === mod.key) && <span className="mres-badge" title="Docs & training videos">📚 {resources.filter((r) => r.moduleKey === mod.key).length}</span>}
              <div className="bar-track"><div className="bar-fill" style={{ width: `${overallPct || 0}%`, background: barColor(overallPct) }}></div></div>
              <span className="mpct">{pct(overallPct)}</span>
            </div>
            <div className={`module-body${isOpen ? " open" : ""}`}>
              {SUPABASE_CONFIGURED && (
                <div style={{ padding: "0 14px" }}>
                  <ModuleResources moduleKey={mod.key} moduleName={mod.name} resources={resources} myProfileId={myProfileId} isHead={isHead}
                    showToast={showToast} onChanged={async () => setResources(await fetchModuleResources())} />
                </div>
              )}
              {params.map((r) => {
                const latest = latestByParam[r.key];
                // A feature lost after purchase is over: no rollout to track and nothing to charge for.
                const lost = r.lost;
                const c = r.purchased && !lost ? charge(mod.key, r.def.name) : null;
                return (
                  <div key={r.key} className="param-block">
                    <div className="param-row">
                      <span className={`param-type ${r.def.type}`}>{r.def.type === "M" ? "Mandatory" : "Optional"}</span>
                      <span className="pname">
                        <span className="param-link" title="Show this parameter's history" onClick={() => setTrailFor(r)}>{r.def.name}</span>
                        {r.def.description ? <InfoTip label={`About ${r.def.name}`}>{r.def.description}</InfoTip> : null}
                      </span>
                      <span className="param-weight">{r.def.weight}%</span>
                      <span className="plan-toggle" role="group" aria-label="In plan or not">
                        <button type="button" className={r.inPlan ? "active" : ""} onClick={() => askInPlan(r, true)}>In plan</button>
                        <button type="button" className={!r.inPlan ? "active exp" : ""} onClick={() => askInPlan(r, false)}>Not in plan</button>
                      </span>
                      <span className={`cat-tag cat-${r.category}`}>{r.category}</span>
                      {(r.inPlan || r.purchased) && !lost ? (
                        <select className="status-select" value={r.status} onChange={(e) => askStatus(r, e.target.value)} title="In-plan status">
                          {statusOptions(r, { canStepBack: isHead }).map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.value}{o.note ? ` — ${o.note}` : ""}</option>)}
                        </select>
                      ) : null}
                      {!r.inPlan && (
                        <select className="status-select" value={r.pitch} onChange={(e) => askPitch(r, e.target.value, mod)} title={r.purchased ? "Purchased — only Lost after Purchase is left here" : "Expansion stage"}>
                          {pitchOptionsFor(r.purchased, r.pitch).map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                      )}
                      {!r.inPlan && !r.purchased && (
                        <button type="button" className="mark-purchased" onClick={() => askPitch(r, "Purchased", mod)}>Mark purchased</button>
                      )}
                      {lost && r.purchased && <span className="cat-tag cat-Warn" title="Change the stage back if this was a mistake">Lost after purchase</span>}
                      {c && (c.isTrial ? (
                        <span className="cat-tag cat-Warn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          Trial <button type="button" className="mark-purchased" style={{ fontSize: 10.5 }} onClick={() => setChargeItem(c)}>Add charges</button>
                        </span>
                      ) : <span className="cat-tag cat-Adoption">Priced {fmtMoney(c.amount, lab.region)}/mo</span>)}
                      <span className="param-score" title="This parameter's score">{r.score == null ? "n/a" : r.score}</span>
                    </div>
                    {latest && (
                      <div className="param-latest" onClick={() => setTrailFor(r)} title="Show full history">
                        “{latest.comment}” — {nameById[latest.csmId] || "—"}, {new Date(latest.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {pendingComment && (
        <CommentRequiredModal
          title={pendingComment.title}
          hint={pendingComment.hint}
          label={pendingComment.label}
          onClose={() => setPendingComment(null)}
          onConfirm={async (comment) => {
            try { await pendingComment.apply(comment); setPendingComment(null); }
            catch (err) { showToast(`⚠ ${err.message}`); }
          }}
        />
      )}
      {pendingPitch && (
        <PitchStageModal target={pendingPitch.target} fromStatus={pendingPitch.from} toStatus={pendingPitch.to} onClose={() => setPendingPitch(null)} onConfirm={confirmPitch} />
      )}
      {trailFor && (
        <Modal open title={`History — ${trailFor.def.name}`} onClose={() => setTrailFor(null)} actions={[{ label: "Close", className: "btn-primary", onClick: () => setTrailFor(null) }]}>
          {(() => {
            const rows = changes.filter((c) => `${c.moduleKey}|${c.paramName}` === trailFor.key);
            return (
              <div style={{ maxHeight: 360, overflowY: "auto" }}>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
                  Now: <b>{trailFor.inPlan ? "In plan" : trailFor.purchased ? "Not in plan · purchased" : `Not in plan · ${trailFor.pitch}`}</b>
                  {(trailFor.inPlan || trailFor.purchased) ? <> · <b>{trailFor.status}</b></> : null}
                </div>
                {!rows.length ? <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No changes recorded yet.</div> : rows.map((c) => (
                  <div key={c.id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.change}</div>
                    <div style={{ fontSize: 12.5, margin: "2px 0" }}>“{c.comment}”</div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{nameById[c.csmId] || "—"} · {new Date(c.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </Modal>
      )}
      {chargeItem && (
        <AddChargesModal
          item={chargeItem} region={lab.region}
          onClose={() => setChargeItem(null)}
          onConfirm={async (amount) => {
            try {
              await convertItemToChargeable(chargeItem.id, amount, lab.id, csmId, chargeItem.label, lab.region);
              setChargeItem(null);
              await afterChange(`Charges added for ${chargeItem.label} — MRR will update from the next invoice.`, true);
            } catch (err) { showToast(`⚠ ${err.message}`); }
          }}
        />
      )}
    </div>
  );
}

function CommentRequiredModal({ title, hint, label, onClose, onConfirm }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  async function confirm() {
    if (!comment.trim()) { setError(true); return; }
    setSaving(true);
    try { await onConfirm(comment.trim()); } finally { setSaving(false); }
  }
  return (
    <Modal open title={title} onClose={saving ? () => {} : onClose} actions={[
      { label: "Cancel", className: "btn-ghost", onClick: onClose, disabled: saving },
      { label: saving ? "Saving…" : "Save", className: "btn-primary", onClick: confirm, disabled: saving },
    ]}>
      {hint && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>{hint}</div>}
      <div className="tmpl-field">
        <label>{label || "Comment"} <span style={{ color: "var(--bad)" }}>*</span></label>
        <textarea rows="3" autoFocus style={{ ...field, resize: "vertical" }} value={comment} onChange={(e) => { setComment(e.target.value); setError(false); }}
          placeholder="Why is this changing?" />
      </div>
      {error && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>A comment is required.</div>}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>Saved to this parameter's history and the lab's Lab History.</div>
    </Modal>
  );
}

function AddChargesModal({ item, region, onClose, onConfirm }) {
  const [amount, setAmount] = useState("");
  const sym = nativeCurrency(region) === "USD" ? "$" : "₹";
  return (
    <Modal open title="Add Charges" onClose={onClose} actions={[
      { label: "Cancel", className: "btn-ghost", onClick: onClose },
      { label: "Add Charges", className: "btn-primary", onClick: () => { const n = parseFloat(amount); if (Number.isFinite(n) && n > 0) onConfirm(n); } },
    ]}>
      <div className="tmpl-field">
        <label>{item.label} — Monthly Charge ({sym})</label>
        <input type="number" min="0" step="0.01" autoFocus style={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Moves this trial to priced. MRR updates when the invoice comes in.</div>
    </Modal>
  );
}
