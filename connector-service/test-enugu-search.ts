import { searchEnuguAirFlights } from "../src/modules/travel-assistant/search/enugu/EnuguAirSearch";

async function main() {
  const query = {
    origin: "ABV",
    destination: "LOS",
    date: "2026-07-19",
  };

  console.log(`Searching Enugu Air: ${query.origin} -> ${query.destination} on ${query.date}...\n`);

  const result = await searchEnuguAirFlights(query);

  console.log(`Found ${result.options.length} flight option(s):\n`);
  for (const opt of result.options) {
    console.log(
      `  ${opt.flightNumber || "?"} - ${opt.departureTime} -> ${opt.arrivalTime || "?"} on ${opt.date} - ` +
        `${opt.durationMinutes || "?"} min - ` +
        `${opt.fare != null ? opt.fare.toLocaleString() + " " + opt.currency : "price unavailable"} ` +
        `(${opt.seatStatus || "status unknown"})`
    );
  }
}

main().catch((err) => {
  console.error("Search failed:", err);
  process.exit(1);
});
