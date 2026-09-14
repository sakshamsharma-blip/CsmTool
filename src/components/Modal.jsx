export default function Modal({ open, title, children, actions, onClose }) {
  return (
    <>
      <div className={`modal-backdrop${open ? " show" : ""}`} onClick={onClose} />
      <div className={`modal-box${open ? " show" : ""}`}>
        <h3>{title}</h3>
        <div>{children}</div>
        <div className="modal-actions">
          {actions?.map((a, i) => (
            <button key={i} className={`btn ${a.className || "btn-ghost"}`} onClick={a.onClick} disabled={!!a.disabled}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
