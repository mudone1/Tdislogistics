import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const NAVY = "#184F73";
const GRAY = "#8A98A6";
const BG = "#F8FAFC";

interface QuoteRow {
  airline: string;
  fare: number | null;
  seatStatus: string | null;
  cabin: string;
  baggage: string | null;
  refundPolicy: string | null;
  seatsLeft: number | null;
}

interface QuoteLeg {
  label: string;
  origin: string;
  destination: string;
  date: string;
  rows: QuoteRow[];
}

interface QuoteImagePayload {
  legs: QuoteLeg[];
  generatedAt: string;
}

// "NGN", not the ₦ glyph — satori's default font used by ImageResponse
// doesn't include the Naira currency character, rendering it as a
// missing-glyph box. Real browsers render ₦ fine, so the in-app card
// (FlightCards.tsx) keeps the symbol; this is only for the exported image.
function formatNaira(amount: number): string {
  return `NGN ${amount.toLocaleString()}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function availabilityText(row: QuoteRow): string {
  if (row.seatsLeft != null) return `${row.seatsLeft} seat${row.seatsLeft === 1 ? "" : "s"} left`;
  return row.fare != null ? "Available" : "Sold out";
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await renderQuoteImage(req);
  } catch (err) {
    console.error("[assistant/quote-image] failed:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function renderQuoteImage(req: NextRequest): Promise<Response> {
  const body = (await req.json()) as QuoteImagePayload;
  const legs = body.legs ?? [];
  const generatedAt = body.generatedAt || new Date().toISOString();
  const logo = `${req.nextUrl.origin}/icons/icon-192.png`;

  const estimatedHeight = 230 + legs.reduce((sum, leg) => sum + 80 + leg.rows.length * 110, 0) + 80;
  const height = Math.max(700, Math.min(2400, estimatedHeight));

  // Every <div> below sets an explicit `display` — satori (the renderer
  // behind next/og's ImageResponse) throws if a multi-child <div> lacks
  // one, and it's simplest to just always declare it rather than track
  // which nodes happen to have more than one child.
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: BG,
          padding: 48,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            borderBottom: `3px solid ${NAVY}`,
            paddingBottom: 24,
            marginBottom: 32,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="TDIS Logistics" width={64} height={64} style={{ objectFit: "contain", borderRadius: 12 }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: NAVY }}>TDIS Flight Quote</div>
            <div style={{ display: "flex", fontSize: 18, color: GRAY }}>{`Generated ${formatDateTime(generatedAt)}`}</div>
          </div>
        </div>

        {legs.map((leg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 16 }}>
              {leg.label ? (
                <div
                  style={{
                    display: "flex",
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#ffffff",
                    background: NAVY,
                    padding: "4px 16px",
                    borderRadius: 999,
                  }}
                >
                  {leg.label}
                </div>
              ) : null}
              <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: NAVY }}>
                {`${leg.origin} → ${leg.destination}`}
              </div>
              <div style={{ display: "flex", fontSize: 18, color: GRAY }}>{leg.date}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {leg.rows.map((row, j) => (
                <div
                  key={j}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "#ffffff",
                    border: "1px solid #E9ECF1",
                    borderRadius: 16,
                    padding: "18px 24px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: NAVY }}>{row.airline}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div
                        style={{
                          display: "flex",
                          fontSize: 14,
                          fontWeight: 600,
                          color: NAVY,
                          background: "#EEF2F5",
                          padding: "3px 14px",
                          borderRadius: 999,
                        }}
                      >
                        {row.cabin}
                      </div>
                      <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: NAVY }}>
                        {row.fare != null ? formatNaira(row.fare) : row.seatStatus ?? "Unavailable"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 28, marginTop: 12, fontSize: 15, color: GRAY }}>
                    <div style={{ display: "flex" }}>{row.baggage ?? "Baggage info unavailable"}</div>
                    <div style={{ display: "flex" }}>{row.refundPolicy ?? "Fare condition unavailable"}</div>
                    <div style={{ display: "flex" }}>{availabilityText(row)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            fontSize: 15,
            color: GRAY,
            borderTop: "1px solid #E9ECF1",
            paddingTop: 18,
          }}
        >
          Quote valid for 24 hours from generation — fares subject to change without notice.
        </div>
      </div>
    ),
    { width: 1080, height }
  );
}
