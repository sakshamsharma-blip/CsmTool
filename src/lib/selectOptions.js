// Options for any "pick a lab" SearchSelect — parents AND children, each tagged with its Lab ID so two labs
// with similar names are still distinguishable, and searchable by name, Lab ID or city.
export function labSelectOptions(labs) {
  return labs.map((l) => ({
    value: l.id,
    label: l.type === "Child" ? `${l.name} (child)` : l.name,
    hint: [l.labCode || l.id, l.city].filter(Boolean).join(" · "),
  }));
}
