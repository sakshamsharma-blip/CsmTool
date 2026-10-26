// Standard body for a tooltip: a coloured key + title, then label/value rows, then an optional list.
export function TipCard({ color, title, rows = [], list, listTitle, more }) {
  return (
    <div>
      <div className="chart-tip-title">{color && <span className="chart-tip-key" style={{ background: color }} />}{title}</div>
      {rows.map(([k, v]) => <div key={k} className="chart-tip-row"><span>{k}</span><b>{v}</b></div>)}
      {list && list.length > 0 && (
        <div className="chart-tip-list">
          {listTitle && <div className="chart-tip-sub">{listTitle}</div>}
          {list.map((x, i) => <div key={i}>{x}</div>)}
          {more > 0 && <div className="chart-tip-more">+ {more} more</div>}
        </div>
      )}
    </div>
  );
}
