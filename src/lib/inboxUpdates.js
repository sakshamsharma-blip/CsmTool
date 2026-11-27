import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";

// Inbox → Adoption / Expansion / Account (decision Nov 27 2026). Each is its own inbox, next to Check-ins & Visits.
// Nothing new is tracked: every change already writes a Lab History entry (activity_log), so these inboxes read
// activity_log by kind. Read marks per person live in activity_reads (migration 0054; only you see your own).
// Changes made before UPDATES_START count as read, and so does anything you did yourself (activity_log.csm_id = you).
export const UPDATES_START = "2026-11-27";

export const UPDATE_SEGMENTS = {
  adoption: {
    label: "Adoption",
    sub: "In plan stage changes (To-Do … Live 1–4 … Adopted) and In plan ⇄ Not in plan moves",
    kinds: ["Adoption Updated"],
  },
  expansion: {
    label: "Expansion",
    sub: "Pitch stages, purchases, lost features, charges and Expansion deals",
    kinds: ["Pitch Updated", "Expansion Converted", "Expansion Update", "Expansion Opportunity Added", "Expansion Opportunity Updated"],
  },
  account: {
    label: "Account",
    sub: "MRR and invoices, plan, CSM, status and billing changes, churn and feedback",
    kinds: ["MRR Updated", "Invoice Uploaded", "Plan Changed", "Lab Reassigned", "Status Changed", "Billing Mode Changed",
      "Lab Churned", "Contraction Logged", "Feedback Recorded"],
  },
};
export const SEGMENT_KEYS = Object.keys(UPDATE_SEGMENTS);
const KIND_TO_SEGMENT = Object.fromEntries(SEGMENT_KEYS.flatMap((s) => UPDATE_SEGMENTS[s].kinds.map((k) => [k, s])));
export const segmentOf = (kind) => KIND_TO_SEGMENT[kind] || null;
const ALL_KINDS = Object.keys(KIND_TO_SEGMENT);

// Changes by the same person on the same lab in the same inbox, each within BURST_MINUTES of the previous one, are one
// entry ("12 adoption updates") — setting up a new lab can mean 30–50 changes in one sitting.
export const BURST_MINUTES = 10;

const mapRow = (r) => ({
  id: r.id, labId: r.lab_id, kind: r.kind, title: r.title || "", meta: r.meta || "", details: r.details || null,
  csmId: r.csm_id || null, createdAt: r.created_at, segment: segmentOf(r.kind),
});

// Demo mode (no database): a few days of made-up changes so the inboxes can be tried. Deterministic.
let demoRows = null;
function buildDemoUpdates(labs, modules) {
  const now = Date.now();
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600 * 1000).toISOString();
  const params = modules.flatMap((m) => (m.params || []).map((p) => ({ moduleKey: m.key, name: p.name })));
  const parents = labs.filter((l) => l.type !== "Child");
  const out = [];
  let n = 0;
  const add = (lab, hoursAgo, kind, title, meta, details) => { n += 1; out.push({ id: `demo-u-${n}`, lab_id: lab.id, kind, title, meta, details, csm_id: null, created_at: at(hoursAgo) }); };
  const LADDER = ["To-Do", "In Discussion / Demo", "Onboarding / Setup", "Live 1", "Live 2", "Live 3", "Adopted"];
  parents.forEach((lab, li) => {
    // A burst of rollout updates (one sitting) …
    for (let k = 0; k < 3 + (li % 3); k++) {
      const p = params[(li * 7 + k * 3) % params.length];
      const step = (li + k) % (LADDER.length - 1);
      const change = `Status: ${LADDER[step]} → ${LADDER[step + 1]}`;
      add(lab, 2 + li * 9 + k * 0.05, "Adoption Updated", `${p.name}: ${change}`, ["Training done with the front desk.", "Client confirmed it's in daily use.", "Configured with the lab manager."][k % 3],
        { param: { moduleKey: p.moduleKey, paramName: p.name, change, comment: "" } });
    }
    // … and a single one a day or two earlier.
    const p = params[(li * 5 + 2) % params.length];
    add(lab, 30 + li * 11, "Adoption Updated", `${p.name}: Not in plan → In plan`, "Part of the plan after the renewal call.",
      { param: { moduleKey: p.moduleKey, paramName: p.name, change: "Not in plan → In plan", comment: "" } });
    const e = params[(li * 11 + 5) % params.length];
    const [from, to] = [["To-Do", "Pitching"], ["Pitching", "Trial"], ["Trial", "Purchased"]][li % 3];
    add(lab, 5 + li * 13, to === "Purchased" ? "Expansion Converted" : "Pitch Updated", `Pitch stage changed: ${from} → ${to}`, `${e.name}: ${from} → ${to} — discussed with the owner`,
      { pitch: { moduleKey: e.moduleKey, paramName: e.name, label: e.name, from, to, comment: "discussed with the owner" } });
    if (li % 2 === 0) add(lab, 20 + li * 7, "MRR Updated", `MRR set to ₹${(lab.mrr || 0).toLocaleString("en-IN")}`, "From the latest quarterly invoice", null);
    if (li % 3 === 1) add(lab, 50 + li * 5, "Plan Changed", "Plan changed", "growth → advance", null);
    if (li === 2) add(lab, 70, "Lab Reassigned", "CSM reassigned", "Suraj Todkar → Aseem Khan", null);
  });
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Every change in the three inboxes since UPDATES_START that you can see (RLS: a CSM their own labs, a Lead the team).
export async function fetchInboxUpdates({ labs = [], modules = [] } = {}) {
  if (!SUPABASE_CONFIGURED) {
    if (!demoRows) demoRows = buildDemoUpdates(labs, modules);
    return demoRows.map(mapRow);
  }
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("activity_log").select("id,lab_id,kind,title,meta,details,csm_id,created_at")
      .in("kind", ALL_KINDS).gte("created_at", UPDATES_START).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((r) => out.push(mapRow(r)));
    if (!data || data.length < 1000) return out;
  }
}

// ---- read marks (activity_reads, migration 0054) ----
const demoReads = new Set();
const notify = () => window.dispatchEvent(new Event("inbox-changed"));

export async function fetchMyUpdateReads(profileId) {
  if (!SUPABASE_CONFIGURED) return new Set(demoReads);
  if (!profileId) return new Set();
  const out = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("activity_reads").select("activity_id").eq("profile_id", profileId)
      .gte("read_at", UPDATES_START).range(from, from + 999);
    if (error) {
      if (/activity_reads/.test(error.message || "")) throw new Error("These inboxes aren't set up in the database yet — run migration 0054_inbox_activity_reads.sql.");
      throw error;
    }
    (data || []).forEach((r) => out.add(r.activity_id));
    if (!data || data.length < 1000) return out;
  }
}
export async function markUpdatesRead(profileId, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return;
  if (!SUPABASE_CONFIGURED) { list.forEach((id) => demoReads.add(id)); notify(); return; }
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await supabase.from("activity_reads")
      .upsert(list.slice(i, i + 500).map((activity_id) => ({ profile_id: profileId, activity_id })), { onConflict: "profile_id,activity_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  notify();
}
export async function markUpdatesUnread(profileId, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return;
  if (!SUPABASE_CONFIGURED) { list.forEach((id) => demoReads.delete(id)); notify(); return; }
  const { error } = await supabase.from("activity_reads").delete().eq("profile_id", profileId).in("activity_id", list);
  if (error) throw error;
  notify();
}

const DEMO_START = () => new Date(Date.now() - 14 * 86400 * 1000).toISOString();
// Unread for you = after the start date, not done by you, not marked read.
export function updateUnread(row, reads, me) {
  const start = SUPABASE_CONFIGURED ? UPDATES_START : DEMO_START();
  return (row.createdAt || "") >= start && !reads.has(row.id) && (!me || row.csmId !== me);
}

// rows: newest first. Returns entries { id, labId, segment, csmId, rows (newest first), createdAt (newest), firstAt }.
export function groupBursts(rows) {
  const open = {}; // `${segment}|${labId}|${csmId}` -> the group being built
  const groups = [];
  rows.forEach((r) => {
    const key = `${r.segment}|${r.labId}|${r.csmId || ""}`;
    const g = open[key];
    const t = new Date(r.createdAt).getTime();
    if (g && g.lastT - t <= BURST_MINUTES * 60 * 1000) {
      g.rows.push(r); g.lastT = t; g.firstAt = r.createdAt;
    } else {
      const ng = { id: `g-${r.id}`, labId: r.labId, segment: r.segment, csmId: r.csmId, rows: [r], createdAt: r.createdAt, firstAt: r.createdAt, lastT: t };
      open[key] = ng; groups.push(ng);
    }
  });
  return groups;
}

// One line describing a change, the "from → to" when there is one.
export function describeUpdate(r) {
  const p = r.details?.param;
  if (p) {
    const m = (p.change || "").match(/^Status:\s*(.+)$/);
    return { what: p.paramName, change: m ? m[1] : p.change, moduleKey: p.moduleKey, note: r.meta };
  }
  const pi = r.details?.pitch;
  if (pi) return { what: pi.label || pi.paramName || pi.moduleKey, change: `${pi.from || "—"} → ${pi.to}`, moduleKey: pi.moduleKey, note: pi.comment || "" };
  return { what: r.title, change: "", moduleKey: null, note: r.meta };
}
