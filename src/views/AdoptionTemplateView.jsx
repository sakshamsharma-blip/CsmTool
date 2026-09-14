export default function AdoptionTemplateView({ modules }) {
  return (
    <div>
      <h1 className="page-title">Adoption Template</h1>
      <p className="page-sub">
        The shared catalog every Plan draws from — every module and parameter that exists in the product, its
        weighting, and its Adoption/Expansion category. Which of these a lab actually gets by default is decided
        per-Plan on the Plans screen, not here.
      </p>
      <div className="banner">
        <span className="badge">CATALOG</span>
        <span>Read-only here for now — editing the catalog isn't wired to the database yet.</span>
      </div>

      {modules.map((mod) => (
        <div key={mod.key} className="side-card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{mod.icon} {mod.name}</h3>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Weight {mod.weight}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {mod.params.map((p) => (
              <span key={p.name} className={`cat-tag cat-${p.category}`} title={`${p.type === "M" ? "Mandatory" : "Optional"} · weight ${p.weight}`}>
                {p.name}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
