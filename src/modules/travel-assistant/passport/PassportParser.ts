import { groqVisionJsonCompletion } from "../ai/groqClient";

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

It is NOT an ID document if it's a screenshot, invoice, report, ticket, boarding pass, or random unrelated photo — even if it happens to have a person's name printed on it. This explicitly includes any bank transfer receipt, payment confirmation, transaction receipt, or mobile-money receipt (Zenith, OPay, First Bank, or any other bank/fintech) — these always show a sender/beneficiary name and can look superficially similar to an ID, but they are financial records, never an identity document. If it is NOT an ID document, return exactly: {"isIdDocument": false}

If it IS an ID document, extract using the document's own LABELED FIELDS — this is the single most important rule. For a passport specifically: read whichever field is printed "Surname" / "Nom" and whichever is printed "Given Names" / "Prénoms" (or the MRZ's two equivalent zones) SEPARATELY, exactly as segmented on the document, and copy each verbatim in the order printed WITHIN that field. The labels on the document are the source of truth, not your own judgment — never infer, rearrange, or re-sort a name based on word order or what "looks like" a typical surname/given-name pattern. Never assume the LAST word of the Given Names field is actually the surname, and never move a word from Given Names into Surname (or vice versa) just because it seems unusual — a short or unfamiliar-looking surname (e.g. "SUO", "UDO", "YAU") is still exactly what's printed in the Surname field, and must be trusted as-is. Never just grab the biggest/most prominent text as the name either.
- "readable": true if the person's full name is clearly legible, false otherwise.
- "fullName": Surname followed by Given Names, in that order, exactly as segmented — e.g. Surname "SUO" + Given Names "GOODNESS IDISEIMOKUMO" → fullName "SUO GOODNESS IDISEIMOKUMO". Never reorder the words within Given Names.
- "firstName": the given name(s) ONLY, copied verbatim in their printed order — must NOT repeat, include, or start with the surname/lastName value in any form, and must NOT have its own word order changed.
- "lastName": the surname only, copied verbatim exactly as printed in the Surname field — trust it even if it's short or looks unfamiliar.
- "dateOfBirth": the date of birth as "YYYY-MM-DD" if this ID shows one and it's legible, otherwise null. Not every ID type shows a date of birth — that's fine, just use null.

Rules:
- A real ID document is issued BY A GOVERNMENT and has a PHOTO of the person's face printed on it. If there's no face photo and no government issuer, it is not an ID document — a bank logo, "Transaction Receipt"/"Successful"/an amount in Naira/a reference or session ID are all strong signals it's a payment receipt, not an ID, even without a face photo present to rule it out by.
- For a passport, prefer the MRZ (the two machine-readable OCR-B lines at the bottom of the bio page) for name/DOB when visible, since it's a standardized, reliably-readable fixed format — but if it disagrees with the printed name fields (e.g. truncation, hyphenation), the printed fields are authoritative for exact spelling, and the MRZ's own surname/given-names segmentation (before/after the first "<<") must be respected the same way, never re-ordered either.
- Double-check before answering: "firstName" must not contain the word(s) already in "lastName" — if you notice the surname bleeding into firstName, remove it before responding. Also double-check word order within firstName matches the Given Names field exactly.
- Never invent or guess a value — if the name cannot be read, use null for fullName/firstName/lastName and set "readable" to false.
- Return ONLY a JSON object, e.g.: {"isIdDocument": true, "readable": true, "fullName": "Suo Goodness Idiseimokumo", "firstName": "Goodness Idiseimokumo", "lastName": "Suo", "dateOfBirth": "1992-05-12"}`;

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

// Confirmed live: the vision model can echo the surname as a LEADING word
// of firstName too (e.g. lastName "ADESANYA", firstName "ADESANYA
// ADENRELE" instead of just "ADENRELE MUIDEEN") — assembled downstream as
// "SURNAME firstName", that duplication becomes "ADESANYA ADESANYA
// ADENRELE". Prompt-only guidance isn't reliable enough on its own (same
// reason every other extraction rule in this codebase gets a code-side
// check), so any leading word(s) of firstName that duplicate lastName are
// stripped here, deterministically, every time.
function stripDuplicateSurnameFromFirstName(firstName: string, lastName: string | null): string {
  if (!lastName) return firstName;
  const lastWords = new Set(lastName.trim().toLowerCase().split(/\s+/).filter(Boolean));
  let words = firstName.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && lastWords.has(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  return words.join(" ");
}

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

  // CORRECTED (2026-08-15, live): this used to swallow a genuine
  // groqVisionJsonCompletion failure (Groq rate-limited/unreachable, not a
  // judgment about the photo at all) into the same "fail closed to
  // isIdDocument:false" path a malformed-JSON response gets below —
  // confirmed live: a WhatsApp ID upload got NO reply at all, because
  // imageHandler.ts stays silent on a "not an ID/not a ticket" result by
  // design (never comments on unrelated photos), and this made a real
  // service failure indistinguishable from that. A genuine API/network
  // failure now propagates instead, so the caller's own catch block
  // (imageHandler.ts) sends an honest "I couldn't read that photo just
  // now" instead of silence. Only a response Groq actually returned but
  // couldn't be parsed as JSON (below) still fails closed silently — that
  // one genuinely says nothing about whether the photo was an ID.
  const raw = await groqVisionJsonCompletion(EXTRACTION_PROMPT, [dataUrl]);

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
  const lastName = str(parsed.lastName);
  const firstNameRaw = str(parsed.firstName);
  const firstName = firstNameRaw ? stripDuplicateSurnameFromFirstName(firstNameRaw, lastName) : firstNameRaw;

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
