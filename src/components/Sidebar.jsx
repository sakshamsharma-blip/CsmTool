import { useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";

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
  { key: "csm-setup", icon: "👥", label: "CSM Setup" },
];

const PLANNED_NAV = [
  { icon: "🎫", label: "Support & Tickets" },
  { icon: "🔁", label: "Renewals & Expansion" },
  { icon: "💬", label: "Feedback & NPS" },
  { icon: "📑", label: "Reports" },
  { icon: "🎯", label: "KPI Management" },
  { icon: "⚙️", label: "Automation" },
  { icon: "🛠️", label: "Settings" },
];

export default function Sidebar({ view, setView, csmDirectory, currentCSM, setCurrentCSM, onOpenAddDrawer }) {
  const initials = (name) => (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const role = currentCSM ? (csmDirectory.find((c) => c.name === currentCSM)?.role === "Lead" ? "CSM Lead" : "Customer Success Manager") : "";

  const childViewKeys = LIVE_NAV.filter((i) => i.children).flatMap((i) => i.children.map((c) => c.key));
  const [expanded, setExpanded] = useState(() => {
    const init = {};
    LIVE_NAV.forEach((i) => { if (i.children && i.children.some((c) => c.key === view)) init[i.key] = true; });
    return init;
  });

  function handleClick(item) {
    if (item.children) {
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
    <div className="sidebar">
      <div className="brand">
        <div className="mark">CS</div>
        <div>
          <div className="name">CS Tool</div>
          <div className="sub">Customer Success</div>
        </div>
      </div>
      <div className="nav">
        <div className="nav-group-label">Live Now — Module 1</div>
        {LIVE_NAV.map((item) => (
          <div key={item.key}>
            <div
              className={`nav-item${(view === item.key || (item.children && item.children.some((c) => c.key === view))) ? " active" : ""}`}
              onClick={() => handleClick(item)}
            >
              <span className="ico">{item.icon}</span>
              <span className="lbl">{item.label}</span>
              {item.children && <span style={{ flex: "none", fontSize: 10, color: "#8093b0" }}>{expanded[item.key] ? "▾" : "▸"}</span>}
            </div>
            {item.children && expanded[item.key] && (
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
          <div key={item.label} className="nav-item disabled" title="Not built in this tool yet">
            <span className="ico">{item.icon}</span>
            <span className="lbl">{item.label}</span>
            <span className="planned-tag">Planned</span>
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <div className="avatar">{initials(currentCSM)}</div>
        <div className="who">
          {SUPABASE_CONFIGURED ? (
            <>
              <span className="who-name" title={currentCSM}>{currentCSM}</span>
              <span>{role}</span>
            </>
          ) : (
            <>
              <select
                className="csm-switcher"
                value={currentCSM}
                onChange={(e) => setCurrentCSM(e.target.value)}
                title="Demo mode — viewing as"
              >
                {csmDirectory.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <span>{role} (demo)</span>
            </>
          )}
        </div>
        <span
          onClick={() => supabase && supabase.auth.signOut().then(() => location.reload())}
          style={{ cursor: "pointer", color: "#8093b0", fontSize: 11, textDecoration: "underline", flex: "none" }}
        >
          Sign out
        </span>
      </div>
    </div>
  );
}
