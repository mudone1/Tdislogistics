import { NextResponse } from "next/server";
import { checkDuplicate } from "@/modules/sales-reporting/services/DuplicateCheckService";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "@/modules/sales-reporting/core/types";

export const runtime = "nodejs";

interface CheckDuplicatePayload {
  airline?: string;
  reportDate?: string; // "DD/MM/YYYY"
  sales?: number;
  tickets?: number;
  fileHash?: string;
}

// JSON body: { airline, reportDate, sales, tickets, fileHash? }. Standalone
// duplicate check for the chatbot upload flow, called after airline
// detection/confirmation and before /generate so the UI can show a
// duplicate dialog ("View" / "Overwrite" / "Cancel") without creating a
// report first.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as CheckDuplicatePayload | null;
  if (!body) {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const { airline, reportDate, sales, tickets, fileHash } = body;
  if (typeof airline !== "string" || !AIRLINE_RULE_KEYS.includes(airline as AirlineRuleKey)) {
    return NextResponse.json({ error: `"airline" must be one of ${AIRLINE_RULE_KEYS.join(", ")}` }, { status: 400 });
  }
  if (typeof reportDate !== "string") {
    return NextResponse.json({ error: '"reportDate" ("DD/MM/YYYY") is required' }, { status: 400 });
  }
  if (typeof sales !== "number" || typeof tickets !== "number") {
    return NextResponse.json({ error: '"sales" and "tickets" must be numbers' }, { status: 400 });
  }

  try {
    const match = await checkDuplicate(airline as AirlineRuleKey, reportDate, sales, tickets, fileHash);
    return NextResponse.json({ isDuplicate: match != null, existingReport: match?.existingReport, matchFactors: match?.matchFactors });
  } catch (err) {
    console.error("[sales-reports/check-duplicate] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
