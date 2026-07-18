// Standalone test for Enugu Air guest flight search — no login, no
// deployment needed. Run from inside connector-service/ (needs its
// installed playwright + tsx):
//
//   cd connector-service
//   npx tsx test-enugu-search.ts

import { searchEnuguAirFlights } from "../src/modules/travel-assistant/search/enugu/EnuguAirSearch";

async function main() {
  // Edit these to try a different route/date.
  const query = {
    origin: "ABV", // Abuja
    destination: "LOS", // Lagos
    date: "2026-08-15", // YYYY-MM-DD — pick any real future date
  };

  console.log(`Searching Enugu Air: ${query.origin} -> ${query.destination} on ${query.date}...\n`);

  const result = await searchEnuguAirFlights(query);

  console.log(`Found ${result.options.length} flight option(s):\n`);
  for (const opt of result.options) {
    console.log(
      `  ${opt.departureTime} on ${opt.date} — ${opt.durationMinutes ?? "?"} min — ` +
        `${opt.fare != null ? opt.fare.toLocaleString() + " " + opt.currency : "price unavailable"} ` +
        `(${opt.seatStatus ?? "status unknown"})`
    );
    console.log(`    raw: "${opt.raw}"`);
  }
}

main().catch((err) => {
  console.error("Search failed:", err);
  process.exit(1);
});
