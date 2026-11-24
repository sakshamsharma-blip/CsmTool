// Testimonials (decision Nov 24 2026, migration 0051), shared by the app (re-exported by src/lib/testimonials.js) and
// the connector (csm-mcp), so both label and count them the same way. Pure JS, no imports.

export const TESTIMONIAL_FORMATS = ["Video", "Written"];
// Where a WRITTEN testimonial came from (decision Nov 24 2026: the channels the team actually uses). "Other" needs a
// short description of what it was (source_detail). A video has no source.
export const TESTIMONIAL_SOURCES = ["Email", "WhatsApp", "Google Form", "Other"];
export const sourceText = (source, detail) => (source === "Other" && detail ? `Other: ${detail}` : source || "");
// Publication status, in order. Approved and Published need consent = Received (checked in the app).
export const TESTIMONIAL_STATUSES = ["Pending", "In Review", "Approved", "Published"];
export const TESTIMONIAL_CONSENTS = ["Not Requested", "Requested", "Received"];
export const STATUSES_NEEDING_CONSENT = ["Approved", "Published"];
export const RATING_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export const needsConsent = (status) => STATUSES_NEEDING_CONSENT.includes(status);
export const isApprovedOrPublished = (status) => STATUSES_NEEDING_CONSENT.includes(status);

// Product & Module Experience: "Overall" plus a fixed list of the product's modules (decision Nov 24 2026 — not the Adoption
// Template, whose module names differ and change). Saved as "product:<key>". `modules` is still accepted by topicGroups /
// topicInfo so an older "product:<template key>" topic shows its module name.
export const PRODUCT_TOPICS = [
  ["overall", "Overall Product Experience", "Overall"], ["registration_billing", "Registration & Billing", "Reg. & Billing"],
  ["report_management", "Report Management", "Report Mgmt"], ["smart_report", "Smart Report", "Smart Report"],
  ["inventory", "Inventory Management", "Inventory"], ["qc", "Quality Control (QC)", "QC"],
  ["home_collection", "Home Collection", "Home Collection"], ["appointment", "Appointment Management", "Appointments"],
  ["branch", "Branch Management", "Branches"], ["admin_config", "Admin & Configuration", "Admin & Config"],
  ["marketing", "Marketing Management", "Marketing"], ["logistic_app", "Logistic App", "Logistic App"],
  ["patient_communication", "Patient Communication", "Patient Comms"],
];

// Topic groups; the other groups are fixed. A topic is saved as "<group>:<key>". `short` is the chip text.
export const FIXED_TOPIC_GROUPS = [
  {
    key: "tech", label: "Technical & Integration", topics: [
      ["analyser", "Analyser / machine integration", "Analyser"], ["his_emr", "HIS / EMR integration", "HIS / EMR"],
      ["api", "API & third-party integrations", "Integrations"], ["performance", "Performance & uptime", "Performance"],
      ["migration", "Data migration", "Migration"],
    ],
  },
  {
    key: "support", label: "Customer Support & Service", topics: [
      ["overall", "Support overall", "Support"], ["response_time", "Response time", "Response time"],
      ["resolution", "Resolution quality", "Resolution"], ["csm", "CSM / account manager", "CSM"],
      ["channels", "Support channels", "Channels"],
    ],
  },
  {
    key: "impl", label: "Implementation & Adoption", topics: [
      ["onboarding", "Onboarding", "Onboarding"], ["training", "Training", "Training"],
      ["golive", "Go-live experience", "Go-live"], ["adoption", "Team adoption", "Adoption"],
    ],
  },
  {
    key: "impact", label: "Business Impact & Value", topics: [
      ["tat", "Turnaround time (TAT)", "TAT"], ["billing", "Billing & revenue", "Billing"],
      ["cost", "Cost savings", "Cost savings"], ["patient", "Patient experience", "Patient exp."],
      ["growth", "Multi-centre growth", "Multi-centre"],
    ],
  },
  {
    key: "brand", label: "Relationship & Brand", topics: [
      ["trust", "Trust & partnership", "Trust"], ["recommend", "Would recommend", "Recommend"],
      ["long_term", "Long-term relationship", "Long-term"],
    ],
  },
];

// Every group with its topics as { key, label, short }.
export function topicGroups() {
  return [
    {
      key: "product", label: "Product & Module Experience",
      topics: [
        ...PRODUCT_TOPICS.map(([k, label, short]) => ({ key: `product:${k}`, label, short })),
      ],
    },
    ...FIXED_TOPIC_GROUPS.map((g) => ({ key: g.key, label: g.label, topics: g.topics.map(([k, label, short]) => ({ key: `${g.key}:${k}`, label, short })) })),
  ];
}

// "product:inventory" → { label, short, group } — a removed module keeps its key as the label.
export function topicInfo(key, modules = []) {
  for (const g of topicGroups()) {
    const t = g.topics.find((x) => x.key === key);
    if (t) return { ...t, group: g.label };
  }
  const mod = key?.startsWith("product:") && modules.find((m) => `product:${m.key}` === key);
  if (mod) return { key, label: mod.name, short: mod.name, group: "Product & Module Experience" };
  const raw = String(key || "").split(":").pop();
  return { key, label: raw, short: raw, group: key?.startsWith("product:") ? "Product & Module Experience" : "Other" };
}
