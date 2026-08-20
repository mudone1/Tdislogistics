// Standalone test script — proves the Travelport sandbox connection works
// end-to-end (auth + one flight search). Run directly, not part of the
// normal connector-service server flow.
//
//   npx tsx src/travelport/testSearch.ts
//
// Reads TRAVELPORT_* env vars — see connector-service/.env.example.

import "dotenv/config";
import { getTravelportAccessToken } from "./travelportAuth";

async function main() {
  console.log("[travelport-test] Requesting OAuth token...");
  const token = await getTravelportAccessToken();
  console.log(`[travelport-test] Got token (${token.slice(0, 12)}...)`);

  const apiBase = process.env.TRAVELPORT_API_BASE;
  const accessGroup = process.env.TRAVELPORT_ACCESS_GROUP;
  const pcc = process.env.TRAVELPORT_PCC;

  if (!apiBase || !accessGroup) {
    throw new Error("Missing TRAVELPORT_API_BASE or TRAVELPORT_ACCESS_GROUP env vars");
  }

  // Simple one-way domestic Nigeria search: Lagos (LOS) -> Abuja (ABV),
  // one adult, departing 7 days from today. This is a minimal smoke test —
  // not tied to any specific airline yet, since GDS/NDC carrier content
  // access depends on what Travelport has actually provisioned for this
  // trial account (see the credentials email's GDS/NDC Carriers list).
  const departureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const searchUrl = `${apiBase.replace(/\/$/, "")}/catalog/search/catalogproductofferings`;

  const requestBody = {
    CatalogProductOfferingsQueryRequest: {
      CatalogProductOfferingsRequest: {
        "@type": "CatalogProductOfferingsRequestAir",
        offersPerPage: 5,
        contentSourceList: ["GDS"],
        PassengerCriteria: [{ number: 1, passengerTypeCode: "ADT" }],
        SearchCriteriaFlight: [
          {
            "@type": "SearchCriteriaFlight",
            departureDate,
            From: { value: "LOS" },
            To: { value: "ABV" },
          },
        ],
      },
    },
  };

  console.log(`[travelport-test] Searching LOS -> ABV on ${departureDate}...`);
  console.log(`[travelport-test] POST ${searchUrl}`);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json;version=11",
    XAUTH_TRAVELPORT_ACCESSGROUP: accessGroup,
  };
  if (pcc) headers["TVP-PCC-CORE"] = pcc;

  const res = await fetch(searchUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  const text = await res.text();
  console.log(`[travelport-test] Response status: ${res.status}`);

  if (!res.ok) {
    console.error(`[travelport-test] FAILED — response body:\n${text.slice(0, 2000)}`);
    process.exit(1);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`[travelport-test] Response was not valid JSON:\n${text.slice(0, 500)}`);
    process.exit(1);
  }

  const offerings =
    data?.CatalogProductOfferingsResponse?.CatalogProductOfferings?.CatalogProductOffering;

  if (!offerings || offerings.length === 0) {
    console.log(
      "[travelport-test] SUCCESS (auth + request both worked) but ZERO offers returned.\n" +
        "This likely means this trial account's content access doesn't include this " +
        "route/carrier combination yet — check the GDS/NDC Carriers list in your " +
        "Travelport credentials email against the airlines you're trying to search."
    );
    console.log("[travelport-test] Full response:\n", JSON.stringify(data, null, 2).slice(0, 3000));
    return;
  }

  console.log(`[travelport-test] SUCCESS — ${offerings.length} offer(s) returned:`);
  for (const offer of offerings) {
    console.log(`  - ${offer.Departure} -> ${offer.Arrival} (id: ${offer.id})`);
  }
}

main().catch((err) => {
  console.error("[travelport-test] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
