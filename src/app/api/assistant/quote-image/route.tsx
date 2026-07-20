import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

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

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString()}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json()) as QuoteImagePayload;
  const legs = body.legs ?? [];
  const generatedAt = body.generatedAt || new Date().toISOString();
  // Fetched over HTTP (same origin) rather than read from the filesystem —
  // `public/` isn't reliably included in the serverless function's file
  // trace for a dynamically-joined path, which was causing this route to
  // 500 on Vercel (readFile silently failing at runtime).
  const logo = `${req.nextUrl.origin}/images/Tdis_logo.jpeg`;

  const estimatedHeight = 230 + legs.reduce((sum, leg) => sum + 80 + leg.rows.length * 110, 0) + 80;
  const height = Math.max(700, Math.min(2400, estimatedHeight));

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
          <img src={logo} alt="TDIS Logistics" width={110} height={57} style={{ objectFit: "contain" }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: NAVY }}>TDIS Flight Quote</div>
            <div style={{ fontSize: 18, color: GRAY }}>Generated {formatDateTime(generatedAt)}</div>
          </div>
        </div>

        {legs.map((leg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 16 }}>
              {leg.label ? (
                <div
                  style={{
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
              <div style={{ fontSize: 26, fontWeight: 700, color: NAVY }}>
                {leg.origin} → {leg.destination}
              </div>
              <div style={{ fontSize: 18, color: GRAY }}>{leg.date}</div>
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
                    <div style={{ fontSize: 22, fontWeight: 700, color: NAVY }}>{row.airline}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div
                        style={{
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
                      <div style={{ fontSize: 26, fontWeight: 800, color: NAVY }}>
                        {row.fare != null ? formatNaira(row.fare) : row.seatStatus ?? "Unavailable"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 28, marginTop: 12, fontSize: 15, color: GRAY }}>
                    <div>{row.baggage ?? "Baggage info unavailable"}</div>
                    <div>{row.refundPolicy ?? "Fare condition unavailable"}</div>
                    <div>
                      {row.seatsLeft != null
                        ? `${row.seatsLeft} seat${row.seatsLeft === 1 ? "" : "s"} left`
                        : row.fare != null
                          ? "Available"
                          : "Sold out"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div
          style={{
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
