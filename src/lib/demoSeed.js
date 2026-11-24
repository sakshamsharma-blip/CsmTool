import raw from "./demoData.json";

// Used only when no Supabase project is configured (.env not set up yet) — lets the app still
// be opened and clicked through, exactly like the original prototype, with the same reviewed
// catalog/plans/roster data (extracted from the prototype, not retyped).
export const DEMO_MODULES = raw.MODULES;
export const DEMO_PLANS = raw.PLANS;
export const DEMO_CSM_DIRECTORY = raw.CSM_DIRECTORY;

export const DEMO_LABS = [
  { id: "829", name: "iGenetic Diagnostics", type: "Parent", parent: null, csm: "Rahul Barge", plan: "advance", region: "Domestic", state: "Maharashtra", country: "India", mrr: 70000, status: "Active" },
  { id: "829-1", name: "iGenetic Diagnostics - Andheri", type: "Child", parent: "829", csm: "Rahul Barge", plan: "advance", region: "Domestic", state: "Maharashtra", country: "India", mrr: 30000, status: "Active" },
  { id: "829-2", name: "iGenetic Diagnostics - Borivali", type: "Child", parent: "829", csm: "Rahul Barge", plan: "advance", region: "Domestic", state: "Maharashtra", country: "India", mrr: 25000, status: "Active" },
  { id: "830", name: "Medcis Group", type: "Parent", parent: null, csm: "Suraj Todkar", plan: "growth", region: "Domestic", state: "Maharashtra", country: "India", mrr: 40000, status: "Active" },
  { id: "831", name: "Span Diagnostics", type: "Parent", parent: null, csm: "Aseem Khan", plan: "premium", region: "Domestic", state: "Gujarat", country: "India", mrr: 40000, status: "Active" },
  { id: "832", name: "Truemedix Lab", type: "Parent", parent: null, csm: "Aseem Khan", plan: "starter", region: "Domestic", state: "Gujarat", country: "India", mrr: 35000, status: "At Risk" },
  { id: "833", name: "Cadabams Group", type: "Parent", parent: null, csm: "Mazhar Shaikh", plan: "enterprise", region: "Domestic", state: "Tamil Nadu", country: "India", mrr: 120000, status: "Active" },
  { id: "834", name: "Nairobi Precision Labs", type: "Parent", parent: null, csm: "Mazhar Shaikh", plan: "premium", region: "ROW", state: "—", country: "Kenya", mrr: 1400, status: "Active" },
];

// ---- Feedback & NPS demo data (Nov 2026) ----
// Fake responses so the Feedback & NPS report, its coverage list and its trend charts can be tried in demo mode.
// Built relative to today: each client gives a 1–5 rating most months and an NPS score most quarters, with a few
// gaps so some clients show as due. Deterministic (no Math.random), so the e2e tests see the same data every run.
const DEMO_POCS = {
  "829": [["Dr Anil Mehta", "Owner / Founder / Managing Director"], ["Priya Nair", "Laboratory Manager / Technical Manager"]],
  "830": [["Sanjay Kulkarni", "Lab Director - Pathology"], ["Meera Joshi", "Front Office / Billing Supervisor"]],
  "831": [["Dr Kavita Shah", "Owner / Founder / Managing Director"], ["Rohan Patel", "IT Manager / System Administrator"]],
  "832": [["Vikas Desai", "Laboratory Manager / Technical Manager"], ["Neha Trivedi", "Finance / Accounts Manager"]],
  "833": [["Dr R. Srinivasan", "Lab Director - Radiology"], ["Lakshmi Iyer", "Quality Manager"]],
  "834": [["Dr Wanjiru Kamau", "Owner / Founder / Managing Director"], ["Brian Otieno", "IT Manager / System Administrator"]],
};
const DEMO_COMMENTS = {
  high: ["Very happy with the support team, issues get fixed the same day.", "Report turnaround has improved a lot since the new templates went live.", "Smooth month. The WhatsApp report delivery is a hit with our patients.", "Training for the new front-desk staff was excellent."],
  mid: ["Works well overall, but billing reconciliation still takes our accounts team extra time every Friday.", "Good product. Would like faster responses on weekend tickets.", "Integration with the analyser had a few hiccups this month, sorted now."],
  low: ["Two outages during peak hours this month — we lost a morning of reporting. Need a root-cause call.", "Invoice amounts didn't match what was agreed; this needs to be resolved before renewal.", "Support response times have been slow and the team is frustrated."],
};
// Each client's typical mood: a base NPS and how often it skips a month.
const DEMO_PROFILE = { "829": [9, 0], "830": [7, 4], "831": [8, 3], "832": [5, 2], "833": [9, 5], "834": [8, 0] };

function demoDate(y, m, d) { return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }

export function buildDemoFeedback(today) {
  const [ty, tm, td] = today.split("-").map(Number);
  const feedback = [], testimonials = [], contacts = [];
  let n = 0;
  Object.entries(DEMO_POCS).forEach(([labId, pocs]) => pocs.forEach(([name, designation], i) => contacts.push({ id: `demo-poc-${labId}-${i}`, labId, name, designation, phone: "", email: "", minProactive: 2 })));
  Object.entries(DEMO_PROFILE).forEach(([labId, [base, skipEvery]], li) => {
    const pocs = DEMO_POCS[labId];
    for (let back = 14; back >= 0; back--) {
      let y = ty, m = tm - back;
      while (m < 1) { m += 12; y -= 1; }
      const day = 4 + ((li * 5 + back * 3) % 20);
      if (back === 0 && day > td) continue;                 // not due yet this month
      if (skipEvery && (back + li) % skipEvery === 0) continue; // a missed month
      if (back === 0 && li % 2 === 1) continue;              // half the clients haven't answered this month yet
      const wobble = ((back * 7 + li * 3) % 5) - 2;          // -2…+2
      const trendUp = back > 8 ? -1 : 0;                     // a slightly weaker start, so the trend line moves
      const isQuarterAsk = (m - 1) % 3 === 1;                // NPS asked in the middle month of each quarter
      const nps = isQuarterAsk ? Math.max(0, Math.min(10, base + trendUp + Math.round(wobble / 2))) : null;
      const rating = Math.max(1, Math.min(5, Math.round((base + trendUp + wobble) / 2)));
      const [who, designation] = pocs[(back + li) % pocs.length];
      const mood = (nps ?? rating * 2) >= 9 ? "high" : (nps ?? rating * 2) >= 7 ? "mid" : "low";
      const pool = DEMO_COMMENTS[mood];
      const date = demoDate(y, m, day);
      n += 1;
      feedback.push({
        id: `demo-fb-${n}`, labId, rating, npsScore: nps, comment: pool[(back + li) % pool.length], date,
        source: ["Google Form", "Email", "WhatsApp"][(back + li) % 3], respondentName: who, respondentDesignation: designation,
        linkUrl: "", createdBy: null, createdAt: `${date}T10:${String(10 + li).padStart(2, "0")}:00`,
      });
    }
  });
  // 28 testimonials across every format, topic group, source, status and consent (migration 0051 fields).
  const TOPIC_SETS = [
    ["product:overall", "support:overall", "impl:onboarding"], ["support:overall", "impact:tat"], ["impact:billing", "product:report_management"],
    ["product:inventory", "impact:growth"], ["product:inventory", "product:qc"], ["product:overall", "support:response_time"],
    ["impl:onboarding", "impl:training"], ["product:overall", "brand:recommend"], ["product:report_management", "tech:performance"],
    ["product:overall", "support:csm", "impl:golive"], ["tech:analyser", "tech:his_emr"], ["impact:patient", "product:home_collection"],
  ];
  const SOURCES = ["Email", "WhatsApp", "Google Form", "Email", "Other", "WhatsApp", "Google Form"];
  const STATUS_CONSENT = [["Published", "Received"], ["Approved", "Received"], ["In Review", "Requested"], ["Pending", "Not Requested"], ["Published", "Received"], ["Approved", "Received"], ["Pending", "Requested"]];
  const labIds = Object.keys(DEMO_POCS);
  for (let i = 0; i < 28; i++) {
    const labId = labIds[i % labIds.length];
    const back = i % 11;
    let y = ty, m = tm - back;
    while (m < 1) { m += 12; y -= 1; }
    const day = back === 0 ? Math.min(td, 2 + (i % 20)) : 2 + (i % 26);
    const [who, designation] = DEMO_POCS[labId][i % 2];
    const date = demoDate(y, m, day);
    const isVideo = i % 7 === 0 || i % 7 === 3;
    const [status, consent] = STATUS_CONSENT[i % STATUS_CONSENT.length];
    testimonials.push({
      id: `demo-t-${i}`, labId, personName: who, designation, format: isVideo ? "Video" : "Written",
      source: isVideo ? "" : SOURCES[i % SOURCES.length], sourceDetail: !isVideo && SOURCES[i % SOURCES.length] === "Other" ? "LinkedIn post" : "", topics: TOPIC_SETS[i % TOPIC_SETS.length],
      rating: [5, 4.5, 4.5, 4, 5, 4.5, 3.5][i % 7], status, consent,
      videoUrl: isVideo ? "https://example.com/video" : "https://example.com/review",
      note: isVideo ? "Recorded at the lab after the go-live review." : "Posted after our quarterly review call — mentions faster reports and the support team.",
      date, createdBy: null, createdAt: `${date}T12:${String(i).padStart(2, "0")}:00`,
    });
  }
  return { feedback, testimonials, contacts };
}

// ---- Check-ins & Inbox demo data (Nov 2026) ----
// POCs with check-in targets (4 = weekly, 2 = every 15 days, 1 = monthly) and ~3 months of check-ins / visits, built
// relative to today so the Check-ins page shows overdue, due-soon and upcoming POCs and the Inbox has fresh entries.
const DEMO_TARGETS = { "829": [4, 2], "830": [2, 1], "831": [4, 1], "832": [2, 2], "833": [1, 4], "834": [2, 0] };
const DEMO_NOTES = [
  "Weekly sync on report turnaround. Asked for a refresher on the new billing screen for two front-desk staff.",
  "Reviewed open tickets; analyser interface stable since last patch. They want WhatsApp report delivery enabled for all branches.",
  "Discussed the upcoming renewal and the inventory module rollout timeline. Positive overall.",
  "Raised concerns about two outages during peak hours. Promised an RCA and a follow-up call.",
  "Quick check-in: QC module being used daily, home collection app adoption still low at one branch.",
];
export function buildDemoCheckins(today) {
  const contacts = [], visits = [];
  let n = 0;
  Object.entries(DEMO_POCS).forEach(([labId, pocs], li) => {
    pocs.forEach(([name, designation], pi) => {
      const target = DEMO_TARGETS[labId][pi];
      contacts.push({ id: `demo-poc-${labId}-${pi}`, labId, name, designation, phone: "", email: "", minProactive: target || null, createdAt: `${addDays(today, -95)}T09:00:00` });
      if (!target) return;
      const gap = Math.max(1, Math.floor(30 / target));
      // Walk back from a "last contact" that is a little late for some POCs (overdue) and on time for others.
      const lateBy = [-2, 4, 9, -5, 1, 12, 0, -1, 3, 6, -3, 2][(li * 2 + pi) % 12];
      let d = addDays(today, -(gap + lateBy));
      for (let k = 0; k < 90 / gap && d >= addDays(today, -90); k++) {
        if (d <= today) {
          n += 1;
          const visit = (k + li) % 5 === 0;
          visits.push({
            id: `demo-v-${n}`, labId, csmId: null, type: visit ? "Visit" : ["Call", "GMeet", "WhatsApp", "Call"][(k + pi) % 4], visitDate: d,
            notes: DEMO_NOTES[(n + li) % DEMO_NOTES.length], engagement: (k + pi) % 6 === 5 ? "Reactive" : "Proactive",
            sentiment: ["Positive", "Neutral", "Positive", "At Risk", "Positive"][(n + li) % 5], personName: name, personDesignation: designation,
            durationMinutes: [15, 30, 45, 30][n % 4], location: visit ? "At the lab" : "", discussionTopics: [["Billing", "Reports"], ["Integration"], ["Renewal"], ["Support"]][n % 4],
            flaggedModules: [], discussedParams: [], actionItems: n % 3 === 0 ? [{ text: "Share the RCA document", dueDate: addDays(d, 3) }] : [],
            nextFollowupDate: k === 0 ? addDays(d, gap) : null, nextFollowupReason: k === 0 ? "Regular check-in" : "", nextFollowupTime: "",
            createdAt: `${d}T${String(9 + (n % 8)).padStart(2, "0")}:15:00`,
          });
        }
        d = addDays(d, -gap);
      }
    });
  });
  return { contacts, visits };
}
function addDays(iso, days) {
  const [y, m, dd] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, dd + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
