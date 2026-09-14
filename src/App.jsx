import { useEffect, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "./supabaseClient";
import { fetchProfiles, upsertProfile, myProfileName } from "./lib/profiles";
import { fetchCatalog } from "./lib/catalog";
import { fetchPlans, setPlanModule, setPlanExcludedParam } from "./lib/plans";
import { fetchLabs, insertLab, updateLabCsm, updateLabPlan } from "./lib/labs";
import { DEMO_MODULES, DEMO_PLANS, DEMO_CSM_DIRECTORY, DEMO_LABS } from "./lib/demoSeed";
import { useToast } from "./hooks/useToast";

import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Toast from "./components/Toast";
import LoginScreen from "./components/LoginScreen";
import AddLabDrawer from "./components/AddLabDrawer";
import LabDetailModal from "./components/LabDetailModal";
import LabsView from "./views/LabsView";
import PlansView from "./views/PlansView";
import AdoptionTemplateView from "./views/AdoptionTemplateView";
import CsmSetupView from "./views/CsmSetupView";

export default function App() {
  const [authChecked, setAuthChecked] = useState(!SUPABASE_CONFIGURED);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);
  const [error, setError] = useState(null);

  const [csmDirectory, setCsmDirectory] = useState(SUPABASE_CONFIGURED ? [] : DEMO_CSM_DIRECTORY);
  const [idByName, setIdByName] = useState({});
  const [modules, setModules] = useState(SUPABASE_CONFIGURED ? [] : DEMO_MODULES);
  const [plans, setPlans] = useState(SUPABASE_CONFIGURED ? [] : DEMO_PLANS);
  const [labs, setLabs] = useState(SUPABASE_CONFIGURED ? [] : DEMO_LABS);

  const [currentCSM, setCurrentCSM] = useState(SUPABASE_CONFIGURED ? "" : DEMO_CSM_DIRECTORY[0].name);
  const [view, setView] = useState("list");
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [openLab, setOpenLab] = useState(null);
  const [toastMsg, showToast] = useToast();

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecked(true);
      if (session) loadAllData(session);
      else setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAllData(activeSession) {
    setLoading(true);
    setError(null);
    try {
      const { directory, idByName: names } = await fetchProfiles();
      setCsmDirectory(directory);
      setIdByName(names);
      const [cat, pl] = await Promise.all([fetchCatalog(), fetchPlans()]);
      setModules(cat);
      setPlans(pl);
      const labData = await fetchLabs(names);
      setLabs(labData);

      let defaultCsm = directory[0]?.name || "";
      const sess = activeSession || session;
      if (sess?.user) {
        try {
          const mine = await myProfileName(sess.user.id);
          if (mine) defaultCsm = mine;
        } catch { /* non-fatal */ }
      }
      setCurrentCSM(defaultCsm);
    } catch (err) {
      console.error("Failed to load data from Supabase:", err);
      setError(err.message || "Unknown error — see browser console.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLoggedIn() {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    loadAllData(session);
  }

  // ---- writes: optimistic local update + best-effort Supabase persist ----
  async function handleAddLab(lab) {
    setLabs((ls) => [...ls, lab]);
    if (SUPABASE_CONFIGURED) {
      try { await insertLab(lab, idByName); }
      catch (err) { console.error(err); showToast(`⚠ ${lab.name} saved locally but NOT to the database — ${err.message}`); }
    }
    showToast(`${lab.name} saved.`);
  }

  async function handleReassignCsm(labId, newCsm) {
    setLabs((ls) => ls.map((l) => (l.id === labId ? { ...l, csm: newCsm } : l)));
    setOpenLab((l) => (l && l.id === labId ? { ...l, csm: newCsm } : l));
    if (SUPABASE_CONFIGURED) {
      try { await updateLabCsm(labId, newCsm, idByName); }
      catch (err) { console.error(err); showToast(`⚠ Reassignment not saved to the database — ${err.message}`); return; }
    }
    showToast("CSM reassigned.");
  }

  async function handleChangePlan(labId, newPlanId) {
    setLabs((ls) => ls.map((l) => (l.id === labId ? { ...l, plan: newPlanId } : l)));
    setOpenLab((l) => (l && l.id === labId ? { ...l, plan: newPlanId } : l));
    if (SUPABASE_CONFIGURED) {
      try { await updateLabPlan(labId, newPlanId); }
      catch (err) { console.error(err); showToast(`⚠ Plan change not saved to the database — ${err.message}`); return; }
    }
    showToast("Plan changed.");
  }

  async function handleToggleModule(planId, moduleKey) {
    let willInclude = false;
    setPlans((ps) => ps.map((p) => {
      if (p.id !== planId) return p;
      const has = p.modules.includes(moduleKey);
      willInclude = !has;
      return { ...p, modules: has ? p.modules.filter((k) => k !== moduleKey) : [...p.modules, moduleKey] };
    }));
    if (SUPABASE_CONFIGURED) {
      try { await setPlanModule(planId, moduleKey, willInclude); }
      catch (err) { console.error(err); showToast(`⚠ Not saved to the database — ${err.message}`); }
    }
  }

  async function handleToggleParam(planId, moduleKey, paramName) {
    let willExclude = false;
    setPlans((ps) => ps.map((p) => {
      if (p.id !== planId) return p;
      const excluded = { ...(p.excludedParams || {}) };
      const list = excluded[moduleKey] ? [...excluded[moduleKey]] : [];
      const idx = list.indexOf(paramName);
      willExclude = idx < 0;
      if (idx >= 0) list.splice(idx, 1); else list.push(paramName);
      excluded[moduleKey] = list;
      return { ...p, excludedParams: excluded };
    }));
    if (SUPABASE_CONFIGURED) {
      try { await setPlanExcludedParam(planId, moduleKey, paramName, willExclude); }
      catch (err) { console.error(err); showToast(`⚠ Not saved to the database — ${err.message}`); }
    }
  }

  async function handleSaveCsm({ id, name, role }) {
    if (SUPABASE_CONFIGURED) {
      const saved = await upsertProfile({ id, name, role });
      setIdByName((m) => ({ ...m, [name]: saved.id }));
    }
    setCsmDirectory((dir) => {
      const existing = id ? dir.find((c) => idByName[c.name] === id) : null;
      if (existing) return dir.map((c) => (c === existing ? { name, role } : c));
      return [...dir, { name, role }];
    });
    showToast(`${name} saved.`);
  }

  const csmNames = csmDirectory.map((c) => c.name);

  if (SUPABASE_CONFIGURED && !authChecked) {
    return <div style={{ padding: 40, fontFamily: "sans-serif", color: "#475467" }}>Loading…</div>;
  }
  if (SUPABASE_CONFIGURED && !session) {
    return <LoginScreen onLoggedIn={handleLoggedIn} />;
  }
  if (loading) {
    return (
      <div style={{ display: "flex", position: "fixed", inset: 0, background: "#f4f6f9", alignItems: "center", justifyContent: "center", color: "#475467", fontSize: 13, fontFamily: "sans-serif" }}>
        Loading your workspace…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: "flex", position: "fixed", inset: 0, background: "#f4f6f9", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#101828", marginBottom: 6 }}>Couldn't load data from the server</div>
          <div style={{ fontSize: "12.5px", color: "#475467", marginBottom: 14 }}>{error}</div>
          <button onClick={() => location.reload()} style={{ border: "none", borderRadius: 7, padding: "9px 16px", fontSize: 13, fontWeight: 600, background: "#2f6feb", color: "#fff", cursor: "pointer" }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar view={view} setView={setView} csmDirectory={csmDirectory} currentCSM={currentCSM} setCurrentCSM={setCurrentCSM} />
      <div className="main">
        <TopBar currentCSM={currentCSM} />
        <div className="content">
          {!SUPABASE_CONFIGURED && (
            <div className="banner">
              <span className="badge">DEMO MODE</span>
              <span>Not connected to a database — see .env.example. Changes here won't be saved.</span>
            </div>
          )}
          {view === "list" && (
            <LabsView labs={labs} csmNames={csmNames} onOpenAddDrawer={() => setAddDrawerOpen(true)} onOpenLab={setOpenLab} />
          )}
          {view === "plans" && (
            <PlansView plans={plans} modules={modules} labs={labs} onToggleModule={handleToggleModule} onToggleParam={handleToggleParam} />
          )}
          {view === "adoption-template" && <AdoptionTemplateView modules={modules} />}
          {view === "csm-setup" && (
            <CsmSetupView csmDirectory={csmDirectory} idByName={idByName} onSaveCsm={handleSaveCsm} />
          )}
        </div>
      </div>

      <AddLabDrawer
        open={addDrawerOpen}
        onClose={() => setAddDrawerOpen(false)}
        onSave={handleAddLab}
        labs={labs}
        csmNames={csmNames}
        plans={plans}
      />
      <LabDetailModal
        lab={openLab}
        onClose={() => setOpenLab(null)}
        csmNames={csmNames}
        plans={plans}
        onReassignCsm={handleReassignCsm}
        onChangePlan={handleChangePlan}
      />
      <Toast message={toastMsg} />
    </div>
  );
}
