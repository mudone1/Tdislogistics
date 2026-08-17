// Africa/Lagos is UTC+1 year-round (no daylight saving) — computing the
// Lagos calendar day for a given instant, and "today"/"yesterday" in Lagos
// time, in exactly one place so every deposit-tracking module (screenshot
// ingestion, report generation, the eventual Phase 2 scheduler) agrees on
// the same day boundary. Deliberately uses Intl's timeZone-aware
// formatting rather than manual UTC+1 offset math — self-documenting, and
// stays correct even if that assumption ever needs to change (Lagos has no
// DST today, but this doesn't rely on remembering that anywhere else).
//
// Per the spec's own explicit emphasis: the reporting boundary is 1am
// Lagos time (or 6am for the eventual auto-report), NOT midnight — a
// payment posted at 12:30am on 12 Aug belongs to 12 Aug, not 11 Aug. That
// only matters for the FUTURE scheduled-report boundary logic (Phase 2,
// not built yet); a deposit's own depositDateLagos is always just "which
// Lagos calendar day was it received in", computed here.
const LAGOS_TZ = "Africa/Lagos";

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LAGOS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" for the given instant (default: now), as a Lagos calendar day. */
export function lagosDateString(at: Date = new Date()): string {
  // en-CA locale formats as YYYY-MM-DD directly — avoids a manual
  // reassembly step that's easy to get subtly wrong (e.g. swapping which
  // formatted part is month vs. day).
  return isoFormatter.format(at);
}

/** Today's Lagos calendar day, as "YYYY-MM-DD". */
export function lagosToday(): string {
  return lagosDateString();
}

/** Yesterday's Lagos calendar day, as "YYYY-MM-DD" — for the Phase 2 report. */
export function lagosYesterday(): string {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return lagosDateString(oneDayAgo);
}

/** "DD/MM/YYYY" display format used in the report header, from a "YYYY-MM-DD" input. */
export function toDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * The instant midnight Lagos time began for a given "YYYY-MM-DD" Lagos
 * calendar day, as a UTC Date — for querying a UTC-timestamped table
 * (AirlineBalanceHistory.retrievedAt) for "the most recent sync BEFORE
 * this day's opening balance was set". Safe to build the ISO string with
 * a fixed "+01:00" offset directly (rather than round-tripping through
 * Intl again) for the same reason the rest of this file doesn't do manual
 * UTC+1 math elsewhere: Lagos has no DST, so this offset never changes —
 * documented here once rather than assumed silently at every call site.
 */
export function lagosDayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+01:00`);
}
