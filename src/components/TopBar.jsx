import { hasLeadAccess } from "../lib/roles";

export default function TopBar({ currentCSM, csmDirectory, view, setView }) {
  const initials = (name) => (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const canManageUsers = hasLeadAccess(csmDirectory.find((c) => c.name === currentCSM)?.role);
  return (
    <div className="topbar">
      <div className="search">🔍&nbsp; Search by Lab ID, Lab Name, CSM, City...</div>
      <div className="topbar-spacer"></div>
      {canManageUsers && (
        <button
          type="button"
          className={`btn btn-ghost topbar-manage-users${view === "csm-setup" ? " active" : ""}`}
          onClick={() => setView("csm-setup")}
        >
          👥 Manage Users
        </button>
      )}
      <div className="who-top" title={currentCSM}>
        <div className="avatar" style={{ width: 26, height: 26, fontSize: "10.5px" }}>{initials(currentCSM)}</div>
      </div>
    </div>
  );
}
