// Daily reminder digest for the CSM Tool. Called once a day by pg_cron (see migrations/0025).
//
// For every person who switched reminders on (notification_prefs), it collects:
//   - their open one-off tasks that are overdue or due today;
//   - overdue payments on labs they own: invoices past their due date with a balance, and priced
//     Collections items still unpaid 30+ days after being added;
// then sends one email per person (Resend) and/or one Slack message per person (Incoming Webhook, with an
// @mention when a Slack member ID is set). A channel without credentials is simply skipped, so this is safe
// to deploy before the keys exist. Returns a JSON summary of what was (or would be) sent.
//
// Secrets: REMINDER_CRON_SECRET (required), RESEND_API_KEY + REMINDER_FROM_EMAIL (email), SLACK_WEBHOOK_URL
// (Slack), APP_URL (link in messages). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";

function todayInIndia(): string {
  // The team works in IST; "today" for due dates is the Indian calendar date.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function money(n: number, region: string): string {
  return (region === "ROW" ? "$" : "₹") + Math.round(n).toLocaleString("en-IN");
}

Deno.serve(async (req) => {
  const secret = env("REMINDER_CRON_SECRET");
  if (!secret || req.headers.get("x-reminder-secret") !== secret) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const today = todayInIndia();
  const appUrl = env("APP_URL") || "https://csm-tool-two.vercel.app";

  const [{ data: prefs }, { data: profiles }, { data: emails }, { data: labs }, { data: tasks }, { data: invoices }, { data: items }] = await Promise.all([
    db.from("notification_prefs").select("*").or("email_enabled.eq.true,slack_enabled.eq.true"),
    db.from("profiles").select("id,name,active"),
    db.from("profile_emails").select("profile_id,email"),
    db.from("labs").select("id,name,csm_id,region,status"),
    db.from("tasks").select("id,description,owner_id,lab_id,due,done,repeat").eq("done", false).eq("repeat", "none").not("due", "is", null).lte("due", today),
    db.from("invoices").select("id,lab_id,invoice_number,due_date,total,collected_manual").lt("due_date", today),
    db.from("collections_items").select("id,lab_id,label,amount,is_trial,collected_manual,added_date").eq("is_trial", false),
  ]);

  const labById = new Map((labs ?? []).map((l) => [l.id, l]));
  const summary: Record<string, unknown>[] = [];

  for (const p of prefs ?? []) {
    const person = (profiles ?? []).find((x) => x.id === p.profile_id);
    if (!person || person.active === false) continue;
    const myLabs = (labs ?? []).filter((l) => l.csm_id === person.id && l.status !== "Churned");
    const myLabIds = new Set(myLabs.map((l) => l.id));

    const myTasks = (tasks ?? []).filter((t) => t.owner_id === person.id);
    const overdueInv = (invoices ?? []).filter((iv) => myLabIds.has(iv.lab_id) && Number(iv.total) - Number(iv.collected_manual || 0) > 0);
    const overdueItems = (items ?? []).filter((i) => myLabIds.has(i.lab_id) && Number(i.amount) - Number(i.collected_manual || 0) > 0 && daysBetween(i.added_date, today) >= 30);
    if (!myTasks.length && !overdueInv.length && !overdueItems.length) continue;

    const lines: string[] = [];
    if (myTasks.length) {
      lines.push(`Tasks due or overdue (${myTasks.length}):`);
      myTasks.forEach((t) => lines.push(`  • ${t.description}${t.due < today ? ` — overdue since ${t.due}` : " — due today"}`));
    }
    if (overdueInv.length || overdueItems.length) {
      lines.push(`Overdue payments (${overdueInv.length + overdueItems.length}):`);
      overdueInv.forEach((iv) => {
        const lab = labById.get(iv.lab_id);
        lines.push(`  • ${lab?.name ?? iv.lab_id}: invoice ${iv.invoice_number}, ${money(Number(iv.total) - Number(iv.collected_manual || 0), lab?.region ?? "")} due ${iv.due_date}`);
      });
      overdueItems.forEach((i) => {
        const lab = labById.get(i.lab_id);
        lines.push(`  • ${lab?.name ?? i.lab_id}: ${i.label}, ${money(Number(i.amount) - Number(i.collected_manual || 0), lab?.region ?? "")} outstanding since ${i.added_date}`);
      });
    }
    const text = `Hi ${person.name}, here's your CS Console reminder for ${today}:\n\n${lines.join("\n")}\n\nOpen the console: ${appUrl}`;
    const result: Record<string, unknown> = { person: person.name, tasks: myTasks.length, payments: overdueInv.length + overdueItems.length };

    if (p.email_enabled) {
      const to = p.email || (emails ?? []).find((e) => e.profile_id === person.id)?.email;
      if (!env("RESEND_API_KEY") || !env("REMINDER_FROM_EMAIL")) result.email = "skipped — email not configured";
      else if (!to) result.email = "skipped — no email address";
      else if (dryRun) result.email = `would send to ${to}`;
      else {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: env("REMINDER_FROM_EMAIL"), to, subject: `CS Console reminder — ${today}`, text }),
        });
        result.email = r.ok ? `sent to ${to}` : `failed (${r.status})`;
      }
    }
    if (p.slack_enabled) {
      const mention = p.slack_member_id ? `<@${p.slack_member_id}> ` : "";
      if (!env("SLACK_WEBHOOK_URL")) result.slack = "skipped — Slack not configured";
      else if (dryRun) result.slack = "would post";
      else {
        const r = await fetch(env("SLACK_WEBHOOK_URL"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: mention + text }),
        });
        result.slack = r.ok ? "posted" : `failed (${r.status})`;
      }
    }
    summary.push(result);
  }

  return new Response(JSON.stringify({ date: today, dryRun, people: summary }), { headers: { "Content-Type": "application/json" } });
});
