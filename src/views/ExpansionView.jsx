import { useEffect, useState, useMemo } from "react";
import { useKpiData } from "../lib/useKpiData";
import PipelineAnalytics from "../components/PipelineAnalytics";
import ExpansionInsights from "../components/ExpansionInsights";
import TasksView from "./TasksView";
import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, fmtUSD, fmtMoney, toINR } from "../lib/format";
import { todayISO } from "../lib/dates";
import { downloadCsv } from "../lib/analyticsFormat";
import { fmtCompactINR } from "../lib/analyticsFormat";
import { computeLabRollup, flattenRollup, clientGroups } from "../lib/labRollup";
import { fetchAllExpansionOpportunities, addExpansionOpportunity, updateExpansionOpportunity, EXPANSION_STATUSES, revenueOn } from "../lib/expansion";
import { buildExpansionItems } from "../lib/expansionItems";
import { fetchFeatureDetails, saveFeatureDetails, applyPitchStageChange } from "../lib/pitch";
import { filterLabsByLabType } from "../lib/labs";
import { fetchAllPurchases, addPurchaseCharges, updatePurchaseCharge } from "../lib/purchases";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import ExpansionDrawer from "../components/ExpansionDrawer";
import PitchStageModal from "../components/PitchStageModal";
import InfoTip from "../components/InfoTip";
import Paginated from "../components/Pager";
import SearchSelect from "../components/SearchSelect";
import { labSelectOptions } from "../lib/selectOptions";

const STATUS_COLORS = { Onboarding: "var(--accent)", Pipeline: "var(--text-dim)", Live: "var(--ok)", Lost: "var(--bad)" };

export default function ExpansionView({ labs: allLabs, modules, plans, viewer, idByName, onOpenLab, onPatchLab, showToast }) {
  const kpi = useKpiData({ labs: allLabs, modules, plans, idByName });
  const [tab, setTab] = useSessionState("expansion.tab", "analytics");
  // Same CSM/Manager split every other portfolio-wide screen (Collections, Dashboard, Tasks…)
  // uses — a plain CSM sees only their own deals, a Lead/Admin defaults to their own but can
  // flip to Team View for the consolidated picture across every CSM.
  const scopedCsm = useScopedCsm(viewer, "expansion");
  const { isHead, scope, setScope, csmFilter, setCsmFilter, teamNames, scopeCsm, teamAll, labType, setLabType } = scopedCsm;
  const labs = useMemo(() => filterLabsByLabType(allLabs, labType), [allLabs, labType]);

  const [items, setItems] = useState([]);
  const [purchases, setPurchases] = useState([]); // features bought through Expansion (migration 0042)
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  const [details, setDetails] = useState({}); // features' expected live date and description
  const [drawer, setDrawer] = useState(null);   // { row } to edit, { adding: true } to add
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(null); // a feature's stage change waiting for its comment
  const [fLab, setFLab] = useSessionState("expansion.fLab", "");
  const [fStatus, setFStatus] = useSessionState("expansion.fStatus", "");
  const [fKind, setFKind] = useSessionState("expansion.fKind", "");
  const [q, setQ] = useSessionState("expansion.q", "");
  const [dealsView, setDealsView] = useSessionState("expansion.dealsView", "deals");

  async function loadAll(quiet = false) {
    if (!SUPABASE_CONFIGURED) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setItems(await fetchAllExpansionOpportunities());
      setPurchases(await fetchAllPurchases().catch(() => [])); // table may not exist before migration 0042
      setDetails(await fetchFeatureDetails().catch(() => ({})));
    } catch (err) { setError(err.message || "Failed to load expansion opportunities."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!SUPABASE_CONFIGURED) {
    return <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Expansion needs a database connected.</div>;
  }
  if (loading || kpi.loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading expansion…</div>;
  if (error || kpi.error) return <div className="error-banner">Couldn't load expansion — {error || kpi.error}</div>;

  const scopeLabel = teamAll ? "the whole team" : scopeCsm;

  const allRows = computeLabRollup(labs);
  const rows = scopeCsm ? allRows.filter((r) => r.csm === scopeCsm || r.children.some((c) => c.csm === scopeCsm)) : allRows;
  const flat = flattenRollup(rows);
  const flatIds = new Set(flat.map((l) => l.id));
  const labsById = {};
  labs.forEach((l) => { labsById[l.id] = l; });

  const groups = clientGroups(labs, scopeCsm);
  const moduleName = Object.fromEntries(modules.map((m) => [m.key, m.name]));
  const allExpansion = buildExpansionItems({ opps: items, purchases, labs, modules, plans, adoptionByLab: kpi.data.adoptionByLab, pitchByLab: kpi.data.pitchByLab, details });
  const scoped = allExpansion.filter((r) => flatIds.has(r.labId));
  const labOptions = [];
  allRows.forEach((r) => { labOptions.push(r); r.children.forEach((c) => labOptions.push(c)); });

  // The numbers above stay whole-portfolio; the type tabs and filters only narrow the list.
  const needle = q.trim().toLowerCase();
  const filteredNoKind = scoped.filter((r) => (!fLab || r.labId === fLab) && (!fStatus || r.status === fStatus)
    && (!needle || [r.title, labsById[r.labId]?.name, moduleName[r.moduleKey], labsById[r.labId]?.csm].some((v) => String(v || "").toLowerCase().includes(needle))));
  const shown = fKind ? filteredNoKind.filter((r) => r.kind === fKind) : filteredNoKind;
  const fmtDay = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" }) : "—");

  // The list is wide, so it shows each lab's own currency; hovering an amount gives both.
  const native = (amount, lab) => (lab.region === "ROW" ? fmtUSD(amount) : fmtINR(amount));

  function download() {
    const rows = [["Lab", "Title", "Type", "Module", "Monthly", "Annual", "Currency", "Monthly (INR)", "Annual (INR)", "Status", "Trial", "Stage", "Won / purchased", "Expected live", "Lost on", "Owner", "Notes"]];
    shown.forEach((r) => {
      const lab = labsById[r.labId];
      rows.push([lab?.name, r.title, r.kind === "Feature" ? "Feature Purchased" : "Manual", moduleName[r.moduleKey] || "", r.monthly, r.annual, lab?.region === "ROW" ? "USD" : "INR",
        Math.round(toINR(r.monthly, lab?.region)), Math.round(toINR(r.annual, lab?.region)), r.status, r.isTrial ? "Yes" : "", r.stage || "", r.startedOn || "", r.expectedLive || "", r.liveUntil || "", lab?.csm || "", r.description || r.note]);
    });
    downloadCsv(`expansion-deals-${todayISO()}.csv`, rows);
  }

  const refresh = async () => { await loadAll(true); await kpi.reload?.(); };

  async function saveManual(payload) {
    const lab = labsById[payload.labId];
    const dealId = drawer.row?.dealId;
    setSaving(true);
    try {
      if (dealId) await updateExpansionOpportunity(dealId, { ...payload, csmId: idByName?.[lab?.csm] }, lab?.name);
      else await addExpansionOpportunity({ ...payload, csmId: idByName?.[lab?.csm] }, lab?.name);
      setDrawer(null);
      await refresh();
      showToast(dealId ? "Expansion updated." : "Expansion added.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
    finally { setSaving(false); }
  }

  async function saveFeature({ expectedLive, description, amount, stage }) {
    const { row } = drawer;
    const lab = labsById[row.labId];
    const csmId = idByName?.[lab?.csm];
    setSaving(true);
    try {
      if (row.item && (expectedLive !== (row.expectedLive || "") || description !== (row.description || ""))) {
        await saveFeatureDetails({ labId: row.labId, moduleKey: row.moduleKey, paramName: row.paramName, stage: row.stage, expectedLive, description, label: row.title, csmId });
      }
      if (row.purchaseId && amount != null && amount !== row.monthly) {
        if (row.isTrial) { if (amount > 0) await addPurchaseCharges(row.purchaseId, amount, row.labId, csmId, row.title, lab?.region); }
        else await updatePurchaseCharge(row.purchaseId, amount, row.monthly, row.labId, csmId, row.title, lab?.region);
      }
      setDrawer(null);
      await refresh();
      if (row.item && stage && stage !== row.stage) {
        const { r, mod } = row.item;
        setPending({ target: { labId: row.labId, moduleKey: mod.key, paramName: r.def.name, level: "param", label: r.def.name, existingParamState: r.state, region: lab?.region }, from: row.stage, to: stage, lab });
      } else showToast("Expansion updated.");
    } catch (err) { showToast(`⚠ ${err.message}`); }
    finally { setSaving(false); }
  }

  async function confirmStage({ comment, amount, isTrial, due }) {
    const { target, from, to, lab } = pending;
    try {
      const res = await applyPitchStageChange(target, { from, to, comment, amount, isTrial, csmId: idByName?.[lab?.csm], labMrr: lab?.mrr, due });
      if (res.newMrr != null) onPatchLab?.(target.labId, { mrr: res.newMrr });
      setPending(null);
      await refresh();
      showToast(res.message);
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  // Each row's account = its client (a parent and its child labs together), and that client's Expansion ARR.
  const accountArr = {};
  groups.forEach((g) => {
    const ids = new Set(g.labs.map((l) => l.id));
    const arr = revenueOn(scoped.filter((r) => ids.has(r.labId)), todayISO(), (amount, labId) => toINR(amount, labsById[labId]?.region)).arr;
    g.labs.forEach((l) => { accountArr[l.id] = arr; });
  });

  const openTaskCount = kpi.data.tasks.filter((t) => t.source === "Expansion" && t.status !== "Done" && (!scopeCsm || t.owner === scopeCsm)).length;
  const KIND_TABS = [["", "All Expansions", filteredNoKind.length], ["Feature", "Feature", filteredNoKind.filter((r) => r.kind === "Feature").length], ["Manual", "Manual", filteredNoKind.filter((r) => r.kind === "Manual").length]];

  const dealsTab = () => (
    <div>
      <p className="page-sub">Expansion revenue, deals and tasks for <b>{scopeLabel}</b>.</p>

      <ScopeToggle isHead={isHead} scope={scope} setScope={setScope} csmFilter={csmFilter} setCsmFilter={setCsmFilter} csmNames={teamNames} labType={labType} setLabType={setLabType} />

      <ExpansionInsights rows={scoped} labs={flat} groups={groups} modules={modules} showByCsm={teamAll} />

      <div className="tabbar" style={{ margin: "18px 0 12px" }}>
        <button className={`tabbtn${dealsView === "deals" ? " active" : ""}`} onClick={() => setDealsView("deals")}>Deals &amp; Purchases ({scoped.length})</button>
        <button className={`tabbtn${dealsView === "tasks" ? " active" : ""}`} onClick={() => setDealsView("tasks")}>Expansion Tasks ({openTaskCount} open)</button>
      </div>

      {dealsView === "tasks" ? (
        <TasksView labs={allLabs} modules={modules} plans={plans} viewer={viewer} idByName={idByName} onOpenLab={onOpenLab} onPatchLab={onPatchLab} showToast={showToast}
          fixedSource="Expansion" scoped={scopedCsm} onStageChanged={() => { loadAll(true); kpi.reload?.(); }} />
      ) : (
        <>
          <div className="filters" style={{ alignItems: "center" }}>
            {KIND_TABS.map(([k, label, n]) => <button key={k} className={`btn ${fKind === k ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => setFKind(k)}>{label} ({n})</button>)}
            <SearchSelect value={fLab} onChange={setFLab} options={labSelectOptions(labOptions.filter((l) => flatIds.has(l.id)))} emptyLabel="All labs" placeholder="All labs" />
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {EXPANSION_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
            <input type="text" placeholder="🔍 Search expansions…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 170 }} />
            {(fLab || fStatus || q) && <span className="clear" onClick={() => { setFLab(""); setFStatus(""); setQ(""); }}>Clear filters</span>}
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={download}>Download</button>
              <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={() => setDrawer({ adding: true })}>+ Add Expansion</button>
            </span>
          </div>

          {!shown.length ? (
            <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>{scoped.length ? "Nothing matches these filters." : `No expansions for ${scopeLabel} yet.`}</div>
          ) : (
            <div className="table-card"><Paginated items={shown}>{(pageRows) => (<div className="table-scroll"><table className="child-mini">
              <thead><tr><th>Lab</th><th>Expansion Title</th><th>Type</th><th>Module</th><th>Monthly MRR</th><th>Annual Value</th><th>Status</th><th>Expected Live</th><th>Owner</th><th title="This client's Expansion ARR, all its labs together">A/C ARR</th><th>Actions</th></tr></thead>
              <tbody>{pageRows.map((r) => {
                const lab = labsById[r.labId];
                if (!lab) return null;
                const hasValue = !r.isTrial && r.monthly > 0;
                return (
                  <tr key={r.id}>
                    <td className="lab-name clickable" style={{ whiteSpace: "normal", minWidth: 120 }} onClick={() => onOpenLab(r.labId)}>{lab.name}</td>
                    <td title={r.description || r.note || undefined} style={{ whiteSpace: "normal", minWidth: 130 }}>{r.title || <span style={{ color: "var(--text-faint)" }}>Untitled</span>}{r.isTrial && <span className="cat-tag cat-Warn"> Trial</span>}</td>
                    <td><span className={`cat-tag cat-${r.kind === "Feature" ? "Adoption" : "Expansion"}`}>{r.kind}</span></td>
                    <td style={{ fontSize: 11.5, whiteSpace: "normal" }}>{moduleName[r.moduleKey] || "—"}</td>
                    <td className="mrr-cell" title={hasValue ? fmtMoney(r.monthly, lab.region) : undefined}>{hasValue ? native(r.monthly, lab) : "—"}</td>
                    <td className="mrr-cell" title={hasValue ? fmtMoney(r.annual, lab.region) : undefined}>{hasValue ? native(r.annual, lab) : "—"}</td>
                    <td title={r.stage ? `Stage: ${r.stage}` : undefined}><span className="status-chip" style={{ background: "transparent", border: `1px solid ${STATUS_COLORS[r.status] || "var(--border)"}`, color: STATUS_COLORS[r.status] || "var(--text-dim)", cursor: "default" }}>{r.status}</span></td>
                    <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{r.status === "Lost" && r.liveUntil ? `Lost ${fmtDay(r.liveUntil)}` : fmtDay(r.expectedLive)}</td>
                    <td style={{ whiteSpace: "normal" }}>{lab.csm || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{accountArr[r.labId] ? fmtCompactINR(accountArr[r.labId]) : "—"}</td>
                    <td><button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => setDrawer({ row: r })}>Edit</button></td>
                  </tr>
                );
              })}</tbody>
            </table></div>)}</Paginated></div>
          )}
        </>
      )}

      {drawer && (
        <ExpansionDrawer key={drawer.row?.id || "new"} row={drawer.row || null} deal={drawer.row?.dealId ? items.find((i) => i.id === drawer.row.dealId) : null}
          labOptions={labOptions.filter((l) => flatIds.has(l.id))} labsById={labsById} modules={modules} saving={saving}
          onClose={() => setDrawer(null)} onSaveManual={saveManual} onSaveFeature={saveFeature} />
      )}
      {pending && <PitchStageModal target={pending.target} fromStatus={pending.from} toStatus={pending.to} onClose={() => setPending(null)} onConfirm={confirmStage} />}
    </div>
  );

  return (
    <div>
      <h1 className="page-title">
        Expansion
        <InfoTip>Analytics, CSM Performance and Module-wise show the Expansion pipeline: every Not-in-plan parameter by stage (To-Do 0, Pitching 10, Trial 15, Purchased 100, Lost 0), each client's parent and child labs averaged. Deals &amp; Purchases lists every expansion: Feature comes from a lab's Adoption tab (Pitching or Trial onwards), Manual is added with Add Expansion. Expansion MRR and ARR are only the revenue from expansion: priced purchased features plus Live deals, not the lab's total MRR. They don't move with invoices.</InfoTip>
      </h1>
      <p className="page-sub">Track expansion progress, deals, tasks and revenue by lab, CSM and module.</p>
      <PipelineAnalytics pipeline="expansion" page="expansion" labs={allLabs} viewer={viewer} idByName={idByName} onOpenLab={onOpenLab} kpi={kpi}
        tab={tab} onTab={setTab} extraTabs={[{ key: "deals", label: "Deals & Purchases", render: dealsTab }]} />
    </div>
  );
}
