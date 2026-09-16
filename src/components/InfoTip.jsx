// Small "ⓘ" hover/focus tooltip for the explainer text that used to sit in a permanent banner
// on-page (e.g. Collections' "HOW THIS WORKS"). Someone running a live demo already knows what
// the feature does — the explanation should be there for whoever needs it later, not taking up
// screen space every time. Keyboard-accessible via :focus-within (see index.css) as well as hover.
export default function InfoTip({ children, label = "More info" }) {
  return (
    <span className="info-tip">
      <span className="info-tip-icon" tabIndex={0} aria-label={label}>i</span>
      <span className="info-tip-content" role="tooltip">{children}</span>
    </span>
  );
}
