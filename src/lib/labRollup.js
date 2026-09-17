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
