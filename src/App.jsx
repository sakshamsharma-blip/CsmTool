import { useEffect, useMemo, useState } from "react";
import { useNewTaskCount } from "./lib/taskNotifications";
import { supabase, SUPABASE_CONFIGURED } from "./supabaseClient";
import { fetchProfiles, upsertProfile, myProfileName } from "./lib/profiles";
import {
  fetchCatalog, addModule, updateModule, deleteModule, reorderModules, reorderModuleParams,
  addModuleParam, updateModuleParam, deleteModuleParam,
} from "./lib/catalog";
import { fetchPlans, setPlanModule, setPlanExcludedParam } from "./lib/plans";
import { fetchLabs, insertLab, updateLabCsm, updateLabPlan, updateLabBillingMode } from "./lib/labs";
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
import AdoptionTemplateView from "./views/AdoptionTemplateView";
import CsmSetupView from "./views/CsmSetupView";
import PortfolioView from "./views/PortfolioView";
import DashboardView from "./views/DashboardView";
import CollectionsView from "./views/CollectionsView";
import ExpansionView from "./views/ExpansionView";
import TasksView from "./views/TasksView";
import ReportsView from "./views/ReportsView";
import VisitsView from "./views/VisitsView";
import FeedbackView from "./views/FeedbackView";
import ResourcesView from "./views/ResourcesView";
import LogCheckinView from "./views/LogCheckinView";
import PasswordRecoveryScreen from "./components/PasswordRecoveryScreen";

export default function App() {
  const [authChecked, setAuthChecked] = useState(!SUPABASE_CONFIGURED);
  const [session, setSession] = useState(null);
  // Set the moment someone lands back in the app from a "reset/forgot password" email link —
  // see the auth listener below and PasswordRecoveryScreen for why this has to gate the whole
  // app rather than just quietly signing them in on their old/temp password.
  const [recoveryMode, setRecoveryMode] = useState(false);
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
  // The top bar's search box is a shortcut into Total Labs' own search, not a separate
  // engine — typing here just jumps to the list view and seeds its filter with the same text.
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  function handleGlobalSearch(q) {
    setGlobalSearchQuery(q);
    if (q.trim()) navigate("list");
  }
  // Clicking "Total Labs" in the sidebar should always show the lab list itself, never a leftover search
  // (or text a browser autofilled into the top bar) — so it starts from an empty query. Typing in the
  // top bar and pressing Enter still goes straight to the list with that text, via navigate() directly.
  function navigateFromSidebar(nextView, extra) {
    if (nextView === "list") setGlobalSearchQuery("");
    navigate(nextView, extra);
  }

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

  // Every top-level screen switch (Sidebar/TopBar nav, opening a lab, Log Check-in, "Back")
  // goes through this instead of calling setView directly, so it also pushes a browser history
  // entry. Without it the app has a single history entry total, so the very first Back press
  // leaves the whole SPA (back to whatever tab/page was open before it) instead of going to the
  // screen the person was just on — see the popstate listener below for the other half of this.
  function navigate(nextView, extra = {}) {
    const nextDetailLabId = "detailLabId" in extra ? extra.detailLabId : null;
    const nextDetailInitialTab = extra.detailInitialTab || "details";
    setView(nextView);
    setDetailLabId(nextDetailLabId);
    setDetailInitialTab(nextDetailInitialTab);
    window.history.pushState({ view: nextView, detailLabId: nextDetailLabId, detailInitialTab: nextDetailInitialTab }, "");
  }
  useEffect(() => {
    window.history.replaceState({ view: "list", detailLabId: null, detailInitialTab: "details" }, "");
    function onPopState(e) {
      const state = e.state || { view: "list", detailLabId: null, detailInitialTab: "details" };
      setView(state.view || "list");
      setDetailLabId(state.detailLabId ?? null);
      setDetailInitialTab(state.detailInitialTab || "details");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function openLabDetail(id, tab = "details") {
    navigate("lab-detail", { detailLabId: id, detailInitialTab: tab });
  }
  function openLogCheckin() {
    navigate("log-checkin", { detailLabId: detailLabId, detailInitialTab: detailInitialTab });
  }
  // Single source of truth for "who's viewing, and with what access" — currentCSM (whose POV is
  // showing, which an Admin can swap via Sidebar's Preview As), myName (who's actually signed
  // in, fixed) and csmDirectory (the roster, needed to look either of those up) used to each get
  // threaded down as their own prop through nearly every view; they're bundled here instead so a
  // view takes one `viewer` prop and reads viewer.currentCSM / viewer.isHead / etc. off it. Note
  // isHead (and isAdmin) are UI-only convenience flags, same caveat as hasLeadAccess itself —
  // see the comment on hasLeadAccess in lib/roles.js for the real (database-level) boundary.
  const viewer = useMemo(() => {
    const role = csmDirectory.find((c) => c.name === currentCSM)?.role;
    return {
      currentCSM,
      myName,
      csmDirectory,
      role,
      isHead: hasLeadAccess(role),
      isAdmin: csmDirectory.find((c) => c.name === myName)?.role === "Admin",
    };
  }, [currentCSM, myName, csmDirectory]);

  // If an Admin previewing "as" a CSM (or any other state change) drops lead access
  // while Manage Users is open, back out of it rather than showing a blank pane.
  useEffect(() => {
    if (view === "csm-setup" && !viewer.isHead) {
      setView("list");
    }
  }, [view, viewer]);
  const [toastMsg, showToast] = useToast();

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecked(true);
      if (session) loadAllData(session);
      else setLoading(false);
    });

    // Fires PASSWORD_RECOVERY the moment someone lands here from a reset-password email link
    // (Supabase's redirect establishes a real session for them as part of how that link works) —
    // catch it here so recoveryMode can gate the whole app on PasswordRecoveryScreen instead of
    // silently dropping them into the workspace on their old/temp password.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      // Login expired / refresh failed / signed out in another tab: go back to the sign-in screen rather than
      // leaving a workspace on screen whose every save would fail. Refreshed tokens just update the session.
      if (event === "SIGNED_OUT") { setSession(null); setRecoveryMode(false); }
      if (event === "TOKEN_REFRESHED" && newSession) setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
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
    // Not a real column on the child row — AddLabDrawer sets this the moment a previously
    // childless parent gets its first child, since that's when Billing Mode first matters.
    const { setParentBillingMode, ...rest } = lab;
    // labCode starts equal to id (see insertLab) — set it locally too so the new row behaves exactly
    // like one loaded from the database (search, duplicate-ID checks) without a reload.
    const labFields = { ...rest, labCode: rest.labCode || rest.id };
    const prevParentMode = setParentBillingMode ? labs.find((l) => l.id === lab.parent)?.billingMode ?? null : null;
    setLabs((ls) => {
      const next = [...ls, labFields];
      return setParentBillingMode ? next.map((l) => (l.id === lab.parent ? { ...l, billingMode: setParentBillingMode } : l)) : next;
    });
    if (SUPABASE_CONFIGURED) {
      try {
        await insertLab(labFields, idByName);
      } catch (err) {
        // Previously the lab stayed on screen (and a "saved" toast immediately replaced this warning)
        // even though the database rejected it — it then vanished on the next reload. Undo just this add.
        console.error(err);
        setLabs((ls) => ls
          .filter((l) => l.id !== labFields.id)
          .map((l) => (setParentBillingMode && l.id === lab.parent ? { ...l, billingMode: prevParentMode } : l)));
        showToast(`⚠ ${lab.name} was NOT saved — ${err.message}`);
        return;
      }
      if (setParentBillingMode) {
        try { await updateLabBillingMode(lab.parent, setParentBillingMode); }
        catch (err) {
          // The lab itself is saved; only the parent's Billing Mode didn't stick — undo that part alone.
          console.error(err);
          setLabs((ls) => ls.map((l) => (l.id === lab.parent ? { ...l, billingMode: prevParentMode } : l)));
          showToast(`⚠ ${lab.name} saved, but the parent's Billing Mode wasn't — set it from the parent's Child Labs tab. (${err.message})`);
          return;
        }
      }
      const csmId = idByName[lab.csm];
      logActivity(lab.id, {
        kind: "Lab Created",
        title: lab.type === "Child" ? "Added as a child lab" : "Parent lab created",
        meta: `${lab.csm} · Lab Hierarchy`,
        csmId,
      }).catch((err) => console.error(err));
    }
    showToast(`${lab.name} saved.`);
  }

  async function handleReassignCsm(labId, newCsm, extraLabIds = []) {
    const ids = [labId, ...extraLabIds];
    const before = Object.fromEntries(labs.filter((l) => ids.includes(l.id)).map((l) => [l.id, l.csm]));
    setLabs((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, csm: newCsm } : l)));
    if (SUPABASE_CONFIGURED) {
      try { await Promise.all(ids.map((id) => updateLabCsm(id, newCsm, idByName))); }
      catch (err) {
        console.error(err);
        setLabs((ls) => ls.map((l) => (l.id in before ? { ...l, csm: before[l.id] } : l)));
        showToast(`⚠ Reassignment not saved to the database — ${err.message}`);
        return;
      }
    }
    showToast(ids.length > 1 ? `CSM reassigned for ${ids.length} labs.` : "CSM reassigned.");
  }

  async function handleChangePlan(labId, newPlanId, extraLabIds = []) {
    const ids = [labId, ...extraLabIds];
    const before = Object.fromEntries(labs.filter((l) => ids.includes(l.id)).map((l) => [l.id, l.plan]));
    setLabs((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, plan: newPlanId } : l)));
    if (SUPABASE_CONFIGURED) {
      try { await Promise.all(ids.map((id) => updateLabPlan(id, newPlanId))); }
      catch (err) {
        console.error(err);
        setLabs((ls) => ls.map((l) => (l.id in before ? { ...l, plan: before[l.id] } : l)));
        showToast(`⚠ Plan change not saved to the database — ${err.message}`);
        return;
      }
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

  // Generic local-state patch after a write that touches fields on `labs` directly (status,
  // stage tags, health/rating, testimonial) — mirrors handleInvoiceMrrUpdate's pattern so
  // Lab Detail stays in sync without a full labs refetch.
  function handlePatchLab(labId, patch) {
    setLabs((ls) => ls.map((l) => (l.id === labId ? { ...l, ...patch } : l)));
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
  // their parameters. Which Plans a module/param belongs to by default is set right here too —
  // the Module Builder's own "Apply Rules" panel calls handleToggleModule/handleToggleParam for
  // whichever module is selected, so assigning a brand-new module/param to a Plan is available
  // immediately, right where it was created. There's no standalone Plans management screen —
  // Plans only surface as a starting template when creating a lab (AddLabDrawer) and as a label
  // for reporting; every lab's actual scope is fully editable on its own Adoption tab. ----
  // A new module joins EVERY Plan (decision Oct 2026), so its Adoption-category parameters default to "In plan" for
  // every lab. A Lead / Admin can untick a Plan afterwards in the Module Builder's "Apply Rules".
  async function handleAddModule({ key, name, icon, weight, description }) {
    const newModule = { key, name, icon, weight, description, params: [] };
    setModules((ms) => [...ms, newModule]);
    setPlans((ps) => ps.map((p) => (p.modules.includes(key) ? p : { ...p, modules: [...p.modules, key] })));
    if (SUPABASE_CONFIGURED) {
      try { await addModule({ key, name, icon, weight, description, sortOrder: modules.length + 1 }); }
      catch (err) { console.error(err); showToast(`⚠ ${name} saved locally but NOT to the database — ${err.message}`); return; }
      try { await Promise.all(plans.map((p) => setPlanModule(p.id, key, true))); }
      catch (err) { console.error(err); showToast(`⚠ ${name} added, but not every Plan was saved — tick them in Apply Rules. ${err.message}`); return; }
    }
    showToast(`${name} module added to every Plan — untick any in Apply Rules.`);
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
        showToast(`⚠ Couldn't delete ${name} — ${/collections_items_module_key_fkey/.test(err.message || "") ? "Collections entries still point at it; run migration 0038, which lets the module go while keeping those entries." : err.message}`);
        return false;
      }
    }
    setModules((ms) => ms.filter((m) => m.key !== key));
    setPlans((ps) => ps.map((p) => ({ ...p, modules: p.modules.filter((k) => k !== key) })));
    showToast(`${name} module deleted.`);
    return true;
  }

  async function handleAddModuleParam({ moduleKey, name, type, weight, category, description }) {
    const newParam = { name, type, weight, category, description: description || "" };
    setModules((ms) => ms.map((m) => (m.key === moduleKey ? { ...m, params: [...m.params, newParam] } : m)));
    if (SUPABASE_CONFIGURED) {
      try { await addModuleParam({ moduleKey, name, type, weight, category, description }); }
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

  // Module Builder drag/▲▼: reorder locally at once, then save; roll back if the save fails.
  async function handleReorderModules(keysInOrder) {
    const before = modules;
    const byKey = Object.fromEntries(modules.map((m) => [m.key, m]));
    setModules(keysInOrder.map((k) => byKey[k]).filter(Boolean));
    if (SUPABASE_CONFIGURED) {
      try { await reorderModules(keysInOrder); }
      catch (err) { console.error(err); setModules(before); showToast(`⚠ New order not saved — ${err.message}`); }
    }
  }

  // Module Builder: a module's parameter order (saved with Save Changes).
  async function handleReorderModuleParams(moduleKey, namesInOrder) {
    setModules((ms) => ms.map((m) => {
      if (m.key !== moduleKey) return m;
      const byName = Object.fromEntries(m.params.map((p) => [p.name, p]));
      const ordered = namesInOrder.map((n) => byName[n]).filter(Boolean);
      return { ...m, params: [...ordered, ...m.params.filter((p) => !namesInOrder.includes(p.name))] };
    }));
    if (SUPABASE_CONFIGURED) {
      try { await reorderModuleParams(moduleKey, namesInOrder); }
      catch (err) { console.error(err); showToast(`⚠ Parameter order not saved — ${/sort_order/.test(err.message || "") ? "run migration 0038 first" : err.message}`); }
    }
  }

  async function handleDeleteModuleParam(moduleKey, name) {
    if (SUPABASE_CONFIGURED) {
      try { await deleteModuleParam(moduleKey, name); }
      catch (err) { console.error(err); showToast(`⚠ Couldn't delete ${name} — ${err.message}`); return; }
    }
    setModules((ms) => ms.map((m) => (m.key === moduleKey ? { ...m, params: m.params.filter((p) => p.name !== name) } : m)));
  }

  // The app keys people by name (labs.csm, tasks.owner, idByName), so two people can't share a name,
  // and a rename has to be carried through to every lab that shows the old name.
  async function handleSaveCsm({ id, name, role, active }) {
    const existing = id ? csmDirectory.find((c) => idByName[c.name] === id) : null;
    const clash = csmDirectory.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase() && c !== existing);
    if (clash) throw new Error(`There is already a team member called "${clash.name}" — use a different name.`);
    const oldName = existing ? existing.name : null;
    let savedId = id;
    if (SUPABASE_CONFIGURED) {
      const saved = await upsertProfile({ id, name, role, active });
      savedId = saved.id;
    }
    setIdByName((m) => {
      const next = { ...m };
      if (oldName && oldName !== name) delete next[oldName];
      if (savedId) next[name] = savedId;
      return next;
    });
    if (oldName && oldName !== name) {
      setLabs((ls) => ls.map((l) => (l.csm === oldName ? { ...l, csm: name } : l)));
      if (currentCSM === oldName) setCurrentCSM(name);
      if (myName === oldName) setMyName(name);
    }
    setCsmDirectory((dir) => {
      if (existing) return dir.map((c) => (c === existing ? { ...c, name, role, active } : c));
      return [...dir, { id: savedId, name, role, active: active !== false, linked: false }];
    });
    showToast(`${name} saved.`);
  }

  const csmNames = csmDirectory.map((c) => c.name);
  // Assignment contexts (new lab, reassign) only offer people still on the team — team-view
  // filters elsewhere keep using csmNames so a departed CSM's past labs stay filterable.
  const activeCsmNames = csmDirectory.filter((c) => c.active !== false).map((c) => c.name);
  // Manage Users (top bar) is Admin/Lead-only — gate the view itself, not just the button,
  // so it can't be reached (e.g. an Admin preview switched away, or stale state) by anyone else.
  const canManageUsers = viewer.isHead;

  // Unread "new tasks" count for the sidebar (the signed-in person's own tasks; cleared by opening Tasks).
  const newTaskCount = useNewTaskCount(idByName[myName], view === "tasks");

  if (SUPABASE_CONFIGURED && !authChecked) {
    return <div style={{ padding: 40, fontFamily: "sans-serif", color: "var(--text-dim)" }}>Loading…</div>;
  }
  // Takes priority over the plain "not signed in" check below — a recovery-link visit does
  // establish a session, but they still need to set a new password before anything else.
  if (SUPABASE_CONFIGURED && recoveryMode) {
    return <PasswordRecoveryScreen onDone={() => setRecoveryMode(false)} />;
  }
  if (SUPABASE_CONFIGURED && !session) {
    return <LoginScreen onLoggedIn={handleLoggedIn} />;
  }
  if (loading) {
    return (
      <div style={{ display: "flex", position: "fixed", inset: 0, background: "var(--bg)", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13, fontFamily: "inherit" }}>
        Loading your workspace…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: "flex", position: "fixed", inset: 0, background: "var(--bg)", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 6 }}>Couldn't load data from the server</div>
          <div style={{ fontSize: "12.5px", color: "var(--text-dim)", marginBottom: 14 }}>{error}</div>
          <button className="btn btn-primary" onClick={() => location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar view={view} setView={navigateFromSidebar} viewer={viewer} newTaskCount={newTaskCount} setCurrentCSM={setCurrentCSM} onOpenAddDrawer={() => { setAddDrawerPresetParent(null); setAddDrawerOpen(true); }} />
      <div className="main">
        <TopBar viewer={viewer} setView={navigate} showToast={showToast} searchQuery={globalSearchQuery} onSearchChange={handleGlobalSearch} />
        <div className="content">
          {!SUPABASE_CONFIGURED && (
            <div className="banner">
              <span className="badge">DEMO MODE</span>
              <span>Not connected to a database — see .env.example. Changes here won't be saved.</span>
            </div>
          )}
          {view === "list" && (
            <LabsView labs={labs} csmNames={csmNames} viewer={viewer} onOpenAddDrawer={() => { setAddDrawerPresetParent(null); setAddDrawerOpen(true); }} onOpenLab={openLabDetail} initialQuery={globalSearchQuery} />
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
              onReorderModules={handleReorderModules}
              onReorderModuleParams={handleReorderModuleParams}
              canEdit={viewer.isHead}
              myProfileId={idByName[myName]}
              isHead={viewer.isHead}
              showToast={showToast}
            />
          )}
          {view === "csm-setup" && canManageUsers && (
            <CsmSetupView csmDirectory={csmDirectory} idByName={idByName} onSaveCsm={handleSaveCsm} canChangeRole={!SUPABASE_CONFIGURED || viewer.isAdmin} />
          )}
          {view === "dashboard" && (
            <DashboardView labs={labs} modules={modules} plans={plans} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "portfolio" && (
            <PortfolioView labs={labs} modules={modules} plans={plans} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} onPatchLab={handlePatchLab} showToast={showToast} />
          )}
          {view === "collections" && (
            <CollectionsView labs={labs} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "expansion" && (
            <ExpansionView labs={labs} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "tasks" && (
            <TasksView labs={labs} modules={modules} plans={plans} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} onPatchLab={handlePatchLab} showToast={showToast} />
          )}
          {view === "visits" && (
            <VisitsView labs={labs} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "feedback" && (
            <FeedbackView labs={labs} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "resources" && (
            <ResourcesView modules={modules} myProfileId={idByName[myName]} isHead={viewer.isHead} showToast={showToast} />
          )}
          {view === "reports" && (
            <ReportsView labs={labs} viewer={viewer} idByName={idByName} onOpenLab={openLabDetail} showToast={showToast} />
          )}
          {view === "lab-detail" && detailLab && (
            <LabDetailView
              lab={detailLab}
              labs={labs}
              modules={modules}
              plans={plans}
              csmNames={activeCsmNames}
              viewer={viewer}
              idByName={idByName}
              initialTab={detailInitialTab}
              onBack={() => navigate("list")}
              onOpenLab={openLabDetail}
              onReassignCsm={handleReassignCsm}
              onChangePlan={handleChangePlan}
              onInvoiceMrrUpdate={handleInvoiceMrrUpdate}
              onPatchLab={handlePatchLab}
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
              viewer={viewer}
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
        csmNames={activeCsmNames}
        plans={plans}
        presetParent={addDrawerPresetParent}
      />
      <Toast message={toastMsg} />
    </div>
  );
}
