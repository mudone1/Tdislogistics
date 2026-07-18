import { AIRPORT_ALIASES, AIRPORT_NAMES_BY_LENGTH } from "./aliases";

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseFlightQuery(rawText) {
  const text = rawText.toLowerCase().replace(/\s+/g, " ").trim();

  const { origin, destination, confidence } = extractRoute(text);
  const date = extractDate(text);

  return { origin, destination, date, confidence };
}

function extractRoute(text) {
  const fromToMatch = text.match(/from\s+([a-z\s-]+?)\s+to\s+([a-z\s-]+?)(?:\s|$|\d|,|\.)/);
  if (fromToMatch) {
    const origin = matchAirport(fromToMatch[1]);
    const destination = matchAirport(fromToMatch[2]);
    if (origin && destination) return { origin, destination, confidence: "high" };
  }

  const toMatch = text.match(/\b([a-z\s-]+?)\s+to\s+([a-z\s-]+?)(?:\s|$|\d|,|\.)/);
  if (toMatch) {
    const origin = matchAirport(toMatch[1]);
    const destination = matchAirport(toMatch[2]);
    if (origin && destination) return { origin, destination, confidence: "high" };
  }

  const dashSlashMatch = text.match(/\b([a-z]+)\s*[-/]\s*([a-z]+)\b/);
  if (dashSlashMatch) {
    const origin = matchAirport(dashSlashMatch[1]);
    const destination = matchAirport(dashSlashMatch[2]);
    if (origin && destination) return { origin, destination, confidence: "high" };
  }

  const matches = [];
  for (const name of AIRPORT_NAMES_BY_LENGTH) {
    const regex = new RegExp(`\\b${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "g");
    let m;
    while ((m = regex.exec(text)) !== null) {
      matches.push({ index: m.index, code: AIRPORT_ALIASES[name] });
    }
  }
  matches.sort((a, b) => a.index - b.index);
  const deduped = [];
  for (const m of matches) {
    if (!deduped.some((d) => Math.abs(d.index - m.index) < 2)) deduped.push(m);
  }

  if (deduped.length >= 2) {
    return { origin: deduped[0].code, destination: deduped[1].code, confidence: "low" };
  }
  if (deduped.length === 1) {
    return { origin: deduped[0].code, destination: null, confidence: "low" };
  }
  return { origin: null, destination: null, confidence: "low" };
}

function matchAirport(fragment) {
  const cleaned = fragment.trim();
  if (!cleaned) return null;

  const found = [];
  for (const name of AIRPORT_NAMES_BY_LENGTH) {
    const idx = cleaned.lastIndexOf(name);
    if (idx === -1) continue;
    const before = cleaned[idx - 1];
    const after = cleaned[idx + name.length];
    const boundaryOk = (before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after));
    if (boundaryOk) found.push({ index: idx, code: AIRPORT_ALIASES[name] });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.index - b.index);
  return found[found.length - 1].code;
}

function extractDate(text) {
  const now = new Date();

  if (/\btoday\b/.test(text)) {
    return toISO(now);
  }
  if (/\btomorrow\b/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return toISO(d);
  }

  const dateWordMatch = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/
  );
  if (dateWordMatch) {
    const day = parseInt(dateWordMatch[1], 10);
    const month = MONTHS[dateWordMatch[2]];
    return resolveDayMonth(day, month, now);
  }
  const monthFirstMatch = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/
  );
  if (monthFirstMatch) {
    const month = MONTHS[monthFirstMatch[1]];
    const day = parseInt(monthFirstMatch[2], 10);
    return resolveDayMonth(day, month, now);
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(text)) {
      return toISO(nextWeekday(now, i));
    }
  }

  const numericMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return resolveDayMonth(day, month, now);
    }
  }

  return null;
}

function resolveDayMonth(day, month, now) {
  let year = now.getFullYear();
  const candidate = new Date(year, month, day);
  if (candidate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    year += 1;
  }
  return toISO(new Date(year, month, day));
}

function nextWeekday(from, targetDay) {
  const d = new Date(from);
  const diff = (targetDay - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
  return d;
}

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
