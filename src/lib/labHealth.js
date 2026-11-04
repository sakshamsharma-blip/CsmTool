// The rules live in supabase/functions/_shared/labHealth.js, so the app and the Claude connector always agree.
export * from "../../supabase/functions/_shared/labHealth.js";

export const HEALTH_BUCKET_COLORS = {
  Healthy: "var(--ok)",
  "Needs Attention": "var(--warn)",
  "At Risk": "var(--bad)",
  "Not Assessed": "var(--text-faint)",
};
