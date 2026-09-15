import { Fragment, useMemo, useState } from "react";
import { planIncludesModule, planIncludesParam } from "../lib/plans";

// A small clickable pill-switch — used both for "is this module in this plan" (bigger)
// and "is this param included within that module, for this plan" (smaller, and disabled
// when the module itself isn't in the plan — a param can't be included on its own).
function Toggle({ on, onClick, disabled, size, title }) {
  return (
    <span
      className={`mtx-toggle${on ? " on" : ""}${size === "sm" ? " sm" : ""}${disabled ? " disabled" : ""}`}
      onClick={disabled ? undefined : onClick}
      title={title}
      role="button"
      aria-pressed={on}
      aria-disabled={disabled || undefined}
    >
      <span className="knob" />
    </span>
  );
}

export default function PlansView({ plans, modules, labs, onToggleModule, onToggleParam }) {
  const [expanded, setExpanded] = useState({});
  const [query, setQuery] = useState("");

  function labsOnPlan(planId) {
    return labs.filter((l) => (l.plan || "starter") === planId).length;
  }

  const filteredModules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter((m) => m.name.toLowerCase().includes(q));
  }, [modules, query]);

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

      <div className="mtx-toolbar">
        <input
          className="mtx-search"
          placeholder="🔍  Filter modules…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="mtx-legend">Click a toggle to include/exclude · click a module row to see its parameters</span>
      </div>

      <div className="table-scroll">
        <table className="plan-matrix">
          <thead>
            <tr>
              <th className="mtx-corner">Module</th>
              {plans.map((plan) => (
                <th key={plan.id} className="mtx-plan-head">
                  <div className="mtx-plan-name">{plan.name}</div>
                  <div className="mtx-plan-meta">{labsOnPlan(plan.id)} lab(s)</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredModules.map((mod) => {
              const isOpen = !!expanded[mod.key];
              return (
                <Fragment key={mod.key}>
                  <tr className="mtx-row">
                    <td
                      className={`mtx-modcell${isOpen ? " open" : ""}`}
                      onClick={() => setExpanded((e) => ({ ...e, [mod.key]: !e[mod.key] }))}
                    >
                      <span className={`mtx-caret${isOpen ? " open" : ""}`}>▸</span>
                      <span className="mtx-mod-ico">{mod.icon}</span>
                      <span className="mtx-mod-name">{mod.name}</span>
                      <span className="mtx-mod-weight">{mod.weight}%</span>
                    </td>
                    {plans.map((plan) => {
                      const inc = planIncludesModule(plan, mod.key);
                      return (
                        <td key={plan.id} className="mtx-cell">
                          <Toggle
                            on={inc}
                            onClick={() => onToggleModule(plan.id, mod.key)}
                            title={inc ? `Included in ${plan.name} — click to exclude` : `Not in ${plan.name} — click to add`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && (
                    <tr className="mtx-param-row">
                      <td colSpan={plans.length + 1}>
                        <div
                          className="mtx-param-grid"
                          style={{ gridTemplateColumns: `minmax(180px,260px) repeat(${plans.length}, minmax(64px,1fr))` }}
                        >
                          <div className="mtx-param-corner" />
                          {plans.map((plan) => (
                            <div key={plan.id} className="mtx-param-planhead">{plan.name}</div>
                          ))}
                          {mod.params.map((p) => (
                            <Fragment key={p.name}>
                              <div className="mtx-param-name">
                                {p.name}
                                <span className={`ptype ptype-${p.type === "M" ? "m" : "o"}`}>
                                  {p.type === "M" ? "Mandatory" : "Optional"}
                                </span>
                              </div>
                              {plans.map((plan) => {
                                const modIncluded = planIncludesModule(plan, mod.key);
                                const pInc = planIncludesParam(plan, mod.key, p.name);
                                return (
                                  <Toggle
                                    key={plan.id}
                                    size="sm"
                                    on={modIncluded && pInc}
                                    disabled={!modIncluded}
                                    onClick={() => onToggleParam(plan.id, mod.key, p.name)}
                                    title={
                                      !modIncluded
                                        ? `${mod.name} isn't in ${plan.name}`
                                        : pInc
                                        ? `Included in ${plan.name} — click to exclude`
                                        : `Excluded from ${plan.name} — click to include`
                                    }
                                  />
                                );
                              })}
                            </Fragment>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filteredModules.length === 0 && (
              <tr>
                <td colSpan={plans.length + 1} className="mtx-empty">No modules match "{query}".</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
