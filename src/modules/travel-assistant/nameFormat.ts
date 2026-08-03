// Shared passenger-name casing rules, used both when a name comes off an
// ID-card scan (PassportParser) and when it's parsed from free-text chat
// (ConversationOrchestrator). Surname ALL CAPS, given name(s) Title Case —
// matches how the airline's own ID documents and booking confirmations
// print names, per explicit product direction.
export function toTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
        .join("-")
    )
    .join(" ");
}

export function toSurnameCase(raw: string): string {
  return raw.trim().toUpperCase();
}
