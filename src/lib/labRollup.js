// Shared "parent row with rolled-up MRR from its children" helper — the same rollup List/Dashboard/
// Portfolio/Collections all need: a Parent lab's own mrr field is ignored in favor of summing its
// Child labs' mrr, when it has any.
export function computeLabRollup(labs) {
  const parents = labs.filter((l) => l.type === "Parent");
  return parents.map((par) => {
    const children = labs.filter((l) => l.type === "Child" && l.parent === par.id);
    const mrr = children.length ? children.reduce((s, c) => s + (c.mrr || 0), 0) : par.mrr || 0;
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
