export default function TopBar({ currentCSM }) {
  const initials = (name) => (name || "").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="topbar">
      <div className="search">🔍&nbsp; Search by Lab ID, Lab Name, CSM, City...</div>
      <div className="topbar-spacer"></div>
      <div className="who-top" title={currentCSM}>
        <div className="avatar" style={{ width: 26, height: 26, fontSize: "10.5px" }}>{initials(currentCSM)}</div>
      </div>
    </div>
  );
}
