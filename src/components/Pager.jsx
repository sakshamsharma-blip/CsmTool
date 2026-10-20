import { usePaged } from "../lib/usePaged";

// Wraps any long list: `<Paginated items={rows}>{(pageRows) => <table>…</table>}</Paginated>` renders just
// the current page plus "Showing 26–50 of 112 ‹ Prev  Page 2 of 5  Next ›" underneath (hidden when it all
// fits on one page). Being a component, it can be dropped in below a view's loading/early returns.
export default function Paginated({ items, pageSize = 25, children }) {
  const paged = usePaged(items, pageSize);
  const { page, pages, setPage, total } = paged;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <>
      {children(paged.pageItems)}
      {pages > 1 && (
        <div className="act-pagination">
          <span>Showing {from}–{to} of {total}</span>
          <span className="pbtns">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
            <span style={{ alignSelf: "center" }}>Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
          </span>
        </div>
      )}
    </>
  );
}
