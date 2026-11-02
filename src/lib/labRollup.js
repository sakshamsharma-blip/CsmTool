import { toINR } from "./format";

// Shared "parent row with rolled-up MRR from its children" helper — the same rollup List/Dashboard/
// Portfolio/Collections all need.
//
// How a parent-with-children's MRR rolls up depends on its Billing Mode:
//  - "Consolidated" — the group gets a single invoice covering every branch, so the parent's own
//    mrr field IS the group's real MRR. Children exist for org structure/reporting only; their
//    individual mrr values (if any) are NOT part of the billed total.
//  - "Per-Branch" (the default when billingMode is unset, matching this app's original/only
//    behavior before this feature existed) — each child is billed separately, so the parent's own
//    mrr field is ignored in favor of summing its children's.
// A childless parent is always just its own mrr, regardless of mode — Billing Mode only matters
// once there's more than one lab in the group to reconcile.
export function computeLabRollup(labs) {
  const parents = labs.filter((l) => l.type === "Parent");
  return parents.map((par) => {
    const children = labs.filter((l) => l.type === "Child" && l.parent === par.id);
    const mrr = !children.length
      ? par.mrr || 0
      : par.billingMode === "Consolidated"
        ? par.mrr || 0
        : children.reduce((s, c) => s + (c.mrr || 0), 0);
    return { ...par, mrr, children };
  });
}

// Flattens rollup rows (parents + their children) into one list — used wherever a view needs every
// individual lab rather than parent-grouped rows (e.g. Collections, Dashboard's Collections chart).
export function flattenRollup(rows) {
  const flat = [];
  rows.forEach((r) => {
    flat.push(r);
    r.children.forEach((c) => flat.push(c));
  });
  return flat;
}

// One entry per client for the screens that score by client (decision Nov 2 2026): a parent with its child labs. Given a
// CSM, a client's labs are narrowed to that CSM's own, so a CSM is scored on the labs they handle. A child whose parent
// isn't visible (RLS, or another CSM's parent) stands as its own client. `mrrINR` follows the Billing Mode rule above.
export function clientGroups(labs, csm) {
  const seen = new Set(labs.map((l) => l.id));
  const out = [];
  labs.filter((l) => l.type !== "Child" || !seen.has(l.parent)).forEach((top) => {
    const kids = top.type === "Child" ? [] : labs.filter((l) => l.type === "Child" && l.parent === top.id);
    const members = [top, ...kids].filter((l) => !csm || l.csm === csm);
    if (!members.length) return;
    out.push({ id: top.id, name: top.name, top, labs: members, csm: csm || top.csm, mrrINR: countedMrrINR(top, members, kids.length > 0) });
  });
  return out;
}

function countedMrrINR(top, members, hasChildren) {
  const own = (l) => toINR(l.mrr || 0, l.region);
  if (!hasChildren) return members.reduce((s, l) => s + own(l), 0);
  if (top.billingMode === "Consolidated") return members.includes(top) ? own(top) : 0;
  return members.filter((l) => l !== top).reduce((s, l) => s + own(l), 0);
}
