// The carriers that produce sales reports this module can parse — a
// distinct, smaller set than the flight-search/connector airlines
// elsewhere in the app (though UNITED/RANO/ENUGU/XEJET are also on the
// shared VARS/Videcom connector base for booking, per prisma/schema.prisma's
// AirlineKey enum). See src/modules/sales-reporting/core/types.ts
// (AIRLINE_RULE_KEYS) for the source of truth this must stay in sync with.
export const SALES_REPORT_AIRLINES: { key: string; label: string }[] = [
  { key: "AIRPEACE", label: "Air Peace" },
  { key: "AERO", label: "Aero Contractors" },
  { key: "IBOM", label: "Ibom Air" },
  { key: "ARIK", label: "Arik Air" },
  { key: "UNITED", label: "United Nigeria" },
  { key: "RANO", label: "Rano Air" },
  { key: "ENUGU", label: "Enugu" },
  { key: "XEJET", label: "Xejet" },
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
