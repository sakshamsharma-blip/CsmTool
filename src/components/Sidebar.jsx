import { supabase } from "../supabaseClient";

const LIVE_NAV = [
  { key: "list", icon: "☰", label: "Customer Master (Total Labs)" },
  { key: "adoption-template", icon: "📈", label: "Adoption Template" },
  { key: "plans", icon: "💳", label: "Plans" },
  { key: "csm-setup", icon: "👥", label: "CSM Setup" },
];
const PLANNED_NAV = [
  "Dashboard", "My Portfolio", "Collections", "Lab History", "Visits & Meetings",
];

export default function Sidebar({ view, setView, csmDirectory, currentCSM, setCurrentCSM }) {
  const initials = (name) => (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const role = currentCSM ? (csmDirectory.find((c) => c.name === currentCSM)?.role === "Lead" ? "CSM Lead" : "Customer Success Manager") : "";

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
        <div className="nav-group-label">Live</div>
        {LIVE_NAV.map((item) => (
          <div
            key={item.key}
            className={`nav-item${view === item.key ? " active" : ""}`}
            onClick={() => setView(item.key)}
          >
            <span className="ico">{item.icon}</span>
            <span className="lbl">{item.label}</span>
            <span className="live-tag">Live</span>
          </div>
        ))}
        <div className="nav-group-label">Coming next</div>
        {PLANNED_NAV.map((label) => (
          <div key={label} className="nav-item disabled" title="Not wired to the database yet">
            <span className="ico">•</span>
            <span className="lbl">{label}</span>
            <span className="planned-tag">Planned</span>
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <div className="avatar">{initials(currentCSM)}</div>
        <div className="who">
          <select
            className="csm-switcher"
            value={currentCSM}
            onChange={(e) => setCurrentCSM(e.target.value)}
            title="Viewing as"
          >
            {csmDirectory.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <span>{role}</span>
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
