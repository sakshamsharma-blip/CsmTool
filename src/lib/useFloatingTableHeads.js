import { useEffect } from "react";

// Pinned table headers (decision Nov 26 2026). While you scroll through a table, its header row stays at the top of the
// scrolling area; at the table's end it scrolls away with the last row, and the next table's header takes over.
// Plain CSS `position: sticky` can't do this here: most tables sit in a sideways-scrolling .table-scroll box, which
// stops a sticky header at that box. So the header cells are nudged down with a transform instead — one listener for
// the whole app (mounted once in App.jsx), every <table> with a <thead> gets it.
// Tables that already pin their header inside their own scrolling box are skipped, as is anything marked .no-float-head.
const SKIP = ".rep-scroll, .tmpl-list, .no-float-head";

// The nearest ancestor that actually scrolls vertically right now (.content for pages, .drawer-body for side panels).
function scrollerOf(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

function setOffset(thead, off) {
  if ((thead.dataset.float || "0") === String(off)) return;
  thead.dataset.float = String(off);
  thead.classList.toggle("is-floating", off > 0);
  thead.querySelectorAll(":scope > tr > th").forEach((th) => { th.style.transform = off ? `translateY(${off}px)` : ""; });
}

function update() {
  document.querySelectorAll("table > thead").forEach((thead) => {
    const table = thead.parentElement;
    if (table.closest(SKIP)) return;
    const r = table.getBoundingClientRect();
    if (!r.height) return;
    const sc = scrollerOf(table);
    const top = sc ? sc.getBoundingClientRect().top : 0;
    const h = thead.offsetHeight;
    setOffset(thead, Math.round(Math.min(Math.max(top - r.top, 0), Math.max(0, r.height - h))));
  });
}

export function useFloatingTableHeads() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); };
    document.addEventListener("scroll", schedule, true); // capture: scrolls of .content / drawers don't bubble
    window.addEventListener("resize", schedule);
    // Content changes (filters, paging, switching screens) can move a table under a header that is already pinned.
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
