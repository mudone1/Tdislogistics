// The four carriers that produce MCO invoice sales reports — a distinct,
// smaller set than the flight-search/connector airlines elsewhere in the
// app. See src/modules/sales-reporting/core/types.ts (AIRLINE_RULE_KEYS)
// for the source of truth this must stay in sync with.
export const SALES_REPORT_AIRLINES: { key: string; label: string }[] = [
  { key: "AIRPEACE", label: "Air Peace" },
  { key: "AERO", label: "Aero Contractors" },
  { key: "IBOM", label: "Ibom Air" },
  { key: "ARIK", label: "Arik Air" },
];

export function salesReportAirlineLabel(key: string): string {
  return SALES_REPORT_AIRLINES.find((a) => a.key === key)?.label ?? key;
}

// "DD/MM/YYYY" — the date format every sales-reporting API expects.
export function formatDDMMYYYY(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function todayDDMMYYYY(): string {
  return formatDDMMYYYY(new Date());
}
