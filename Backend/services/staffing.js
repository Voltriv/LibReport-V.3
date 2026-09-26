'use strict';

// Turns visit aggregates into a staffing recommendation for the tracker page.
//
// Presentation logic rather than data access: it takes the hourly and per-weekday
// buckets the caller already aggregated and derives peaks, busy days and prose.

const STAFFING_LOOKBACK_DAYS = 7;
const DEFAULT_VISITS_PER_STAFF = 20;
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildStaffingRecommendations(hourlyBuckets = [], dayBuckets = [], options = {}) {
  const lookbackDays = Math.max(1, options.lookbackDays ?? STAFFING_LOOKBACK_DAYS);
  const visitsPerStaff = Math.max(1, options.visitsPerStaff ?? DEFAULT_VISITS_PER_STAFF);

  const totalVisits = hourlyBuckets.reduce((acc, item) => acc + Number(item?.count || 0), 0);
  const avgDailyVisits = totalVisits / lookbackDays;

  const peakHours = hourlyBuckets
    .filter((item) => Number.isFinite(item?.hour) && item.count > 0)
    .map((item) => {
      const hour = Number(item.hour);
      const avg = Number(item.count || 0) / lookbackDays;
      const padded = String(hour).padStart(2, '0');
      const endHour = (hour + 1) % 24;
      return {
        hour,
        label: `${padded}:00 - ${String(endHour).padStart(2, '0')}:00`,
        avgVisits: Number(avg.toFixed(1)),
        recommendedStaff: Math.max(1, Math.ceil(avg / visitsPerStaff))
      };
    })
    .sort((a, b) => b.avgVisits - a.avgVisits)
    .slice(0, 3);

  const approxWeeks = Math.max(1, Math.round(lookbackDays / 7) || 1);
  const busyDays = dayBuckets
    .filter((item) => Number.isFinite(item?.dow))
    .map((item) => {
      const dow = Number(item.dow);
      const idx = ((dow || 1) - 1 + 7) % 7;
      const avg = Number(item.count || 0) / approxWeeks;
      return {
        dow: idx,
        label: DAY_LABELS[idx],
        avgVisits: Number(avg.toFixed(1))
      };
    })
    .sort((a, b) => b.avgVisits - a.avgVisits)
    .slice(0, 3);

  const recommendations = [];
  if (peakHours.length > 0) {
    const top = peakHours[0];
    recommendations.push(
      `Plan for at least ${top.recommendedStaff} staff between ${top.label} to handle roughly ${top.avgVisits} visits.`
    );
  }
  if (busyDays.length > 0) {
    const labels = busyDays.map((item) => item.label);
    const formatted =
      labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.slice(-1)}`;
    recommendations.push(`Expect higher footfall on ${formatted}. Consider staggered breaks those days.`);
  }
  if (avgDailyVisits > visitsPerStaff * 3) {
    recommendations.push(
      `Average daily visits (~${Number(avgDailyVisits.toFixed(1))}) exceed the safe capacity of a ${visitsPerStaff}-visit staffing band. Evaluate adding coverage during peaks.`
    );
  }

  return {
    lookbackDays,
    visitsPerStaff,
    averageDailyVisits: Number(avgDailyVisits.toFixed(1)),
    totalVisits,
    peakHours,
    busyDays,
    recommendations
  };
}

module.exports = {
  STAFFING_LOOKBACK_DAYS,
  DEFAULT_VISITS_PER_STAFF,
  DAY_LABELS,
  buildStaffingRecommendations
};
