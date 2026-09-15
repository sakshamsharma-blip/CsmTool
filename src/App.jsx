import { useEffect, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "./supabaseClient";
import { fetchProfiles, upsertProfile, myProfileName } from "./lib/profiles";
import {
  fetchCatalog, addModule, updateModule, deleteModule,
  addModuleParam, updateModuleParam, deleteModuleParam,
} from "./lib/catalog";
import { fetchPlans, setPlanModule, setPlanExcludedParam } from "./lib/plans";
import { fetchLabs, insertLab, updateLabCsm, updateLabPlan } from "./lib/labs";
import { logActivity } from "./lib/activity";
import { hasLeadAccess } from "./lib/roles";
import { refreshUsdInrRate, onFxRateChange } from "./lib/fx";
import { DEMO_MODULES, DEMO_PLANS, DEMO_CSM_DIRECTORY, DEMO_LABS } from "./lib/demoSeed";
import { useToast } from "./hooks/useToast";

import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Toast from "./components/Toast";
import LoginScreen from "./components/LoginScreen";
import AddLabDrawer from "./components/AddLabDrawer";
import LabDetailView from "./views/LabDetailView";
import LabsView from "./views/LabsView";
import PlansView from "./views/PlansView";
import AdoptionTemplateView from "./views/AdoptionTemplateView";
import CsmSetupView from "./views/CsmSetupView";
import PortfolioView from "./views/PortfolioView";
import DashboardView from "./views/DashboardView";
import CollectionsView from "./views/CollectionsView";
import TasksView from "./views/TasksView";
import VisitsView from "./views/VisitsView";
import LogCheckinView from "./views/LogCheckinView";

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
  // Who's actually signed in — stays fixed even while currentCSM is switched away from it
  // for an Admin's "preview as" (Sidebar). Not used at all in demo mode, where the old
  // switcher already lets anyone pick freely.
  const [myName, setMyName] = useState("");
  const [view, setView] = useState("list");
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  // Set when "+ Add Child Lab" is used from a parent lab's own Child Labs tab — preloads the
  // drawer straight into Child Lab mode with that parent (and its CSM/plan/region/billing
  // defaults) already filled in. Cleared whenever the drawer closes so a later generic
  // "+ Add New Lab" open (Sidebar/Total Labs) starts blank again.
  const [addDrawerPresetParent, setAddDrawerPresetParent] = useState(null);
  const [detailLabId, setDetailLabId] = useState(null);
  const [detailInitialTab, setDetailInitialTab] = useState("details");
  const detailLab = labs.find((l) => l.id === detailLabId) || null;

  // Kick off the live USD→INR rate once per load. Every money display reads the rate directly
  // from fx.js's module-level cache (not React state) so it doesn't need threading through
  // every view as a prop — this just forces one re-render of the whole tree once the live rate
  // actually arrives, so numbers already on screen pick it up instead of staying on the
  // cached/default rate until something else happens to re-render.
  const [, forceFxRerender] = useState(0);
  useEffect(() => {
    const unsub = onFxRateChange(() => forceFxRerender((t) => t + 1));
    refreshUsdInrRate();
    return unsub;
  }, []);

  function openLabDetail(id, tab = "details") {
    setDetailLabId(id);
    setDetailInitialTab(tab);
    setView("lab-detail");
  }
  function openLogCheckin() {
    setView("log-checkin");
  }
  // If an Admin previewing "as" a CSM (or any other state change) drops lead access
  // while Manage Users is open, back out of it rather than showing a blank pane.
  useEffect(() => {
    if (view === "csm-setup" && !hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role)) {
      setView("list");
    }
  }, [view, currentCSM, csmDirectory]);
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
          if (mine) { defaultCsm = mine; setMyName(mine); }
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
      try {
        await insertLab(lab, idByName);
        const csmId = idByName[lab.csm];
        logActivity(lab.id, {
          kind: "Lab Created",
          title: lab.type === "Child" ? "Added as a child lab" : "Parent lab created",
          meta: `${lab.csm} · Lab Hierarchy`,
          csmId,
        }).catch((err) => console.error(err));
      }
      catch (err) { console.error(err); showToast(`⚠ ${lab.name} saved locally but NOT to the database — ${err.message}`); }
    }
    showToast(`${lab.name} saved.`);
  }

  async function handleReassignCsm(labId, newCsm, extraLabIds = []) {
    const ids = [labId, ...extraLabIds];
    setLabs((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, csm: newCsm } : l)));
    if (SUPABASE_CONFIGURED) {
      try { await Promise.all(ids.map((id) => updateLabCsm(id, newCsm, idByName))); }
      catch (err) { console.error(err); showToast(`⚠ Reassignment not saved to the database — ${err.message}`); return; }
    }
    showToast(ids.length > 1 ? `CSM reassigned for ${ids.length} labs.` : "CSM reassigned.");
  }

  async function handleChangePlan(labId, newPlanId, extraLabIds = []) {
    const ids = [labId, ...extraLabIds];
    setLabs((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, plan: newPlanId } : l)));
    if (SUPABASE_CONFIGURED) {
      try { await Promise.all(ids.map((id) => updateLabPlan(id, newPlanId))); }
      catch (err) { console.error(err); showToast(`⚠ Plan change not saved to the database — ${err.message}`); return; }
    }
    showToast(ids.length > 1 ? `Plan changed for ${ids.length} labs.` : "Plan changed.");
  }

  // Called after LabDetailView's Upload Invoice flow saves a Monthly invoice (the write to
  // Supabase already happened inside saveInvoice() in lib/invoices.js) — this just keeps the
  // app's own `labs` state in sync so the lab header and every table showing this lab's MRR
  // update immediately instead of waiting for a full reload.
  function openAddChildLab(parentLab) {
    setAddDrawerPresetParent(parentLab);
    setAddDrawerOpen(true);
  }
  function closeAddDrawer() {
    setAddDrawerOpen(false);
    setAddDrawerPresetParent(null);
  }

  function handleInvoiceMrrUpdate(labId, newMrr) {
    setLabs((ls) => ls.map((l) => (l.id === labId ? { ...l, mrr: newMrr } : l)));
  }

  async function handleToggleModule(planId, moduleKey) {
    // Compute the direction from the current `plans` state up front, synchronously — a
    // setState updater's callback isn't guaranteed to run before the code right after the
    // setPlans(...) call (confirmed: under this app's rendering path it runs later), so
    // mutating a variable from inside the updater and reading it immediately below is
    // unsafe and was sending the *previous* direction to the database.
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const willInclude = !plan.modules.includes(moduleKey);
    setPlans((ps) => ps.map((p) => (p.id === planId
      ? { ...p, modules: willInclude ? [...p.modules, moduleKey] : p.modules.filter((k) => k !== moduleKey) }
      : p)));
    if (SUPABASE_CONFIGURED) {
      try { await setPlanModule(planId, moduleKey, willInclude); }
      catch (err) { console.error(err); showToast(`⚠ Not saved to the database — ${err.message}`); }
    }
  }

  async function handleToggleParam(planId, moduleKey, paramName) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const excludedNow = (plan.excludedParams && plan.excludedParams[moduleKey]) || [];
    const willExclude = !excludedNow.includes(paramName);
    setPlans((ps) => ps.map((p) => {
      if (p.id !== planId) return p;
      const excluded = { ...(p.excludedParams || {}) };
      const list = excluded[moduleKey] ? [...excluded[moduleKey]] : [];
      const idx = list.indexOf(paramName);
      if (idx >= 0) list.splice(idx, 1); else list.push(paramName);
      excluded[moduleKey] = list;
      return { ...p, excludedParams: excluded };
    }));
    if (SUPABASE_CONFIGURED) {
      try { await setPlanExcludedParam(planId, moduleKey, paramName, willExclude); }
      catch (err) { console.error(err); showToast(`⚠ Not saved to the database — ${err.message}`); }
    }
  }

  // ---- Adoption Template (catalog): the Module Builder screen's CRUD for modules and
  // their parameters. Which Plans a module/param belongs to is handled separately by the
  // existing handleToggleModule/handleToggleParam (same functions the Plans screen uses) —
  // the Module Builder's own "Apply Rules" panel just calls those for whichever module is
  // selected, so assigning a brand-new module/param to a Plan is available immediately,
  // right where it was created, with no separate trip to the Plans screen required. ----
  async function handleAddModule({ key, name, icon, weight, description }) {
    const newModule = { key, name, icon, weight, description, params: [] };
    setModules((ms) => [...ms, newModule]);
    if (SUPABASE_CONFIGURED) {
      try { await addModule({ key, name, icon, weight, description }); }
      catch (err) { console.error(err); showToast(`⚠ ${name} saved locally but NOT to the database — ${err.message}`); return; }
    }
    showToast(`${name} module added.`);
  }

  async function handleUpdateModule(key, patch) {
    setModules((ms) => ms.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    if (SUPABASE_CONFIGURED) {
      try { await updateModule(key, patch); }
      catch (err) { console.error(err); showToast(`⚠ Not saved to the database — ${err.message}`); }
    }
  }

  async function handleDeleteModule(key, name) {
    if (SUPABASE_CONFIGURED) {
      try { await deleteModule(key); }
      catch (err) {
        console.error(err);
        showToast(`⚠ Couldn't delete ${name} — ${err.message}`);
        return false;
      }
    }
    setModules((ms) => ms.filter((m) => m.key !== key));
    setPlans((ps) => ps.map((p) => ({ ...p, modules: p.modules.filter((k) => k !== key) })));
    showToast(`${name} module deleted.`);
    return true;
  }

  async function handleAddModuleParam({ moduleKey, name, type, weight, category }) {
    const newParam = { name, type, weight, category };
    setModules((ms) => ms.map((m) => (m.key === moduleKey ? { ...m, params: [...m.params, newParam] } : m)));
    if (SUPABASE_CONFIGURED) {
      try { await addModuleParam({ moduleKey, name, type, weight, category }); }
      catch (err) { console.error(err); showToast(`⚠ ${name} saved locally but NOT to the database — ${err.message}`); return; }
    }
    showToast(`${name} parameter added.`);
  }

  async function handleUpdateModuleParam(moduleKey, name, patch) {
    setModules((ms) => ms.map((m) => {
      if (m.key !== moduleKey) return m;
      return { ...m, params: m.params.map((p) => (p.name === name ? { ...p, ...patch, name: patch.newName || p.name } : p)) };
    }));
    if (SUPABASE_CONFIGURED) {
      try { await updateModuleParam(moduleKey, name, patch); }
      catch (err) { console.error(err); showToast(`⚠ Not saved to the database — ${err.message}`); }
    }
  }

  async function handleDeleteModuleParam(moduleKey, name) {
    if (SUPABASE_CONFIGURED) {
      try { await deleteModuleParam(moduleKey, name); }
      catch (err) { console.error(err); showToast(`⚠ Couldn't delete ${name} — ${err.message}`); return; }
    }
    setModules((ms) => ms.map((m) => (m.key === moduleKey ? { ...m, params: m.params.filter((p) => p.name !== name) } : m)));
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
  // Manage Users (top bar) is Admin/Lead-only — gate the view itself, not just the button,
  // so it can't be reached (e.g. an Admin preview switched away, or stale state) by anyone else.
  const canManageUsers = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);

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
          <button onClick={() => location.reload()} style={{ border: "none", borderRadius: 7, padding: "9px 16px", fontSize: 13, fontWeight: 600, background: "var(--brand)", color: "#fff", cursor: "pointer" }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar view={view} setView={setView} csmDirectory={csmDirectory} currentCSM={currentCSM} setCurrentCSM={setCurrentCSM} myName={myName} onOpenAddDrawer={() => { setAddDrawerPresetParent(null); setAddDrawerOpen(true); }} />
      <div className="main">
        <TopBar currentCSM={currentCSM} csmDirectory={csmDirectory} myName={myName} view={view} setView={setView} showToast={showToast} />
        <div className="content">
          {!SUPABASE_CONFIGURED && (
            <div className="banner">
              <span className="badge">DEMO MODE</span>
              <span>Not connected to a database — see .env.example. Changes here won't be saved.</span>
            </div>
          )}
          {view === "list" && (
            <LabsView labs={labs} csmNames={csmNames} onOpenAddDrawer={() => { setAddDrawerPresetParent(null); setAddDrawerOpen(true); }} onOpenLab={openLabDetail} />
          )}
          {view === "plans" && (
            <PlansView plans={plans} modules={modules} labs={labs} onToggleModule={handleToggleModule} onToggleParam={handleToggleParam} />
          )}
          {view === "adoption-template" && (
            <AdoptionTemplateView
              modules={modules}
              plans={plans}
              onAddModule={handleAddModule}
              onUpdateModule={handleUpdateModule}
              onDeleteModule={handleDeleteModule}
              onAddModuleParam={handleAddModuleParam}
              onUpdateModuleParam={handleUpdateModuleParam}
              onDeleteModuleParam={handleDeleteModuleParam}
              onToggleModule={handleToggleModule}
              onToggleParam={handleToggleParam}
            />
          )}
          {view === "csm-setup" && canManageUsers && (
            <CsmSetupView csmDirectory={csmDirectory} idByName={idByName} onSaveCsm={handleSaveCsm} />
          )}
          {view === "dashboard" && (
            <DashboardView labs={labs} modules={modules} plans={plans} csmDirectory={csmDirectory} currentCSM={currentCSM} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "portfolio" && (
            <PortfolioView labs={labs} modules={modules} plans={plans} csmDirectory={csmDirectory} currentCSM={currentCSM} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "collections" && (
            <CollectionsView labs={labs} csmDirectory={csmDirectory} currentCSM={currentCSM} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "tasks" && (
            <TasksView labs={labs} modules={modules} plans={plans} csmDirectory={csmDirectory} currentCSM={currentCSM} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "visits" && (
            <VisitsView labs={labs} csmDirectory={csmDirectory} currentCSM={currentCSM} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "lab-detail" && detailLab && (
            <LabDetailView
              lab={detailLab}
              labs={labs}
              modules={modules}
              plans={plans}
              csmNames={csmNames}
              currentCSM={currentCSM}
              idByName={idByName}
              initialTab={detailInitialTab}
              onBack={() => setView("list")}
              onOpenLab={openLabDetail}
              onReassignCsm={handleReassignCsm}
              onChangePlan={handleChangePlan}
              onInvoiceMrrUpdate={handleInvoiceMrrUpdate}
              onLogCheckin={openLogCheckin}
              onAddChildLab={openAddChildLab}
              showToast={showToast}
            />
          )}
          {view === "log-checkin" && detailLab && (
            <LogCheckinView
              lab={detailLab}
              modules={modules}
              plans={plans}
              currentCSM={currentCSM}
              idByName={idByName}
              onDone={(tab) => openLabDetail(detailLab.id, tab)}
              showToast={showToast}
            />
          )}
        </div>
      </div>

      <AddLabDrawer
        open={addDrawerOpen}
        onClose={closeAddDrawer}
        onSave={handleAddLab}
        labs={labs}
        csmNames={csmNames}
        plans={plans}
        presetParent={addDrawerPresetParent}
      />
      <Toast message={toastMsg} />
    </div>
  );
}
