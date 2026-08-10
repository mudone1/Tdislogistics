import * as XLSX from "xlsx";
import { groqVisionJsonCompletion } from "../../travel-assistant/ai/groqClient";
import { AIRLINE_RULE_KEYS, type AirlineRuleKey } from "../core/types";

export type DetectionMethod = "MANUAL" | "CONTENT" | "METADATA" | "VISION" | "UNKNOWN";

export interface AirlineMatch {
  airline: AirlineRuleKey;
  confidence: number;
}

export interface DetectionResult {
  airline: AirlineRuleKey | null;
  confidence: number; // 0-1
  method: DetectionMethod;
  reasoning: string[];
  requiresConfirmation: boolean; // true for 0.70-0.89 — show "I believe this is X, continue?"
  requiresUserSelection: boolean; // true for <0.70 — ask user to pick from a dropdown
  alternativeMatches: AirlineMatch[];
}

// The airlines that produce a sales report this module can parse (see
// AIRLINE_RULE_KEYS) — the wider AirlineKey enum used by the
// connector/sync side of the app also covers airlines with no
// sales-report flow. UNITED/RANO/ENUGU/XEJET's "ticket sales report"
// export has no free-text airline name anywhere in its cells (unlike the
// MCO Invoice Report's banner text), so detectByContent never matches
// these four — filename-based detectByMetadata is the only signal
// available for them today.
const AIRLINE_KEYWORDS: Record<AirlineRuleKey, string[]> = {
  AIRPEACE: ["air peace", "airpeace"],
  AERO: ["aero contractors", "aerocontractors", "aero"],
  IBOM: ["ibom air", "ibom"],
  ARIK: ["arik air", "arik"],
  UNITED: ["united nigeria", "united"],
  RANO: ["rano air", "rano"],
  ENUGU: ["enugu"],
  XEJET: ["xejet"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary matching, not a bare substring check — "arik" and "aero" are
// short enough to false-positive inside unrelated words/codes otherwise.
function matchKeywords(text: string): AirlineMatch[] {
  const matches: AirlineMatch[] = [];
  for (const [airline, keywords] of Object.entries(AIRLINE_KEYWORDS) as [AirlineRuleKey, string[]][]) {
    if (keywords.some((k) => new RegExp(`\\b${escapeRegExp(k)}\\b`, "i").test(text))) {
      matches.push({ airline, confidence: 0.93 });
    }
  }
  return matches;
}

function readExcelText(buffer: Buffer): string | null {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
    return matrix
      .flat()
      .filter((c) => c != null)
      .map(String)
      .join(" ")
      .toLowerCase();
  } catch {
    return null; // not a readable spreadsheet (e.g. an image upload) — other methods take over
  }
}

// Priority 1: scan the report's own text for an airline name. This is the
// strongest signal since it comes from the data itself, not a filename a
// user could have typed wrong.
function detectByContent(buffer: Buffer): AirlineMatch[] | null {
  const text = readExcelText(buffer);
  if (!text) return null;
  const matches = matchKeywords(text);
  return matches.length > 0 ? matches : null;
}

// Priority 2: filename keywords (e.g. "Aero_Daily_2024-07-24.xlsx"). Lower
// confidence than content since a filename can be renamed/mislabeled.
function detectByMetadata(filename: string): AirlineMatch[] | null {
  const matches = matchKeywords(filename.toLowerCase()).map((m) => ({ ...m, confidence: 0.72 }));
  return matches.length > 0 ? matches : null;
}

const VISION_DETECTION_PROMPT = `You are looking at a Nigerian airline sales report screenshot (either an MCO invoice report or a ticket sales report). Which airline is this report for? Reply with ONLY a JSON object: {"airline": "AIRPEACE" | "AERO" | "IBOM" | "ARIK" | "UNITED" | "RANO" | "ENUGU" | "XEJET" | "UNKNOWN"}`;

// Priority 3 (last resort, screenshots only): ask a vision model. Reuses the
// same Groq vision infra as ScreenshotParser rather than introducing a
// second AI provider just for this.
async function detectByVision(buffer: Buffer, mimeType: string): Promise<AirlineMatch | null> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  let raw: string;
  try {
    raw = await groqVisionJsonCompletion(VISION_DETECTION_PROMPT, [dataUrl]);
  } catch {
    return null; // vision unavailable/rate-limited — fall through to manual selection
  }

  let parsed: { airline?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const airline = parsed.airline?.toUpperCase();
  if (!airline || !AIRLINE_RULE_KEYS.includes(airline as AirlineRuleKey)) return null;

  return { airline: airline as AirlineRuleKey, confidence: 0.78 };
}

function withConfidenceTiers(
  best: AirlineMatch,
  method: DetectionMethod,
  reasoning: string[],
  alternatives: AirlineMatch[]
): DetectionResult {
  return {
    airline: best.airline,
    confidence: best.confidence,
    method,
    reasoning,
    requiresConfirmation: best.confidence >= 0.7 && best.confidence < 0.9,
    requiresUserSelection: best.confidence < 0.7,
    alternativeMatches: alternatives,
  };
}

const UNKNOWN_RESULT: DetectionResult = {
  airline: null,
  confidence: 0,
  method: "UNKNOWN",
  reasoning: ["Could not detect the airline from the file content, filename, or image — please select it manually"],
  requiresConfirmation: false,
  requiresUserSelection: true,
  alternativeMatches: [],
};

// Runs Content → Metadata → Vision in priority order, taking the first
// method whose best match clears the 70% auto-usable threshold. An explicit
// userHint (e.g. a value already picked in a dropdown or a prior turn) skips
// detection entirely — a human choice always outranks a guess.
export async function detectAirline(
  buffer: Buffer,
  filename?: string,
  mimeType?: string,
  userHint?: AirlineRuleKey
): Promise<DetectionResult> {
  if (userHint && AIRLINE_RULE_KEYS.includes(userHint)) {
    return {
      airline: userHint,
      confidence: 1,
      method: "MANUAL",
      reasoning: [`User selected ${userHint} explicitly`],
      requiresConfirmation: false,
      requiresUserSelection: false,
      alternativeMatches: [],
    };
  }

  const contentMatches = detectByContent(buffer);
  if (contentMatches) {
    const [best, ...alternatives] = contentMatches.sort((a, b) => b.confidence - a.confidence);
    if (best.confidence >= 0.7) {
      return withConfidenceTiers(
        best,
        "CONTENT",
        [`Found "${best.airline}" mentioned in the report content`],
        alternatives.slice(0, 2)
      );
    }
  }

  const metadataMatches = filename ? detectByMetadata(filename) : null;
  if (metadataMatches) {
    const [best, ...alternatives] = metadataMatches.sort((a, b) => b.confidence - a.confidence);
    if (best.confidence >= 0.7) {
      return withConfidenceTiers(
        best,
        "METADATA",
        [`Filename "${filename}" mentions "${best.airline}"`],
        alternatives.slice(0, 2)
      );
    }
  }

  if (mimeType?.startsWith("image/")) {
    const vision = await detectByVision(buffer, mimeType);
    if (vision && vision.confidence >= 0.7) {
      return withConfidenceTiers(vision, "VISION", [`Vision model identified the report as ${vision.airline}`], []);
    }
  }

  // Nothing cleared 70% — surface the best low-confidence guess (if any) so
  // the user selection prompt can still default to it, rather than a bare
  // "unknown" with no suggestion at all.
  const fallback = contentMatches?.[0] ?? metadataMatches?.[0] ?? null;
  if (fallback) {
    return withConfidenceTiers(
      fallback,
      contentMatches ? "CONTENT" : "METADATA",
      [`Low-confidence match: "${fallback.airline}"`],
      []
    );
  }

  return UNKNOWN_RESULT;
}
