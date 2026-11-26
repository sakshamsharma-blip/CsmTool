import { useEffect } from "react";

// Resizable columns on EVERY table (decision Nov 26 2026), mounted once in App.jsx next to the pinned headers. Each header
// cell gets a drag handle on its right edge. A table keeps its normal automatic layout until someone drags: then it
// switches to fixed widths (measured from what was on screen), long text is cut with …, and the widths are kept in this
// browser per table (localStorage). Double-click a handle to put that table back to its automatic layout.
// Total Labs has its own React version (useColumnWidths + ColResizer, table.col-sized) and is skipped here, as are
// tables with .no-resize and header rows with merged cells.
const SKIP = "table.col-sized, table.no-resize";
const MIN = 40;
const STORE = "colwidths.auto.";

// A table's identity = the screen (from the address, lab id dropped) + its header texts without sort arrows / counts,
// so the same table finds its widths again after a refresh but two different tables never share them.
function keyOf(table, ths) {
  const parts = (location.hash || "#/list").replace(/^#\/?/, "").split("/");
  const screen = parts[0] === "lab" ? `lab/${parts[2] || "details"}` : parts[0] || "list";
  const heads = ths.map((th) => (th.textContent || "").replace(/[↑↓▾▸⇅]|\(\d+\)|\d+/g, "").trim().toLowerCase()).join("|");
  return `${STORE}${screen}::${heads}`;
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

function applyWidths(table, ths, widths) {
  ths.forEach((th, i) => {
    const w = `${widths[i]}px`;
    th.style.width = w; th.style.minWidth = w; th.style.maxWidth = w;
  });
  table.style.tableLayout = "fixed";
  table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
  table.style.minWidth = "0";
  table.classList.add("col-user-sized");
}
function clearWidths(table, ths) {
  ths.forEach((th) => { th.style.width = ""; th.style.minWidth = ""; th.style.maxWidth = ""; });
  table.style.tableLayout = ""; table.style.width = ""; table.style.minWidth = "";
  table.classList.remove("col-user-sized");
}

function startDrag(e, table, index) {
  e.preventDefault();
  e.stopPropagation();
  const ths = headerCells(table);
  if (!ths) return;
  const widths = ths.map((th) => Math.round(th.getBoundingClientRect().width));
  applyWidths(table, ths, widths);
  const x0 = e.clientX;
  const w0 = widths[index];
  const move = (ev) => { widths[index] = Math.max(MIN, Math.round(w0 + ev.clientX - x0)); applyWidths(table, ths, widths); };
  const stop = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", stop);
    document.body.classList.remove("col-resizing");
    write(keyOf(table, ths), widths);
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
      if (has) { has.dataset.index = String(i); return; }
      const h = document.createElement("span");
      h.className = "col-resizer";
      h.dataset.auto = "1";
      h.dataset.index = String(i);
      h.title = "Drag to resize · double-click to reset this table";
      h.setAttribute("aria-hidden", "true");
      h.addEventListener("mousedown", (e) => startDrag(e, table, Number(h.dataset.index)));
      h.addEventListener("click", (e) => e.stopPropagation()); // don't sort the column
      h.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const cells = headerCells(table);
        if (!cells) return;
        write(keyOf(table, cells), null);
        clearWidths(table, cells);
        table.dataset.colKey = "";
      });
      th.appendChild(h);
    });
    // Saved widths: apply once per table (and again if its columns change).
    const key = keyOf(table, ths);
    if (table.dataset.colKey === key) return;
    table.dataset.colKey = key;
    const saved = read(key);
    if (Array.isArray(saved) && saved.length === ths.length && saved.every((w) => Number(w) > 0)) applyWidths(table, ths, saved.map(Number));
    else if (table.classList.contains("col-user-sized")) clearWidths(table, ths);
  });
}

export function useResizableTables() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; scan(); }); };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("hashchange", schedule);
    schedule();
    return () => { mo.disconnect(); window.removeEventListener("hashchange", schedule); if (frame) cancelAnimationFrame(frame); };
  }, []);
}
