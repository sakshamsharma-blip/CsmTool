// The drag handle on a table header's right edge (lib/useColumnWidths.js). Drag to resize the column; double-click puts
// it back to its default width. Put it inside a <th> that has position: relative (the .col-resizable class does that).
export default function ColResizer({ width, onResize }) {
  function start(e) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const move = (ev) => onResize(width + ev.clientX - x0);
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.classList.remove("col-resizing");
    };
    document.body.classList.add("col-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }
  return (
    <span className="col-resizer" onMouseDown={start} onDoubleClick={(e) => { e.stopPropagation(); onResize(null); }}
      onClick={(e) => e.stopPropagation()} title="Drag to resize · double-click to reset" aria-hidden="true" />
  );
}
