// Travelport international flight search — production search function.
// Auth: see travelportAuth.ts (OAuth password grant, 24h token, cached).
//
// IMPORTANT CURRENCY NOTE: this Travelport trial account is provisioned in
// TRY (Turkish Lira) — see the credentials email's "Currency: TRY" field.
// Travelport does NOT do currency conversion for you; it returns prices in
// whatever currency the PCC/access group is configured for. Since the
// business needs NGN, we convert TRY -> NGN using a live exchange rate
// (see getTryToNgnRate below). When this moves to a production Travelport
// account, ask them to provision the PCC directly in NGN if supported —
// that removes the need for in-app conversion and its rate-staleness risk
// entirely. Nigeria-domestic carriers (P4/N2/W3/QI) are NOT in this
// account's GDS/NDC carrier list and will return zero offers regardless of
// route — that's a content-access gap, not a bug (see project notes).

import { getTravelportAccessToken } from "./travelportAuth";

export type CabinClass = "Economy" | "PremiumEconomy" | "Business" | "First";

export interface TravelportSearchParams {
  from: string; // IATA airport code, e.g. "LOS"
  to: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string; // YYYY-MM-DD, omit for one-way
  adults: number;
  children?: number; // ages 2-11
  infants?: number; // under 2, no seat
  cabinClass?: CabinClass; // defaults to Economy
  maxOffers?: number; // defaults to 10
}

export interface PassengerFareBreakdown {
  passengerType: "ADT" | "CNN" | "INF";
  count: number;
  baseFarePerPax: number;
  taxesPerPax: number;
  totalPerPax: number;
  subtotal: number; // totalPerPax * count
}

export interface TravelportFlightOffer {
  offerId: string;
  departureAirport: string;
  arrivalAirport: string;
  carrier: string;
  cabinClass: string;
  currency: string; // always "NGN" after conversion
  originalCurrency: string; // whatever Travelport actually priced in (e.g. "TRY")
  fxRateUsed: number;
  fareBreakdown: PassengerFareBreakdown[];
  grandTotal: number; // sum of all passenger subtotals, in NGN
  segments: {
    carrier: string;
    flightNumber: string;
    from: string;
    to: string;
    departureDate: string;
    departureTime: string;
    arrivalDate: string;
    arrivalTime: string;
  }[];
}

// Cabin class -> Travelport's cabin code. See SearchModifiersAir/CabinPreference.
const CABIN_CODE: Record<CabinClass, string> = {
  Economy: "Economy",
  PremiumEconomy: "PremiumEconomy",
  Business: "Business",
  First: "First",
};

// --- FX conversion -----------------------------------------------------
// Simple, dependency-free TRY -> NGN conversion using a public FX API.
// Cached in-process for 1 hour since rates don't need to be real-time-exact
// for display purposes, and we don't want to hit the FX API on every search.
let cachedRate: { rate: number; fetchedAt: number } | null = null;

async function getTryToNgnRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < 60 * 60 * 1000) {
    return cachedRate.rate;
  }
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/TRY");
    if (!res.ok) throw new Error(`FX API returned HTTP ${res.status}`);
    const data = (await res.json()) as { rates: Record<string, number> };
    const rate = data.rates?.NGN;
    if (!rate) throw new Error("NGN rate missing from FX API response");
    cachedRate = { rate, fetchedAt: Date.now() };
    return rate;
  } catch (err) {
    // Fail loudly rather than silently returning wrong prices — a broken
    // FX fetch should surface as a search error, not a wrong quote.
    throw new Error(
      `Failed to fetch TRY->NGN exchange rate: ${err instanceof Error ? err.message : err}`
    );
  }
}

// --- Search --------------------------------------------------------------

export async function searchTravelportFlights(
  params: TravelportSearchParams
): Promise<TravelportFlightOffer[]> {
  const token = await getTravelportAccessToken();
  const apiBase = process.env.TRAVELPORT_API_BASE;
  const accessGroup = process.env.TRAVELPORT_ACCESS_GROUP;
  const pcc = process.env.TRAVELPORT_PCC;

  if (!apiBase || !accessGroup) {
    throw new Error("Missing TRAVELPORT_API_BASE or TRAVELPORT_ACCESS_GROUP env vars");
  }

  const adults = params.adults ?? 1;
  const children = params.children ?? 0;
  const infants = params.infants ?? 0;
  const cabin = CABIN_CODE[params.cabinClass ?? "Economy"];

  const passengerCriteria: any[] = [{ number: adults, passengerTypeCode: "ADT" }];
  if (children > 0) passengerCriteria.push({ number: children, passengerTypeCode: "CNN" });
  if (infants > 0) passengerCriteria.push({ number: infants, passengerTypeCode: "INF" });

  const searchCriteriaFlight: any[] = [
    {
      "@type": "SearchCriteriaFlight",
      departureDate: params.departureDate,
      From: { value: params.from },
      To: { value: params.to },
    },
  ];
  if (params.returnDate) {
    searchCriteriaFlight.push({
      "@type": "SearchCriteriaFlight",
      departureDate: params.returnDate,
      From: { value: params.to },
      To: { value: params.from },
    });
  }

  const requestBody = {
    CatalogProductOfferingsQueryRequest: {
      CatalogProductOfferingsRequest: {
        "@type": "CatalogProductOfferingsRequestAir",
        offersPerPage: params.maxOffers ?? 10,
        contentSourceList: ["GDS"],
        PassengerCriteria: passengerCriteria,
        SearchCriteriaFlight: searchCriteriaFlight,
        SearchModifiersAir: {
          "@type": "SearchModifiersAir",
          CabinPreference: [{ "@type": "CabinPreference", cabin, preferenceType: "Permitted" }],
        },
      },
    },
  };

  const searchUrl = `${apiBase.replace(/\/$/, "")}/catalog/search/catalogproductofferings`;
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
  if (!res.ok) {
    throw new Error(`Travelport search failed: HTTP ${res.status} — ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  const response = data?.CatalogProductOfferingsResponse;
  const offerings = response?.CatalogProductOfferings?.CatalogProductOffering;
  const referenceList = response?.ReferenceList ?? [];

  if (!offerings || offerings.length === 0) {
    return [];
  }

  const fxRate = await getTryToNgnRate();

  // Build a lookup of Flight details from ReferenceList (carrier, times, etc.)
  // ReferenceList is an array of typed reference blocks; find the Flight one.
  const flightRefBlock = Array.isArray(referenceList)
    ? referenceList.find((r: any) => r["@type"] === "ReferenceListFlight")
    : referenceList?.["@type"] === "ReferenceListFlight"
    ? referenceList
    : null;
  const flightsById = new Map<string, any>();
  if (flightRefBlock?.Flight) {
    for (const f of flightRefBlock.Flight) flightsById.set(f.id, f);
  }

  const results: TravelportFlightOffer[] = [];

  for (const offering of offerings) {
    const brandOptions = offering.ProductBrandOptions?.[0];
    const brandOffering = brandOptions?.ProductBrandOffering?.[0];
    const price = brandOffering?.Price;
    if (!price) continue; // skip malformed/incomplete offer entries

    const originalCurrency = price.CurrencyCode?.value ?? "TRY";

    const fareBreakdown: PassengerFareBreakdown[] = [];
    let grandTotal = 0;

    for (const pb of price.PriceBreakdown ?? []) {
      const paxType = pb.requestedPassengerType as "ADT" | "CNN" | "INF";
      const count =
        paxType === "ADT" ? adults : paxType === "CNN" ? children : infants;
      if (count === 0) continue;

      const baseTry = Number(pb.Amount?.Base ?? 0);
      const taxesTry = Number(pb.Amount?.Taxes?.Total ?? 0);
      const totalTry = baseTry + taxesTry;

      const baseNgn = Math.round(baseTry * fxRate);
      const taxesNgn = Math.round(taxesTry * fxRate);
      const totalNgn = baseNgn + taxesNgn;

      fareBreakdown.push({
        passengerType: paxType,
        count,
        baseFarePerPax: baseNgn,
        taxesPerPax: taxesNgn,
        totalPerPax: totalNgn,
        subtotal: totalNgn * count,
      });
      grandTotal += totalNgn * count;
    }

    const segments = (brandOptions?.flightRefs ?? [])
      .map((flightId: string) => flightsById.get(flightId))
      .filter(Boolean)
      .map((f: any) => ({
        carrier: f.carrier,
        flightNumber: f.number,
        from: f.Departure?.location,
        to: f.Arrival?.location,
        departureDate: f.Departure?.date,
        departureTime: f.Departure?.time,
        arrivalDate: f.Arrival?.date,
        arrivalTime: f.Arrival?.time,
      }));

    results.push({
      offerId: offering.id,
      departureAirport: offering.Departure,
      arrivalAirport: offering.Arrival,
      carrier: segments[0]?.carrier ?? "",
      cabinClass: params.cabinClass ?? "Economy",
      currency: "NGN",
      originalCurrency,
      fxRateUsed: fxRate,
      fareBreakdown,
      grandTotal,
      segments,
    });
  }

  return results;
}
