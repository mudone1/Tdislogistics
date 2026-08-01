import { openaiVisionJsonCompletion } from "../ai/openaiClient";

export interface PassportParseResult {
  isPassport: boolean;
  readable: boolean;
  fullName: string | null; // verbatim as printed, for the reply text
  firstName: string | null; // model-split, not client string-split — see prompt
  lastName: string | null;
  dateOfBirth: string | null; // ISO YYYY-MM-DD
}

// One combined classify+extract vision call, not a separate classification
// call first — cost/latency. Asks for firstName/lastName as SEPARATE fields
// rather than a fullName the server string-splits: a passport's printed
// "Surname"/"Given Names" are already segmented, and Nigerian given-names
// routinely contain 2-3 names, so parroting back already-split fields is far
// more reliable than a naive split on a name the model invented.
const EXTRACTION_PROMPT = `You are looking at a photo. Determine whether it is a passport bio (identity) page.

If it is NOT a passport, return exactly: {"isPassport": false}

If it IS a passport, extract:
- "readable": true if the name and date of birth are both clearly legible, false otherwise.
- "fullName": the passenger's full name exactly as printed (Given Names + Surname, in natural reading order), preserving exact spelling.
- "firstName": the given name(s) only, exactly as printed in the "Given Names" field.
- "lastName": the surname only, exactly as printed in the "Surname" field.
- "dateOfBirth": the date of birth as "YYYY-MM-DD", or null if unreadable.

Rules:
- Prefer the MRZ (the two machine-readable OCR-B lines at the bottom of the bio page) for name/DOB when visible, since it's a standardized, reliably-readable fixed format — but if it disagrees with the printed "Given Names"/"Surname" fields (e.g. truncation, hyphenation), the printed fields are authoritative for exact spelling.
- Never invent or guess a value — if a field cannot be read, use null and set "readable" to false.
- Return ONLY a JSON object, e.g.: {"isPassport": true, "readable": true, "fullName": "John Michael Doe", "firstName": "John Michael", "lastName": "Doe", "dateOfBirth": "1992-05-12"}`;

interface VisionResult {
  isPassport?: unknown;
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

const NOT_A_PASSPORT: PassportParseResult = {
  isPassport: false,
  readable: false,
  fullName: null,
  firstName: null,
  lastName: null,
  dateOfBirth: null,
};

export async function parsePassportImage(buffer: Buffer, mimeType: string): Promise<PassportParseResult> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  let raw: string;
  try {
    raw = await openaiVisionJsonCompletion(EXTRACTION_PROMPT, [dataUrl]);
  } catch {
    // A parse/API failure says nothing about whether this was actually a
    // passport — fail closed to isPassport:false rather than telling the
    // user their (possibly unrelated) image needs a clearer photo.
    return NOT_A_PASSPORT;
  }

  let parsed: VisionResult;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NOT_A_PASSPORT;
  }

  if (parsed.isPassport !== true) return NOT_A_PASSPORT;

  const dateOfBirthRaw = str(parsed.dateOfBirth);
  const dateOfBirth = dateOfBirthRaw && ISO_DATE_RE.test(dateOfBirthRaw) ? dateOfBirthRaw : null;
  const fullName = str(parsed.fullName);
  const firstName = str(parsed.firstName);
  const lastName = str(parsed.lastName);

  const readable = parsed.readable === true && !!fullName && !!dateOfBirth;

  return {
    isPassport: true,
    readable,
    fullName,
    firstName,
    lastName,
    dateOfBirth,
  };
}
