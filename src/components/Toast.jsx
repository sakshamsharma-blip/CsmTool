export default function Toast({ message }) {
  return (
    <div className={`toast${message ? " show" : ""}`}>
      <span className="ok-ico">✓</span>
      <span>{message}</span>
    </div>
  );
}
