import { useCallback, useEffect, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";

// Inbox (decision Nov 24 2026; every CSM since Nov 26 2026 — RLS on visits already limits a CSM to their own labs): check-ins and logged visits, marked read per person
// (table visit_reads, migration 0052 — only you can see or change your own marks). Anything created before INBOX_START
// counts as read, so the history doesn't arrive as hundreds of unread items.
export const INBOX_START = "2026-11-24";
export const visitKind = (v) => (v.type === "Visit" ? "Visit" : "Check-in");
// Demo mode (fake data dated relative to today): the last 14 days count as unread instead.
const DEMO_START = (() => { const d = new Date(); d.setDate(d.getDate() - 14); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
export const isUnread = (v, reads) => (v.createdAt || "").slice(0, 10) >= (SUPABASE_CONFIGURED ? INBOX_START : DEMO_START) && !reads.has(v.id);

// Demo mode keeps read marks in memory.
const demoReads = new Set();
const notify = () => window.dispatchEvent(new Event("inbox-changed"));

export async function fetchMyReads(profileId) {
  if (!SUPABASE_CONFIGURED) return new Set(demoReads);
  if (!profileId) return new Set();
  const out = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("visit_reads").select("visit_id").eq("profile_id", profileId).range(from, from + 999);
    if (error) {
      if (/visit_reads/.test(error.message || "")) throw new Error("The Inbox isn't set up in the database yet — run migration 0052_inbox_reads.sql.");
      throw error;
    }
    (data || []).forEach((r) => out.add(r.visit_id));
    if (!data || data.length < 1000) return out;
  }
}
export async function markRead(profileId, visitIds) {
  const ids = [...new Set(visitIds)].filter(Boolean);
  if (!ids.length) return;
  if (!SUPABASE_CONFIGURED) { ids.forEach((id) => demoReads.add(id)); notify(); return; }
  const { error } = await supabase.from("visit_reads").upsert(ids.map((visit_id) => ({ profile_id: profileId, visit_id })), { onConflict: "profile_id,visit_id", ignoreDuplicates: true });
  if (error) throw error;
  notify();
}
export async function markUnread(profileId, visitId) {
  if (!SUPABASE_CONFIGURED) { demoReads.delete(visitId); notify(); return; }
  const { error } = await supabase.from("visit_reads").delete().eq("profile_id", profileId).eq("visit_id", visitId);
  if (error) throw error;
  notify();
}

// Sidebar badge: how many check-ins / visits since INBOX_START (not logged by you) you haven't read. Refreshes every 5 minutes and whenever
// something is marked read.
export function useInboxUnread(profileId, enabled) {
  const [count, setCount] = useState(0);
  const load = useCallback(async () => {
    if (!enabled || !SUPABASE_CONFIGURED || !profileId) return;
    try {
      const [{ data, error }, reads] = await Promise.all([
        supabase.from("visits").select("id,created_at,csm_id").gte("created_at", INBOX_START).limit(5000),
        fetchMyReads(profileId),
      ]);
      if (error) throw error;
      setCount((data || []).filter((v) => !reads.has(v.id) && v.csm_id !== profileId).length); // your own entries count as read
    } catch { setCount(0); }
  }, [profileId, enabled]);
  useEffect(() => {
    if (!enabled) return undefined;
    const first = setTimeout(load, 0); // after the render, not inside it
    const t = setInterval(load, 5 * 60 * 1000);
    window.addEventListener("inbox-changed", load);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener("inbox-changed", load); };
  }, [load, enabled]);
  return enabled ? count : 0;
}
