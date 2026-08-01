import { openaiVisionJsonCompletion } from "../ai/openaiClient";

export interface IdDocumentParseResult {
  isIdDocument: boolean;
  readable: boolean;
  fullName: string | null; // verbatim as printed, for the reply text
  firstName: string | null; // model-split, not client string-split — see prompt
  lastName: string | null;
  dateOfBirth: string | null; // ISO YYYY-MM-DD, null if this ID type doesn't show one or it's unreadable
}

// One combined classify+extract vision call, not a separate classification
// call first — cost/latency. Asks for firstName/lastName as SEPARATE fields
// rather than a fullName the server string-splits: an ID's printed
// "Surname"/"Given Names" are already segmented, and Nigerian given-names
// routinely contain 2-3 names, so parroting back already-split fields is far
// more reliable than a naive split on a name the model invented.
//
// Deliberately broad — passport, National ID (NIN slip), driver's license,
// voter's card, or any other government-issued photo ID — NOT just
// passports, so a photo of whichever ID the passenger has on hand works.
// Still gated on "official photo ID", not "any image with text on it": an
// MCO invoice screenshot also has a name printed on it (e.g.
// "TDISLOGIST-FLORENCE AINA"), and must keep falling through to the
// sales-report flow instead of being swallowed here.
const EXTRACTION_PROMPT = `You are looking at a photo. Determine whether it is an official government-issued photo ID card belonging to a person — e.g. a passport bio page, National ID card (NIN slip), driver's license, or voter's card.

It is NOT an ID document if it's a screenshot, invoice, report, ticket, boarding pass, receipt, or random unrelated photo — even if it happens to have a person's name printed on it. If it is NOT an ID document, return exactly: {"isIdDocument": false}

If it IS an ID document, extract:
- "readable": true if the person's full name is clearly legible, false otherwise.
- "fullName": the person's full name exactly as printed (in natural reading order), preserving exact spelling.
- "firstName": the given name(s) only.
- "lastName": the surname only.
- "dateOfBirth": the date of birth as "YYYY-MM-DD" if this ID shows one and it's legible, otherwise null. Not every ID type shows a date of birth — that's fine, just use null.

Rules:
- For a passport, prefer the MRZ (the two machine-readable OCR-B lines at the bottom of the bio page) for name/DOB when visible, since it's a standardized, reliably-readable fixed format — but if it disagrees with the printed name fields (e.g. truncation, hyphenation), the printed fields are authoritative for exact spelling.
- Never invent or guess a value — if the name cannot be read, use null for fullName/firstName/lastName and set "readable" to false.
- Return ONLY a JSON object, e.g.: {"isIdDocument": true, "readable": true, "fullName": "John Michael Doe", "firstName": "John Michael", "lastName": "Doe", "dateOfBirth": "1992-05-12"}`;

interface VisionResult {
  isIdDocument?: unknown;
  readable?: unknown;
  fullName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  dateOfBirth?: unknown;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NOT_AN_ID_DOCUMENT: IdDocumentParseResult = {
  isIdDocument: false,
  readable: false,
  fullName: null,
  firstName: null,
  lastName: null,
  dateOfBirth: null,
};

export async function parseIdDocumentImage(buffer: Buffer, mimeType: string): Promise<IdDocumentParseResult> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  let raw: string;
  try {
    raw = await openaiVisionJsonCompletion(EXTRACTION_PROMPT, [dataUrl]);
  } catch {
    // A parse/API failure says nothing about whether this was actually an
    // ID document — fail closed to isIdDocument:false rather than telling
    // the user their (possibly unrelated) image needs a clearer photo.
    return NOT_AN_ID_DOCUMENT;
  }

  let parsed: VisionResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NOT_AN_ID_DOCUMENT;
  }

  if (parsed.isIdDocument !== true) return NOT_AN_ID_DOCUMENT;

  const dateOfBirthRaw = str(parsed.dateOfBirth);
  const dateOfBirth = dateOfBirthRaw && ISO_DATE_RE.test(dateOfBirthRaw) ? dateOfBirthRaw : null;
  const fullName = str(parsed.fullName);
  const firstName = str(parsed.firstName);
  const lastName = str(parsed.lastName);

  // Readability hinges on the name alone — not every ID type carries a
  // date of birth, and the user only needs the name reliably extracted.
  const readable = parsed.readable === true && !!fullName;

  return {
    isIdDocument: true,
    readable,
    fullName,
    firstName,
    lastName,
    dateOfBirth,
  };
}
