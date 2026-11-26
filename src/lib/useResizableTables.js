import { useEffect } from "react";

// Resizable columns on EVERY table (decision Nov 26 2026), mounted once in App.jsx next to the pinned headers. Each header
// cell gets a drag handle on its right edge. A table keeps its normal automatic layout until someone drags: then it
// switches to fixed widths (measured from what was on screen), long text is cut with …, and the widths are kept for that
// person in that browser only (localStorage, keyed by who is signed in — never shared with anyone else). The last column
// has no handle and takes whatever room is left, so the table still fills its card. Double-click a handle to put that
// table back to its automatic layout.
// Total Labs has its own React version (useColumnWidths + ColResizer, table.col-sized) and is skipped here, as are
// tables with .no-resize and header rows with merged cells.
const SKIP = "table.col-sized, table.no-resize";
const MIN = 40;
const STORE = "colwidths.auto.";
let owner = ""; // the signed-in person's profile id (set by the hook)

// A table's identity = the screen (from the address, lab id dropped) + its header texts without sort arrows / counts,
// so the same table finds its widths again after a refresh but two different tables never share them.
function keyOf(table, ths) {
  const parts = (location.hash || "#/list").replace(/^#\/?/, "").split("/");
  const screen = parts[0] === "lab" ? `lab/${parts[2] || "details"}` : parts[0] || "list";
  const heads = ths.map((th) => (th.textContent || "").replace(/[↑↓▾▸⇅]|\(\d+\)|\d+/g, "").trim().toLowerCase()).join("|");
  return `${STORE}${owner}:${screen}::${heads}`;
}
const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
const write = (key, v) => { try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* not remembered */ } };

function headerCells(table) {
  const thead = table.tHead;
  if (!thead || thead.rows.length !== 1) return null;
  const ths = [...thead.rows[0].cells];
  if (ths.length < 2 || ths.some((th) => th.colSpan > 1)) return null;
  return ths;
}

// `widths` are each column's full on-screen width. CSS `width` on a cell excludes its padding and borders, so those come
// off first — otherwise every column grows by its padding and the last ones get squeezed. The last column is left free
// to fill the rest of the card; the table never gets narrower than the columns need (it scrolls sideways instead).
function applyWidths(table, ths, widths) {
  ths.forEach((th, i) => {
    if (i === ths.length - 1) { th.style.width = ""; th.style.minWidth = `${Math.max(0, widths[i] - extraOf(th))}px`; th.style.maxWidth = ""; return; }
    const w = `${Math.max(1, widths[i] - extraOf(th))}px`;
    th.style.width = w; th.style.minWidth = w; th.style.maxWidth = w;
  });
  table.style.tableLayout = "fixed";
  table.style.width = "100%";
  table.style.minWidth = `${widths.reduce((a, b) => a + b, 0)}px`;
  table.classList.add("col-user-sized");
  // Borders in a collapsed table are shared between cells, so the padding / border maths can be a pixel or so off:
  // measure once and correct, so a column ends up exactly as wide as it was dragged (or saved).
  ths.forEach((th, i) => {
    if (i === ths.length - 1) return;
    const diff = widths[i] - th.getBoundingClientRect().width;
    if (Math.abs(diff) >= 0.5) {
      const w = `${Math.max(1, parseFloat(th.style.width) + diff)}px`;
      th.style.width = w; th.style.minWidth = w; th.style.maxWidth = w;
    }
  });
}
function extraOf(th) {
  const cs = getComputedStyle(th);
  return ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((a, k) => a + (parseFloat(cs[k]) || 0), 0);
}
function clearWidths(table, ths) {
  ths.forEach((th) => { th.style.width = ""; th.style.minWidth = ""; th.style.maxWidth = ""; });
  table.style.tableLayout = ""; table.style.width = ""; table.style.minWidth = "";
  table.classList.remove("col-user-sized");
}

// Put a table back to its automatic layout and forget its widths.
function resetTable(table) {
  const cells = headerCells(table);
  if (!cells) return;
  write(keyOf(table, cells), null);
  clearWidths(table, cells);
  delete table.dataset.lastMin;
  table.dataset.colKey = keyOf(table, cells);
}

let lastDown = { el: null, at: 0 };
function startDrag(e, table, index, handle) {
  e.preventDefault();
  e.stopPropagation();
  // Two presses on the same handle in quick succession = double-click: reset this table.
  const now = Date.now();
  if (lastDown.el === handle && now - lastDown.at < 400) { lastDown = { el: null, at: 0 }; resetTable(table); return; }
  lastDown = { el: handle, at: now };
  const ths = headerCells(table);
  if (!ths) return;
  // Nothing changes until the mouse actually moves, so a plain click (or the first half of a double-click) leaves the table alone.
  let widths = null;
  const x0 = e.clientX;
  let w0 = 0;
  const move = (ev) => {
    if (!widths) {
      if (Math.abs(ev.clientX - x0) < 2) return;
      widths = ths.map((th) => th.getBoundingClientRect().width);
      // The last column only fills leftover room; remember the width it needs on its own (from before any resizing)
      // so it shrinks back to that when other columns grow.
      const last = ths.length - 1;
      if (!table.classList.contains("col-user-sized") || !table.dataset.lastMin) table.dataset.lastMin = String(widths[last]);
      widths[last] = Number(table.dataset.lastMin) || widths[last];
      w0 = widths[index];
    }
    widths[index] = Math.max(MIN, w0 + ev.clientX - x0);
    applyWidths(table, ths, widths);
  };
  const stop = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", stop);
    document.body.classList.remove("col-resizing");
    if (!widths) return;
    lastDown = { el: null, at: 0 };
    write(keyOf(table, ths), widths.map((w) => Math.round(w)));
    table.dataset.colKey = keyOf(table, ths);
  };
  document.body.classList.add("col-resizing");
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", stop);
}

function scan() {
  document.querySelectorAll("table").forEach((table) => {
    if (table.matches(SKIP)) return;
    const ths = headerCells(table);
    if (!ths) return;
    ths.forEach((th, i) => {
      th.classList.add("col-resizable");
      const has = th.querySelector(":scope > .col-resizer[data-auto]");
      if (i === ths.length - 1) { has?.remove(); return; } // the last column just fills what's left
      if (has) { has.dataset.index = String(i); return; }
      const h = document.createElement("span");
      h.className = "col-resizer";
      h.dataset.auto = "1";
      h.dataset.index = String(i);
      h.title = "Drag to resize · double-click to reset this table";
      h.setAttribute("aria-hidden", "true");
      h.addEventListener("mousedown", (e) => startDrag(e, table, Number(h.dataset.index), h));
      h.addEventListener("click", (e) => e.stopPropagation()); // don't sort the column
      h.addEventListener("dblclick", (e) => e.stopPropagation()); // handled in startDrag (two quick presses)
      th.appendChild(h);
    });
    // Saved widths: apply once per table (and again if its columns change).
    const key = keyOf(table, ths);
    if (table.dataset.colKey === key) return;
    table.dataset.colKey = key;
    const saved = read(key);
    if (Array.isArray(saved) && saved.length === ths.length && saved.every((w) => Number(w) > 0)) {
      table.dataset.lastMin = String(saved[saved.length - 1]);
      applyWidths(table, ths, saved.map(Number));
    }
    else if (table.classList.contains("col-user-sized")) clearWidths(table, ths);
  });
}

export function useResizableTables(userKey) {
  useEffect(() => {
    owner = userKey || "";
    document.querySelectorAll("table[data-col-key]").forEach((t) => { t.dataset.colKey = ""; }); // re-read for this person
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; scan(); }); };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("hashchange", schedule);
    schedule();
    return () => { mo.disconnect(); window.removeEventListener("hashchange", schedule); if (frame) cancelAnimationFrame(frame); };
  }, [userKey]);
}
