import { useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";
import { roleLabel } from "../lib/roles";

// "Live Now — Module 1": everything actually built and wired to real data. Customer Master
// is a group (Total Labs + Add New Lab), matching the prototype's expandable nav — everything
// else is a flat item. "Planned" below is the prototype's own roadmap list (its "What's Not
// Built Yet" section) — grayed out and inert, same as the prototype left it.
const LIVE_NAV = [
  { key: "dashboard", icon: "📊", label: "Dashboard" },
  { key: "portfolio", icon: "⭐", label: "My Portfolio" },
  {
    key: "customer-master", icon: "☰", label: "Customer Master",
    children: [
      { key: "list", label: "Total Labs" },
      { key: "__add-lab", label: "+ Add New Lab" },
    ],
  },
  { key: "collections", icon: "💰", label: "Collections" },
  { key: "visits", icon: "📅", label: "Visits & Meetings" },
  { key: "adoption-template", icon: "📈", label: "Adoption Template" },
  { key: "plans", icon: "💳", label: "Plans" },
];
// "Manage Users" (the old "CSM Setup") moved to the top bar, matching the reference
// tool — it's Admin/Lead-only, not a regular nav item everyone sees in the sidebar.

const PLANNED_NAV = [
  { icon: "🎫", label: "Support & Tickets" },
  { icon: "🔁", label: "Renewals & Expansion" },
  { icon: "💬", label: "Feedback & NPS" },
  { icon: "📑", label: "Reports" },
  { icon: "🎯", label: "KPI Management" },
  { icon: "⚙️", label: "Automation" },
  { icon: "🛠️", label: "Settings" },
];

function readCollapsed() {
  try { return localStorage.getItem("csm_sidebar_collapsed") === "1"; } catch { return false; }
}
function writeCollapsed(v) {
  try { localStorage.setItem("csm_sidebar_collapsed", v ? "1" : "0"); } catch { /* ignore */ }
}

export default function Sidebar({ view, setView, csmDirectory, currentCSM, setCurrentCSM, myName, onOpenAddDrawer }) {
  const initials = (name) => (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const role = currentCSM ? roleLabel(csmDirectory.find((c) => c.name === currentCSM)?.role) : "";
  // Admin (myName's own real role, not currentCSM's — currentCSM may be swapped away from
  // it below) gets the same "viewing as" switcher demo mode always had, so one person can
  // test the CSM Lead view and the plain-CSM view without needing separate logins.
  const isAdminPreviewing = SUPABASE_CONFIGURED && csmDirectory.find((c) => c.name === myName)?.role === "Admin";

  const [collapsed, setCollapsed] = useState(readCollapsed);
  function toggleCollapsed() {
    setCollapsed((c) => { writeCollapsed(!c); return !c; });
  }

  const [expanded, setExpanded] = useState(() => {
    const init = {};
    LIVE_NAV.forEach((i) => { if (i.children && i.children.some((c) => c.key === view)) init[i.key] = true; });
    return init;
  });

  function handleClick(item) {
    if (item.children) {
      if (collapsed) { setView(item.children[0].key); return; } // no room to show a submenu while collapsed — go straight to its main screen
      setExpanded((e) => ({ ...e, [item.key]: !e[item.key] }));
      return;
    }
    setView(item.key);
  }
  function handleChildClick(child) {
    if (child.key === "__add-lab") { onOpenAddDrawer && onOpenAddDrawer(); return; }
    setView(child.key);
  }

  return (
    <div className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-id">
          <img className="mark" src="/brand/crelio-mark.png" alt="CrelioHealth" />
          <div>
            <div className="name">CrelioHealth</div>
            <div className="sub">CS Console</div>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <div className="nav">
        <div className="nav-group-label">Live Now — Module 1</div>
        {LIVE_NAV.map((item) => (
          <div key={item.key}>
            <div
              className={`nav-item${(view === item.key || (item.children && item.children.some((c) => c.key === view))) ? " active" : ""}`}
              onClick={() => handleClick(item)}
              title={collapsed ? item.label : undefined}
            >
              <span className="ico">{item.icon}</span>
              <span className="lbl">{item.label}</span>
              {item.children && <span className="nav-caret">{expanded[item.key] ? "▾" : "▸"}</span>}
            </div>
            {item.children && expanded[item.key] && !collapsed && (
              <div className="nav-sub">
                {item.children.map((c) => (
                  <div key={c.key} className={`nav-item${view === c.key ? " active" : ""}`} onClick={() => handleChildClick(c)}>
                    <span className="lbl">{c.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="nav-group-label">Planned</div>
        {PLANNED_NAV.map((item) => (
          <div key={item.label} className="nav-item disabled" title={collapsed ? `${item.label} — not built in this tool yet` : "Not built in this tool yet"}>
            <span className="ico">{item.icon}</span>
            <span className="lbl">{item.label}</span>
            <span className="planned-tag">Planned</span>
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <div className="avatar">{initials(currentCSM)}</div>
        <div className="who">
          {!SUPABASE_CONFIGURED || isAdminPreviewing ? (
            <>
              <select
                className="csm-switcher"
                value={currentCSM}
                onChange={(e) => setCurrentCSM(e.target.value)}
                title={SUPABASE_CONFIGURED ? "Admin — previewing as" : "Demo mode — viewing as"}
              >
                {csmDirectory.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <span>{role}{SUPABASE_CONFIGURED ? (currentCSM !== myName ? " (previewing)" : " · you") : " (demo)"}</span>
            </>
          ) : (
            <>
              <span className="who-name" title={currentCSM}>{currentCSM}</span>
              <span>{role}</span>
            </>
          )}
        </div>
        <span
          onClick={() => supabase && supabase.auth.signOut().then(() => location.reload())}
          title="Sign out"
          style={{ cursor: "pointer", color: "var(--text-faint)", fontSize: 11, textDecoration: "underline", flex: "none" }}
        >
          Sign out
        </span>
      </div>
    </div>
  );
}
