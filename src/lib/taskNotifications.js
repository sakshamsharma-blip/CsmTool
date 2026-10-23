import { useEffect, useState } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../supabaseClient";

// "New tasks" counter on the sidebar's Tasks item (WhatsApp-style unread count). A task counts as new when it
// belongs to this person and was created after they last opened the Tasks page. "Last opened" is remembered per
// browser (it's only a convenience — losing it just means the count starts again from zero).
const keyFor = (profileId) => `csm_tasks_seen_${profileId}`;
function readSeen(profileId) {
  try { return localStorage.getItem(keyFor(profileId)); } catch { return null; }
}
function writeSeen(profileId, iso) {
  try { localStorage.setItem(keyFor(profileId), iso); } catch { /* ignore */ }
}

export function useNewTaskCount(profileId, onTasksPage) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !profileId) return undefined;
    if (onTasksPage) { writeSeen(profileId, new Date().toISOString()); return undefined; }
    let cancelled = false;
    async function refresh() {
      let seen = readSeen(profileId);
      if (!seen) { seen = new Date().toISOString(); writeSeen(profileId, seen); } // first visit: start from now
      const { count: n, error } = await supabase.from("tasks").select("id", { count: "exact", head: true })
        .eq("owner_id", profileId).eq("done", false).gt("created_at", seen);
      if (!cancelled && !error) setCount(n || 0);
    }
    refresh();
    const t = setInterval(refresh, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [profileId, onTasksPage]);
  return onTasksPage ? 0 : count; // opening Tasks marks everything seen
}
