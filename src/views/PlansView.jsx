import { useState } from "react";
import { planIncludesParam } from "../lib/plans";

export default function PlansView({ plans, modules, labs, onToggleModule, onToggleParam }) {
  const [expanded, setExpanded] = useState({});

  function labsOnPlan(planId) {
    return labs.filter((l) => (l.plan || "starter") === planId).length;
  }

  return (
    <div>
      <h1 className="page-title">Plans</h1>
      <p className="page-sub">
        The named bundles Sales actually sells. Each lab is assigned one Plan, which sets its default module scope.
      </p>
      <div className="banner">
        <span className="badge">MASTER ENTITY</span>
        <span>Toggling a module or parameter here changes what this Plan includes going forward — it doesn't rewrite scope already recorded for a specific lab.</span>
      </div>

      {plans.map((plan) => (
        <div key={plan.id} className="side-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>{plan.name}</h3>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{labsOnPlan(plan.id)} lab(s) on this plan</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {modules.map((mod) => {
              const inc = plan.modules.includes(mod.key);
              const expandKey = plan.id + "|" + mod.key;
              const isOpen = inc && expanded[expandKey];
              return (
                <div key={mod.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                  <span
                    className="cat-tag"
                    style={{
                      cursor: "pointer", fontSize: "11.5px", padding: "3px 10px",
                      background: inc ? "#eef2ff" : "#f1f3f6", color: inc ? "#4338ca" : "#8a94a3",
                      textDecoration: inc ? "none" : "line-through",
                    }}
                    onClick={() => onToggleModule(plan.id, mod.key)}
                    title={inc ? "Included by default — click to exclude" : "Not included — click to add"}
                  >
                    {mod.icon} {mod.name}
                  </span>
                  {inc && (
                    <span
                      style={{ fontSize: 11, color: "var(--accent)", cursor: "pointer" }}
                      onClick={() => setExpanded((e) => ({ ...e, [expandKey]: !e[expandKey] }))}
                    >
                      {isOpen ? "▾ params" : "▸ params"}
                    </span>
                  )}
                  {isOpen && (
                    <div style={{ width: "100%", display: "flex", flexWrap: "wrap", gap: 5, margin: "2px 0 6px 20px" }}>
                      {mod.params.map((p) => {
                        const pInc = planIncludesParam(plan, mod.key, p.name);
                        return (
                          <span
                            key={p.name}
                            className="cat-tag"
                            style={{
                              cursor: "pointer", fontSize: "10.5px",
                              background: pInc ? "#eef4ff" : "#f1f3f6", color: pInc ? "#1948a8" : "#8a94a3",
                              textDecoration: pInc ? "none" : "line-through",
                            }}
                            title={pInc ? `Included in ${plan.name} by default — click to exclude` : `Not included — click to add`}
                            onClick={() => onToggleParam(plan.id, mod.key, p.name)}
                          >
                            {p.name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
