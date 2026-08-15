import { parseIdDocumentImage, type IdDocumentParseResult } from "./PassportParser";
import { parseTicketImage, type TicketParseResult } from "./TicketParser";

export type DocumentParseResult =
  | { kind: "ID"; id: IdDocumentParseResult }
  | { kind: "TICKET"; ticket: TicketParseResult }
  | { kind: "NONE" };

// Runs the ID check and the ticket check CONCURRENTLY rather than one after
// the other — each is its own independent vision call, so waterfalling them
// (try ID, then only if that fails try ticket) roughly doubles latency on
// every image that isn't an ID. checkTicket lets a caller skip the ticket
// call entirely when it isn't needed (e.g. a group chat image with no
// extract command attached), since that's a real request/cost saving, not
// just a latency one.
//
// allSettled, not all — parseIdDocumentImage/parseTicketImage now correctly
// THROW on a genuine vision-API failure (2026-08-15 fix; see their own
// comments) rather than silently returning "not detected". Promise.all
// would let one side's real failure discard the OTHER side's perfectly
// good, already-succeeded classification — e.g. the ID check hits a
// transient Groq error while the ticket check genuinely succeeds (or vice
// versa). Only propagate an error here when NEITHER check produced a
// usable result, so a real ID/ticket is still reported even if its sibling
// check happened to fail alongside it.
export async function parseUnknownDocumentImage(
  buffer: Buffer,
  mimeType: string,
  opts: { checkTicket: boolean }
): Promise<DocumentParseResult> {
  const [idResult, ticketResult] = await Promise.allSettled([
    parseIdDocumentImage(buffer, mimeType),
    opts.checkTicket
      ? parseTicketImage(buffer, mimeType)
      : Promise.resolve<TicketParseResult>({ isTicket: false, readable: false, passengerNames: [], pnr: null, ticketNumber: null }),
  ]);

  const id = idResult.status === "fulfilled" ? idResult.value : null;
  const ticket = ticketResult.status === "fulfilled" ? ticketResult.value : null;

  if (id?.isIdDocument) return { kind: "ID", id };
  if (ticket?.isTicket) return { kind: "TICKET", ticket };

  // Both checks came back with a real (non-throwing) answer, neither found
  // anything — genuinely not an ID or a ticket, stay silent as before.
  if (idResult.status === "fulfilled" && ticketResult.status === "fulfilled") {
    return { kind: "NONE" };
  }

  // At least one check never even got a real answer — surface the real
  // failure instead of pretending this was a confident "not detected".
  const failure = idResult.status === "rejected" ? idResult.reason : (ticketResult as PromiseRejectedResult).reason;
  throw failure instanceof Error ? failure : new Error(String(failure));
}
