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
  [["829", 2], ["833", 5], ["834", 9]].forEach(([labId, back], i) => {
    let y = ty, m = tm - back;
    while (m < 1) { m += 12; y -= 1; }
    const [who, designation] = DEMO_POCS[labId][0];
    const date = demoDate(y, m, 12);
    testimonials.push({ id: `demo-t-${i}`, labId, personName: who, designation, videoUrl: "https://example.com/testimonial", note: "Recorded at the lab after the go-live review.", date, createdBy: null, createdAt: `${date}T12:00:00` });
  });
  return { feedback, testimonials, contacts };
}
