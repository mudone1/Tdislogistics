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
export async function parseUnknownDocumentImage(
  buffer: Buffer,
  mimeType: string,
  opts: { checkTicket: boolean }
): Promise<DocumentParseResult> {
  const [id, ticket] = await Promise.all([
    parseIdDocumentImage(buffer, mimeType),
    opts.checkTicket
      ? parseTicketImage(buffer, mimeType)
      : Promise.resolve<TicketParseResult>({ isTicket: false, readable: false, passengerFullName: null, pnr: null }),
  ]);

  if (id.isIdDocument) return { kind: "ID", id };
  if (ticket.isTicket) return { kind: "TICKET", ticket };
  return { kind: "NONE" };
}
