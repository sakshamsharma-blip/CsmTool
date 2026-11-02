import { useSessionState } from "../lib/useSessionState";
import { SUPABASE_CONFIGURED } from "../supabaseClient";
import { useKpiData } from "../lib/useKpiData";
import { useScopedCsm } from "../lib/useScopedCsm";
import PipelineAnalytics from "../components/PipelineAnalytics";
import InfoTip from "../components/InfoTip";

// The one Adoption screen (decision Nov 2 2026): Analytics, CSM Performance, Module-wise and the Adoption Template all live
// here as tabs. The Template tab has its own address (#/adoption-template) and renders without waiting for the score data.
export default function AdoptionView({ onTemplate, onNavigate, renderTemplate, labs, modules, plans, viewer, idByName, onOpenLab, onOpenCsm }) {
  const [tab, setTab] = useSessionState("adoption.tab", "analytics");
  const { isHead } = useScopedCsm(viewer, "adoption");
  const kpi = useKpiData({ labs, modules, plans, idByName });

  const selectTab = (key) => {
    if (key === "template") { onNavigate("adoption-template"); return; }
    setTab(key);
    if (onTemplate) onNavigate("adoption");
  };
  const bar = (
    <div className="tabbar">
      {[["analytics", "Analytics"], ...(isHead ? [["csm", "CSM Performance"]] : []), ["modules", "Module-wise"]].map(([k, l]) => (
        <button key={k} className="tabbtn" onClick={() => selectTab(k)}>{l}</button>
      ))}
      <button className={`tabbtn${onTemplate ? " active" : ""}`} onClick={() => selectTab("template")}>Template</button>
    </div>
  );

  if (onTemplate) return <div>{bar}{renderTemplate()}</div>;
  const head = (
    <>
      <h1 className="page-title">Adoption
        <InfoTip>How adoption is progressing across clients, CSMs and modules. Each client counts once: its parent and child labs are averaged. A CSM is scored on the labs they handle. Past periods are worked out from every parameter's change history, using today's template weights, so nothing shows before tracking began.</InfoTip>
      </h1>
      <p className="page-sub">Track adoption progress, trends and performance by lab, CSM and module.</p>
    </>
  );
  if (!SUPABASE_CONFIGURED) return <div>{head}{bar}<div className="table-card" style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Demo mode — Adoption analytics needs a database connected.</div></div>;
  if (kpi.loading) return <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)" }}>Loading adoption…</div>;
  if (kpi.error) return <div className="error-banner">Couldn't load adoption — {kpi.error}</div>;
  return (
    <div>
      {head}
      <PipelineAnalytics pipeline="adoption" page="adoption" labs={labs} viewer={viewer} idByName={idByName} onOpenLab={onOpenLab} onOpenCsm={onOpenCsm} kpi={kpi}
        tab={tab} onTab={selectTab} extraTabs={[{ key: "template", label: "Template" }]} />
    </div>
  );
}
