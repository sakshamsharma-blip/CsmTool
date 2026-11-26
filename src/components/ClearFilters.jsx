// "Clear filters" — on every filter row (decision Nov 26 2026). Always shown so people know it's there; greyed out and
// inactive while nothing is filtered. `active` = is any filter set; `onClear` resets them (not the sort or My Labs / Team View).
export default function ClearFilters({ active, onClear, label = "Clear filters" }) {
  return (
    <button type="button" className={`clear-filters${active ? "" : " is-idle"}`} disabled={!active} onClick={onClear}
      title={active ? "Reset every filter on this row" : "No filters set"}>
      ✕ {label}
    </button>
  );
}
