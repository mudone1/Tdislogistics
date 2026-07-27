import { NextResponse } from "next/server";
import { getBalanceUpdateStatus } from "@/lib/balanceUpdateService";

// GET ?since=<ISO timestamp from /trigger> — polled until "ready" is true
// (every airline's balance synced more recently than "since") or the
// caller's own poll budget runs out, whichever comes first.
export async function GET(req: Request) {
  const since = new URL(req.url).searchParams.get("since");
  if (!since) {
    return NextResponse.json({ error: '"since" query param is required' }, { status: 400 });
  }

  try {
    const result = await getBalanceUpdateStatus(since);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[balance-update/status] failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
