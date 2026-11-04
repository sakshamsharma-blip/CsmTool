import { supabase } from "../supabaseClient";
import { toINR } from "./format";
import { todayISO, toLocalISODate } from "./dates";
import { isRecurring } from "./tasks";
import { pocMonthStatus } from "./labContacts";
import { monthsIn } from "./periods";

// KPI Management (decision Nov 2 2026). Six KPIs, each a % for a period:
//   Adoption / Expansion — average Adoption / Expansion pipeline score of the clients at the period's end.
//   POC Check-in — Proactive check-ins done ÷ owed, from each POC's monthly minimum (done capped per POC, per month).
//   Retention — 1 − (MRR Churned + Contraction in the period) ÷ MRR at the period's start.
//   Collection — of invoices due in the period so far: collected ÷ invoice total, in INR.
//   Task Closure — one-off tasks: Done ÷ (Done + past due), by due date, or by closing date if no due date. Recurring and
//   open tasks with no due date = left out.
// Points = min(actual ÷ target, 100%) × weight. KPI score = points earned ÷ weights counted × 100; a KPI with nothing to
// measure in the period (e.g. no invoices due) is left out rather than scored 0.
export const KPI_DEFS = [
  { key: "adoption", label: "Adoption", icon: "📈", weight: 30, target: 75, info: "Average Adoption pipeline score of the clients at the end of the period." },
  { key: "poc", label: "POC Check-in", icon: "🤝", weight: 10, target: 90, info: "Proactive check-ins done ÷ owed, from each POC's Minimum Proactive Check-ins per Month. Extra check-ins with one POC don't cover a miss on another." },
  { key: "retention", label: "Retention", icon: "🛡️", weight: 20, target: 100, info: "1 − (MRR Churned + MRR Contraction in the period) ÷ MRR at the start of the period." },
  { key: "expansion", label: "Expansion", icon: "🔁", weight: 15, target: 70, info: "Average Expansion pipeline score of the clients at the end of the period." },
  { key: "collection", label: "Collection", icon: "💰", weight: 15, target: 95, info: "Invoices due in the period so far: amount collected ÷ invoice total, in INR." },
  { key: "tasks", label: "Task Closure", icon: "✅", weight: 10, target: 90, info: "One-off tasks: Done ÷ (Done + past due). A task with a due date belongs to the period it's due in: closed early counts straight away, open counts once its due date has passed. A task with no due date counts in the period it was closed, and not while it's open. Recurring tasks are left out." },
];

// ---- settings (migration 0044) ----
export function defaultKpiSettings() {
  return {
    weights: Object.fromEntries(KPI_DEFS.map((k) => [k.key, k.weight])),
    targets: Object.fromEntries(KPI_DEFS.map((k) => [k.key, k.target])),
    csmTargets: {}, // profile id -> { kpi key: target }
  };
}

export async function fetchKpiSettings() {
  const out = defaultKpiSettings();
  const [a, b] = await Promise.all([
    supabase.from("kpi_settings").select("kpi_key,weight,target"),
    supabase.from("kpi_csm_targets").select("csm_id,kpi_key,target"),
  ]);
  // Before migration 0044 is run the tables don't exist — the defaults still work.
  if (a.error || b.error) return out;
  (a.data || []).forEach((r) => { out.weights[r.kpi_key] = Number(r.weight); out.targets[r.kpi_key] = Number(r.target); });
  (b.data || []).forEach((r) => { (out.csmTargets[r.csm_id] = out.csmTargets[r.csm_id] || {})[r.kpi_key] = Number(r.target); });
  return out;
}

export async function saveKpiSettings(settings) {
  const rows = KPI_DEFS.map((k) => ({ kpi_key: k.key, weight: settings.weights[k.key], target: settings.targets[k.key] }));
  const { error } = await supabase.from("kpi_settings").upsert(rows, { onConflict: "kpi_key" });
  if (error) throw error;
  const { error: delErr } = await supabase.from("kpi_csm_targets").delete().not("csm_id", "is", null);
  if (delErr) throw delErr;
  const overrides = Object.entries(settings.csmTargets).flatMap(([csmId, t]) =>
    Object.entries(t).map(([kpiKey, target]) => ({ csm_id: csmId, kpi_key: kpiKey, target })));
  if (overrides.length) {
    const { error: insErr } = await supabase.from("kpi_csm_targets").insert(overrides);
    if (insErr) throw insErr;
  }
}

export function targetFor(settings, key, csmId) {
  return settings.csmTargets[csmId]?.[key] ?? settings.targets[key];
}

// ---- the six numbers ----
function openingMrr(lab, snapsByLab, period) {
  const snaps = snapsByLab[lab.id] || []; // oldest first
  const start = new Date(period.start + "T00:00:00").getTime();
  const end = new Date(period.end + "T23:59:59").getTime();
  const at = (s) => new Date(s.loggedAt).getTime();
  const before = snaps.filter((s) => at(s) < start);
  if (before.length) return before[before.length - 1].mrr;
  const during = snaps.find((s) => at(s) <= end);
  if (during) return during.mrr;
  return snaps.length ? 0 : lab.mrr || 0; // no MRR history at all: its MRR today
}

// Counted MRR of `labs` at the start of `period` (Consolidated = the parent's own; Per-Branch = the children's), in INR.
function openingMrrINR(labs, data, period) {
  const inSet = new Set(labs.map((l) => l.id));
  return labs.reduce((sum, lab) => {
    const kids = data.allLabs.filter((c) => c.type === "Child" && c.parent === lab.id);
    if (lab.type === "Child" && inSet.has(lab.parent)) {
      const par = labs.find((l) => l.id === lab.parent);
      if (par.billingMode === "Consolidated") return sum;
    } else if (kids.length && lab.billingMode !== "Consolidated") return sum;
    return sum + toINR(openingMrr(lab, data.snapsByLab, period), lab.region);
  }, 0);
}

// `labs` = the labs measured. `tasks` = the tasks measured (by owner for a CSM, by lab for one client).
// `scores` = { adoption, expansion } already averaged for this period by the caller. Each KPI: { value, note } (value null = nothing to measure).
export function computeKpis({ labs, tasks, scores, period, data }) {
  const today = todayISO();
  const ids = new Set(labs.map((l) => l.id));
  const byId = Object.fromEntries(labs.map((l) => [l.id, l]));

  let owed = 0, done = 0;
  const months = monthsIn(period);
  data.contacts.filter((c) => c.minProactive > 0 && ids.has(c.labId)).forEach((c) => {
    months.forEach((ym) => {
      if (c.createdAt && c.createdAt.slice(0, 7) > ym) return;
      const st = pocMonthStatus(c, data.visitsByLab[c.labId], ym);
      owed += st.required; done += Math.min(st.done, st.required);
    });
  });

  const open = openingMrrINR(labs, data, period);
  const lostRows = data.churn.filter((c) => ids.has(c.labId) && c.churnMonth >= period.start && c.churnMonth <= period.end);
  const lost = lostRows.reduce((s, c) => s + toINR(c.mrrLost, byId[c.labId].region), 0);

  const lastDay = period.end < today ? period.end : today;
  const invoices = data.invoices.filter((i) => ids.has(i.labId) && i.dueDate && i.dueDate >= period.start && i.dueDate <= lastDay);
  const billed = invoices.reduce((s, i) => s + toINR(i.total, byId[i.labId].region), 0);
  const collected = invoices.reduce((s, i) => s + toINR(Math.min(i.collectedManual, i.total), byId[i.labId].region), 0);

  const isDone = (t) => t.status === "Done" || t.done;
  // With a due date: done counts straight away, even if closed early; open counts only once it's missed, after its due date.
  // No due date (decision Nov 4 2026): counts in the period it was closed. While open it can't be missed, so it's left out.
  const inPeriod = (d) => d >= period.start && d <= period.end;
  const due = tasks.filter((t) => {
    if (isRecurring(t)) return false;
    if (t.due) return inPeriod(t.due) && (isDone(t) || t.due < today);
    return isDone(t) && !!t.completedAt && inPeriod(toLocalISODate(new Date(t.completedAt)));
  });
  const closed = due.filter(isDone).length;

  return {
    adoption: { value: scores.adoption, note: `${scores.clients} client${scores.clients === 1 ? "" : "s"}` },
    expansion: { value: scores.expansion, note: `${scores.clients} client${scores.clients === 1 ? "" : "s"}` },
    poc: { value: owed ? (done / owed) * 100 : null, note: owed ? `${done} of ${owed} check-ins` : "No POC minimums set" },
    retention: { value: open > 0 ? Math.max(0, (1 - lost / open) * 100) : null, note: open > 0 ? `${lostRows.length} churn / contraction` : "No MRR at the start", lost },
    collection: { value: billed > 0 ? (collected / billed) * 100 : null, note: billed > 0 ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} due` : "No invoices due", billed, collected },
    tasks: { value: due.length ? (closed / due.length) * 100 : null, note: due.length ? `${closed} of ${due.length} tasks` : "No tasks to count" },
  };
}

// Points for each KPI and the total. `targetOf(key)` gives the target that applies.
export function scoreKpis(kpis, weights, targetOf) {
  let earned = 0, counted = 0;
  const points = {};
  KPI_DEFS.forEach(({ key }) => {
    const v = kpis[key]?.value, w = Number(weights[key]) || 0, t = Number(targetOf(key)) || 0;
    if (v == null) { points[key] = null; return; }
    const p = (t > 0 ? Math.min(v / t, 1) : 1) * w;
    points[key] = p; earned += p; counted += w;
  });
  return { points, total: counted ? (earned / counted) * 100 : null };
}
