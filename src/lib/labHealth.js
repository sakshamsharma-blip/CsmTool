// "Lab Health" — a health signal derived purely from logged visit/check-in sentiment, kept
// deliberately separate from the manual health_status set via "Log Health Check" (lib/pulse.js).
// The manual field is a CSM's own periodic judgment call; this one is computed automatically
// from every sentiment a CSM already records while logging a visit or check-in, so it never
// needs an extra step and can't go stale just because nobody remembered to log a pulse check.
// If the two disagree, that's itself a useful flag — not a bug to reconcile.

export const SENTIMENT_SCORE = { Positive: 100, Neutral: 50, "At Risk": 0 };

// How many of the most recent sentiment-tagged visits count as "recent" for the trend read.
// Visits/check-ins get logged often enough that a window of just 2-3 would swing on noise —
// 5 gives a real trend without going stale for months on an old souring relationship.
export const RECENT_WINDOW = 5;

// Blend weights for the final bucketed score: mostly recent (so a real, current trend shows up
// fast) but with a meaningful all-time anchor (so one rough week right after a long healthy
// history doesn't instantly flip the bucket).
const ALL_TIME_WEIGHT = 0.4;
const RECENT_WEIGHT = 0.6;

export function healthBucket(score) {
  if (score == null) return "Not Assessed";
  if (score >= 75) return "Healthy";
  if (score >= 40) return "Needs Attention";
  return "At Risk";
}

export const HEALTH_BUCKET_COLORS = {
  Healthy: "var(--ok)",
  "Needs Attention": "var(--warn)",
  "At Risk": "var(--bad)",
  "Not Assessed": "var(--text-faint)",
};

// visits: this one lab's visit records (any shape with .sentiment and .visitDate — matches
// lib/visits.js's fetchAllVisits() output). Only visits with a set sentiment count; a plain
// Log Visit with no sentiment picked simply doesn't contribute either way.
export function computeSentimentHealth(visits, recentWindow = RECENT_WINDOW) {
  const scored = (visits || [])
    .filter((v) => v.sentiment && SENTIMENT_SCORE[v.sentiment] != null)
    .slice()
    .sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));

  if (!scored.length) {
    return { bucket: "Not Assessed", allTimeAvg: null, recentAvg: null, score: null, sampleSize: 0 };
  }

  const allTimeAvg = scored.reduce((s, v) => s + SENTIMENT_SCORE[v.sentiment], 0) / scored.length;
  const recentSlice = scored.slice(0, recentWindow);
  const recentAvg = recentSlice.reduce((s, v) => s + SENTIMENT_SCORE[v.sentiment], 0) / recentSlice.length;
  const score = allTimeAvg * ALL_TIME_WEIGHT + recentAvg * RECENT_WEIGHT;

  return { bucket: healthBucket(score), allTimeAvg, recentAvg, score, sampleSize: scored.length };
}
