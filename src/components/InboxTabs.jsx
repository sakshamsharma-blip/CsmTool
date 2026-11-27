// The four inboxes (decision Nov 27 2026): Check-ins & Visits, Adoption, Expansion, Account. Each is its own screen
// (#/inbox, #/inbox-adoption, …) and its own sidebar sub-item; these tabs switch between them on the page too.
const INBOX_VIEWS = [
  ["inbox", "checkins", "Check-ins & Visits"],
  ["inbox-adoption", "adoption", "Adoption"],
  ["inbox-expansion", "expansion", "Expansion"],
  ["inbox-account", "account", "Account"],
];

export default function InboxTabs({ view, counts = {}, onNavigate }) {
  return (
    <div className="tabs" style={{ width: "fit-content" }} role="tablist" aria-label="Inboxes">
      {INBOX_VIEWS.map(([key, countKey, label]) => (
        <button key={key} type="button" role="tab" aria-selected={view === key} className={`tab-btn${view === key ? " active" : ""}`} onClick={() => onNavigate(key)}>
          {label}{counts[countKey] ? <span className="ib-tab-count">{counts[countKey] > 99 ? "99+" : counts[countKey]}</span> : null}
        </button>
      ))}
    </div>
  );
}
