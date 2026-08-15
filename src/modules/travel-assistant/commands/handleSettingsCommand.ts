import { connectorServiceClient } from "../../../lib/connectorServiceClient";
import { ChatMemoryRepository } from "../storage/ChatMemoryRepository";
import { UserAirlineAccountPreferenceRepository } from "../storage/UserAirlineAccountPreferenceRepository";
import { ALL_AIRLINES, AIRLINE_KEY_TO_DISPLAY_NAME, resolveNamedAirline } from "../core/airlines";
import type { AirlineKey } from "@prisma/client";

// Deterministic (zero-LLM) /settings command — lets each WhatsApp number
// pick which configured login account its bookings run through, per
// airline. Only meaningful for an airline with more than one account
// configured (see AIRLINE_BOOKING_ACCOUNTS-style env vars in
// connector-service) — one account is used automatically either way, per
// explicit product direction (never blocks a booking on an unset
// preference).

const SETTINGS_COMMAND_PATTERN = /^\/settings\b/i;

export function isSettingsCommand(rawMessage: string): boolean {
  return SETTINGS_COMMAND_PATTERN.test(rawMessage.trim());
}

interface PendingAccountSelection {
  type: "ACCOUNT_SELECTION";
  airline: AirlineKey;
  labels: string[];
}

// Account labels for one airline (never usernames/passwords) — only
// connector-service can read the Railway-only <AIRLINE>_BOOKING_ACCOUNTS
// env vars, so /settings asks it rather than duplicating account config
// into Vercel. Returns null specifically on a failed/unreachable call
// (distinct from a real empty answer) so the caller can tell "connector-
// service is down" apart from "this airline has nothing configured, one
// admin credential is used automatically" — those need different replies.
async function fetchAccountLabels(airline: AirlineKey): Promise<string[] | null> {
  try {
    const { ok, body } = await connectorServiceClient.listAccounts(airline);
    if (!ok) return null;
    const labels = (body as { labels?: unknown }).labels;
    return Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return null;
  }
}

export async function handleSettingsCommand(sessionId: string, sessionKey: string, rawMessage: string): Promise<string> {
  const afterCommand = rawMessage.trim().replace(SETTINGS_COMMAND_PATTERN, "").trim();

  if (!afterCommand) {
    const results = await Promise.all(
      ALL_AIRLINES.map(async (airline) => ({ airline, labels: await fetchAccountLabels(airline as AirlineKey) }))
    );
    await ChatMemoryRepository.updatePendingAction(sessionId, null);

    if (results.every((r) => r.labels === null)) {
      return "I couldn't reach the booking service to check account settings just now — mind trying again in a moment?";
    }

    const lines: string[] = [];
    for (const { airline, labels } of results) {
      if (!labels || labels.length <= 1) continue; // nothing to choose for this one
      const pref = await UserAirlineAccountPreferenceRepository.get(sessionKey, airline as AirlineKey);
      const displayName = AIRLINE_KEY_TO_DISPLAY_NAME[airline] ?? airline;
      lines.push(`${displayName}: ${pref ?? "(not set — defaults to first account)"}`);
    }
    if (lines.length === 0) {
      return "Every airline currently has just one login configured — nothing to choose, it's used automatically.";
    }
    return `Your account preferences:\n${lines.join("\n")}\n\nReply "/settings <airline>" to change one.`;
  }

  const airlineKey = resolveNamedAirline(afterCommand) as AirlineKey | null;
  if (!airlineKey) {
    return `I don't recognize "${afterCommand}" as an airline — try "/settings enugu", "/settings united", "/settings xejet", "/settings rano", or "/settings valuejet".`;
  }

  const labels = await fetchAccountLabels(airlineKey);
  const displayName = AIRLINE_KEY_TO_DISPLAY_NAME[airlineKey] ?? airlineKey;
  if (labels === null) {
    return "I couldn't reach the booking service to check account settings just now — mind trying again in a moment?";
  }
  if (labels.length <= 1) {
    await ChatMemoryRepository.updatePendingAction(sessionId, null);
    return `${displayName} only has one login configured — it's used automatically, nothing to choose.`;
  }

  const pending: PendingAccountSelection = { type: "ACCOUNT_SELECTION", airline: airlineKey, labels };
  await ChatMemoryRepository.updatePendingAction(sessionId, pending as unknown as object);
  const numbered = labels.map((l, i) => `${i + 1}. ${l}`).join("\n");
  return `${displayName} has ${labels.length} accounts configured:\n${numbered}\nReply with the number or the label to pick one.`;
}

// Resolves a reply to a pending /settings selection (a number or a label
// match against the options it just listed). Returns null when `session`
// isn't mid-selection, or the reply didn't resolve to any of the shown
// options — the caller should fall through to normal handling in the
// latter case rather than treating it as an error, since the user may
// simply have moved on to something else instead of answering.
export async function tryResolvePendingAccountSelection(
  sessionId: string,
  sessionKey: string,
  pendingActionRaw: unknown,
  rawMessage: string
): Promise<string | null> {
  const pending = pendingActionRaw as PendingAccountSelection | null;
  if (!pending || pending.type !== "ACCOUNT_SELECTION" || !Array.isArray(pending.labels)) return null;

  const trimmed = rawMessage.trim();
  const asNumber = parseInt(trimmed, 10);
  let chosen: string | null = null;
  if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= pending.labels.length) {
    chosen = pending.labels[asNumber - 1];
  } else {
    chosen = pending.labels.find((l) => l.toLowerCase() === trimmed.toLowerCase()) ?? null;
  }
  if (!chosen) return null;

  await UserAirlineAccountPreferenceRepository.set(sessionKey, pending.airline, chosen);
  await ChatMemoryRepository.updatePendingAction(sessionId, null);
  const displayName = AIRLINE_KEY_TO_DISPLAY_NAME[pending.airline] ?? pending.airline;
  return `Got it — ${displayName} bookings from this number will now use "${chosen}". Change this anytime with /settings.`;
}
