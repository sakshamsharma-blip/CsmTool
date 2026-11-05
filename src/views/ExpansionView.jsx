import { useEffect, useState, useMemo } from "react";
import { useKpiData } from "../lib/useKpiData";
import PipelineAnalytics from "../components/PipelineAnalytics";
import ExpansionInsights from "../components/ExpansionInsights";
import TasksView from "./TasksView";
import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { fmtINR, fmtUSD, fmtMoney, toINR } from "../lib/format";
import { todayISO, toLocalISODate } from "../lib/dates";
import { downloadCsv } from "../lib/analyticsFormat";
import { computeLabRollup, flattenRollup, clientGroups } from "../lib/labRollup";
import { fetchAllExpansionOpportunities, addExpansionOpportunity, updateExpansionOpportunity, EXPANSION_STATUSES, expansionRows } from "../lib/expansion";
import { filterLabsByLabType } from "../lib/labs";
import { fetchAllPurchases } from "../lib/purchases";
import { useScopedCsm } from "../lib/useScopedCsm";
import ScopeToggle from "../components/ScopeToggle";
import Modal from "../components/Modal";
import InfoTip from "../components/InfoTip";
import Paginated from "../components/Pager";
import SearchSelect from "../components/SearchSelect";
import { labSelectOptions } from "../lib/selectOptions";

const STATUS_COLORS = { Onboarding: "var(--accent)", Pipeline: "var(--text-dim)", Live: "var(--ok)", Lost: "var(--bad)" };

const inputStyle = { width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" };

function emptyForm() {
  return { labId: "", title: "", moduleKey: "", monthlyRevenue: "", annualRevenue: "", dealWonDate: "", expectedLiveDate: "", status: "Pipeline", comments: "" };
}

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

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState("");
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
  const allExpansion = expansionRows(items, purchases, (ts) => toLocalISODate(new Date(ts)));
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
    const rows = [["Lab", "Title", "Type", "Module", "Monthly", "Annual", "Currency", "Monthly (INR)", "Annual (INR)", "Status", "Trial", "Won / purchased", "Expected live", "Lost on", "Owner", "Notes"]];
    shown.forEach((r) => {
      const lab = labsById[r.labId];
      rows.push([lab?.name, r.title, r.kind === "Feature" ? "Feature Purchased" : "Manual", moduleName[r.moduleKey] || "", r.monthly, r.annual, lab?.region === "ROW" ? "USD" : "INR",
        Math.round(toINR(r.monthly, lab?.region)), Math.round(toINR(r.annual, lab?.region)), r.status, r.isTrial ? "Yes" : "", r.startedOn || "", r.expectedLive || "", r.liveUntil || "", lab?.csm || "", r.note]);
    });
    downloadCsv(`expansion-deals-${todayISO()}.csv`, rows);
  }

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  }
  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      labId: item.labId,
      title: item.title || "",
      moduleKey: item.moduleKey || "",
      monthlyRevenue: item.monthlyRevenue ? String(item.monthlyRevenue) : "",
      annualRevenue: item.annualRevenue ? String(item.annualRevenue) : "",
      dealWonDate: item.dealWonDate || "",
      expectedLiveDate: item.expectedLiveDate || "",
      status: item.status,
      comments: item.comments || "",
    });
    setFormError("");
    setModalOpen(true);
  }
  function setField(field, value) {
    setForm((f) => {
      if (field === "monthlyRevenue") {
        // Annual auto-fills as monthly x 12 until the CSM overrides it directly — same
        // "auto-calculated but editable" convention AddLabDrawer uses for MRR/ARR.
        const autoAnnual = f.annualRevenue === "" || f.annualRevenue === String((parseFloat(f.monthlyRevenue) || 0) * 12);
        return { ...f, monthlyRevenue: value, annualRevenue: autoAnnual ? String((parseFloat(value) || 0) * 12 || "") : f.annualRevenue };
      }
      return { ...f, [field]: value };
    });
  }

  async function handleSave() {
    if (!form.labId) { setFormError("Select a lab."); return; }
    if (!form.title.trim()) { setFormError("Give the expansion a title."); return; }
    if (!form.monthlyRevenue || parseFloat(form.monthlyRevenue) <= 0) { setFormError("Enter a monthly revenue amount."); return; }
    setFormError("");
    const lab = labsById[form.labId];
    const csmId = idByName?.[lab?.csm];
    const payload = {
      labId: form.labId,
      title: form.title.trim(),
      moduleKey: form.moduleKey,
      monthlyRevenue: parseFloat(form.monthlyRevenue) || 0,
      annualRevenue: parseFloat(form.annualRevenue) || 0,
      dealWonDate: form.dealWonDate,
      expectedLiveDate: form.expectedLiveDate,
      status: form.status,
      comments: form.comments.trim(),
      csmId,
    };
    try {
      if (editingId) {
        await updateExpansionOpportunity(editingId, payload, lab?.name);
        showToast("Expansion opportunity updated.");
      } else {
        await addExpansionOpportunity(payload, lab?.name);
        showToast("Expansion opportunity added.");
      }
      setModalOpen(false);
      await loadAll(true);
      kpi.reload?.();
    } catch (err) { showToast(`⚠ ${err.message}`); }
  }

  const openTaskCount = kpi.data.tasks.filter((t) => t.source === "Expansion" && t.status !== "Done" && (!scopeCsm || t.owner === scopeCsm)).length;
  const KIND_TABS = [["", "All Expansions", filteredNoKind.length], ["Feature", "Feature Purchased", filteredNoKind.filter((r) => r.kind === "Feature").length], ["Manual", "Manual Expansion", filteredNoKind.filter((r) => r.kind === "Manual").length]];

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
              <button className="btn btn-primary" style={{ fontSize: 11.5, padding: "6px 12px" }} onClick={openAdd}>+ Add Expansion</button>
            </span>
          </div>

          {!shown.length ? (
            <div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>{scoped.length ? "Nothing matches these filters." : `No expansions for ${scopeLabel} yet.`}</div>
          ) : (
            <div className="table-card"><Paginated items={shown}>{(pageRows) => (<div className="table-scroll"><table className="child-mini">
              <thead><tr><th>Lab</th><th>Expansion</th><th>Type</th><th>Module</th><th>Monthly</th><th>Annual</th><th>Status</th><th>Won</th><th>Expected live</th><th>Owner</th><th></th></tr></thead>
              <tbody>{pageRows.map((r) => {
                const lab = labsById[r.labId];
                if (!lab) return null;
                return (
                  <tr key={r.id}>
                    <td className="lab-name clickable" onClick={() => onOpenLab(r.labId)}>{lab.name}</td>
                    <td title={r.note || undefined} style={{ whiteSpace: "normal", minWidth: 130 }}>{r.title || <span style={{ color: "var(--text-faint)" }}>Untitled</span>}{r.isTrial && <span className="cat-tag cat-Warn"> Trial</span>}</td>
                    <td><span className={`cat-tag cat-${r.kind === "Feature" ? "Adoption" : "Expansion"}`}>{r.kind === "Feature" ? "Feature" : "Manual"}</span></td>
                    <td style={{ fontSize: 11.5, whiteSpace: "normal" }}>{moduleName[r.moduleKey] || "—"}</td>
                    <td className="mrr-cell" title={r.isTrial ? undefined : fmtMoney(r.monthly, lab.region)}>{r.isTrial ? "—" : native(r.monthly, lab)}</td>
                    <td className="mrr-cell" title={r.isTrial ? undefined : fmtMoney(r.annual, lab.region)}>{r.isTrial ? "—" : native(r.annual, lab)}</td>
                    <td><span className="status-chip" style={{ background: "transparent", border: `1px solid ${STATUS_COLORS[r.status] || "var(--border)"}`, color: STATUS_COLORS[r.status] || "var(--text-dim)", cursor: "default" }}>{r.status}</span></td>
                    <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }} title={r.chargesAddedOn ? `Charges added ${fmtDay(r.chargesAddedOn)}` : undefined}>{fmtDay(r.startedOn)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{r.status === "Lost" && r.liveUntil ? `Lost ${fmtDay(r.liveUntil)}` : fmtDay(r.expectedLive)}</td>
                    <td>{lab.csm || "—"}</td>
                    <td>{r.kind === "Manual"
                      ? <span className="mark-purchased" onClick={() => openEdit(items.find((i) => i.id === r.dealId))}>Edit</span>
                      : <span className="mark-purchased" title="Purchases change through their stage on the lab's Adoption tab" onClick={() => onOpenLab(r.labId, "adoption")}>Open</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>)}</Paginated></div>
          )}
        </>
      )}

      <Modal
        open={modalOpen}
        title={editingId ? "Edit Expansion" : "Add Expansion"}
        onClose={() => setModalOpen(false)}
        actions={[
          { label: "Cancel", className: "btn-ghost", onClick: () => setModalOpen(false) },
          { label: editingId ? "Save Changes" : "Add Expansion", className: "btn-primary", onClick: handleSave },
        ]}
      >
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Lab</label>
          <SearchSelect value={form.labId} onChange={(v) => setField("labId", v)} options={labSelectOptions(labOptions)} placeholder="Search a lab…" inputStyle={inputStyle} disabled={!!editingId} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Expansion Title</label>
          <input value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="e.g. Extra logins for all centres" style={inputStyle} />
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Module (optional)</label>
          <select value={form.moduleKey} onChange={(e) => setField("moduleKey", e.target.value)} style={inputStyle}>
            <option value="">Not tied to a module</option>
            {modules.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Monthly Revenue ({form.labId && labsById[form.labId]?.region === "ROW" ? "$" : "₹"})</label>
            <input type="number" min="0" value={form.monthlyRevenue} onChange={(e) => setField("monthlyRevenue", e.target.value)} style={inputStyle} />
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Annual Revenue ({form.labId && labsById[form.labId]?.region === "ROW" ? "$" : "₹"})</label>
            <input type="number" min="0" value={form.annualRevenue} onChange={(e) => setField("annualRevenue", e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Deal Won Date</label>
            <input type="date" value={form.dealWonDate} onChange={(e) => setField("dealWonDate", e.target.value)} style={inputStyle} />
          </div>
          <div className="tmpl-field" style={{ flex: 1 }}>
            <label>Expected Live Date</label>
            <input type="date" value={form.expectedLiveDate} onChange={(e) => setField("expectedLiveDate", e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div className="tmpl-field" style={{ marginBottom: 12 }}>
          <label>Status</label>
          <select value={form.status} onChange={(e) => setField("status", e.target.value)} style={inputStyle}>
            {EXPANSION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="tmpl-field">
          <label>Comments / Notes (optional)</label>
          <textarea rows="2" value={form.comments} onChange={(e) => setField("comments", e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        {formError && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 8 }}>{formError}</div>}
      </Modal>
    </div>
  );

  return (
    <div>
      <h1 className="page-title">
        Expansion
        <InfoTip>Analytics, CSM Performance and Module-wise show the Expansion pipeline: every Not-in-plan parameter by stage (To-Do 0, Pitching 10, Trial 15, Purchased 100, Lost 0), each client's parent and child labs averaged. Deals &amp; Purchases has whole-opportunity deals (Onboarding → Pipeline → Live → Lost) and every feature bought. Expansion MRR and ARR are only the revenue from expansion: priced purchased features plus Live deals, not the lab's total MRR. They don't move with invoices.</InfoTip>
      </h1>
      <p className="page-sub">Track expansion progress, deals, tasks and revenue by lab, CSM and module.</p>
      <PipelineAnalytics pipeline="expansion" page="expansion" labs={allLabs} viewer={viewer} idByName={idByName} onOpenLab={onOpenLab} kpi={kpi}
        tab={tab} onTab={setTab} extraTabs={[{ key: "deals", label: "Deals & Purchases", render: dealsTab }]} />
    </div>
  );
}
