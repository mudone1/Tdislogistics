// A self-contained, temporary "Help Center" mini-menu triggered by
// /inst (also /instr, /instruction) — deliberately lives entirely OUTSIDE
// the real assistant/orchestrator and its ConversationSlots. Per-chat state
// here is just "which help page is showing", never touched by, and never
// touching, the real booking/search state ChatMemoryRepository owns
// server-side. That separation is what makes the hard requirement here
// possible: the moment a message stops looking like Help Center navigation
// (anything other than a bare 0/#/valid-menu-digit while a menu is
// showing), this module drops its own state and gets out of the way
// entirely — the message goes to the normal assistant call completely
// unmodified, so an active booking/flight-selection flow it's already
// running server-side is never at any risk of collision.
//
// In-memory Map<chatId, HelpPage>, same pattern as lastImageCache.ts — this
// is a single long-running process (not serverless), so no persistence
// layer is needed; a service restart just means a live help browsing
// session resets, which is harmless (the user re-sends /inst).

type HelpPage =
  | "MAIN"
  | "BALANCE"
  | "BOOKING"
  | "BOOKING_SINGLE_ADULT"
  | "BOOKING_MULTI_ADULT"
  | "BOOKING_ADULT_CHILD"
  | "BOOKING_ADULT_INFANT"
  | "BOOKING_MULTI_PASSENGER"
  | "QUOTE_SEARCH"
  | "SALES_REPORTS";

const sessions = new Map<string, HelpPage>();

const START_COMMAND = /^\/(inst|instr|instruction)$/i;

const FOOTER_BACK = "\nReply 0 to go back to the Help Center.\nReply # to exit Help.";
const FOOTER_BOOKING_BACK = "\nReply 0 to go back.\nReply # to exit Help.";

const PAGES: Record<HelpPage, string> = {
  MAIN: `*TDIS BOT — HELP CENTER*

Reply with the number for what you want to learn:

1️⃣ Check Airline Balance
How to check airline balances in private chat and group chat.

2️⃣ Book on Hold
Learn how to make different types of book-on-hold requests.

3️⃣ Quote Search
How to search flights across all airlines, or just one.

4️⃣ Sales Reports
How to check sales reports across all airlines.

Reply # to exit Help.`,

  BALANCE: `*CHECK AIRLINE BALANCE*

*Private chat:* just ask directly, no @tdisbot needed —
"balance update"
or
"What's Aero's balance?"

*Group chat:* mention the bot —
"@tdisbot balance update"

"balance update" refreshes Enugu, United, XeJet, Rano and ValueJet and replies with all five. Naming one airline ("What's XeJet's balance?") answers just that one — works for any airline we sync, including AirPeace/Aero/Ibom/Arik.
${FOOTER_BACK}`,

  BOOKING: `*BOOK ON HOLD — SELECT TYPE*

1️⃣ Single Adult Passenger
2️⃣ Multiple Adult Passengers
3️⃣ Adult + Child
4️⃣ Adult + Infant
5️⃣ Adult + Child + Infant / Multiple Passengers
${FOOTER_BACK}`,

  BOOKING_SINGLE_ADULT: `*BOOK ON HOLD — Single Adult*

Give the airline, route, date, and the passenger's title, full name, phone and email. One message, e.g.:

Enugu
Abuja to Lagos 25th
Mr John Doe
08012345678
john@example.com

In a group chat, start with @tdisbot. In private chat, no mention needed.
${FOOTER_BOOKING_BACK}`,

  BOOKING_MULTI_ADULT: `*BOOK ON HOLD — Multiple Adults*

Same as a single-adult request, then list the extra adults by name — one message covers the whole PNR:

XeJet
Lagos to Abuja 31st
Mrs Ndubuisi Princess Sarah
07035537740
sesosori@yahoo.com
plus Mr James Okafor

Extra adults only need a name — they share the lead passenger's phone/email.
${FOOTER_BOOKING_BACK}`,

  BOOKING_ADULT_CHILD: `*BOOK ON HOLD — Adult + Child*

Book the lead adult as usual, then add the child by name and age (or date of birth) in the same message:

United Nigeria
Abuja to Lagos 25th
Mrs Amaka Obi
08012345678
amaka@example.com
plus my daughter Amara, age 7

A child needs a name and age/DOB — no separate phone or email. If it's missing, the bot will ask for it before booking.
${FOOTER_BOOKING_BACK}`,

  BOOKING_ADULT_INFANT: `*BOOK ON HOLD — Adult + Infant*

Same idea as Adult + Child, but for an infant travelling with the adult:

Rano Air
Lagos to Kano 25th
Mr Tunde Bello
08012345678
tunde@example.com
plus my son Emeka, age 1

An infant also needs a name and age/DOB — the bot will ask if it's missing.
${FOOTER_BOOKING_BACK}`,

  BOOKING_MULTI_PASSENGER: `*BOOK ON HOLD — Multiple Passengers (Adult + Child + Infant)*

Combine as many passengers as needed in one message — lead adult first, then everyone else with how they're travelling:

ValueJet
Abuja to Lagos 25th
Mr John Doe
08012345678
john@example.com
plus Mrs Jane Doe
plus my daughter Amara, age 7
plus my son Emeka, age 1

Extra adults need just a name; children/infants need a name and age/DOB. The bot asks for anything missing before booking.
${FOOTER_BOOKING_BACK}`,

  QUOTE_SEARCH: `*QUOTE SEARCH*

*Private chat:* just ask, no @tdisbot needed —
"Abuja to Lagos tomorrow"

*Group chat:* mention the bot —
"@tdisbot Abuja to Lagos tomorrow"

No airline named → compares Enugu, United, XeJet, Rano and ValueJet together. Name one ("Show me XeJet ABV-LOS on the 25th") to quote just that airline. For a round trip, add a return date — "ABV to LOS 25th, returning 30th".
${FOOTER_BACK}`,

  SALES_REPORTS: `*SALES REPORTS*

*Private chat:* just ask, no @tdisbot needed —
"How much did we make today?"

*Group chat:* mention the bot —
"@tdisbot how much did we make today?"

Works for totals ("Which airline sold the most this week?"), staff performance ("Top staff this month"), trends ("How does this week compare to last?"), and any single airline — AirPeace, Aero, Ibom, Arik, United Nigeria, XeJet, Rano Air or Enugu Air.
${FOOTER_BACK}`,
};

// Menu digit -> next page, per CURRENT page. Only pages that show a
// numbered menu appear here; leaf/instruction pages only accept 0/#.
const MENU_TRANSITIONS: Partial<Record<HelpPage, Record<string, HelpPage>>> = {
  MAIN: { "1": "BALANCE", "2": "BOOKING", "3": "QUOTE_SEARCH", "4": "SALES_REPORTS" },
  BOOKING: {
    "1": "BOOKING_SINGLE_ADULT",
    "2": "BOOKING_MULTI_ADULT",
    "3": "BOOKING_ADULT_CHILD",
    "4": "BOOKING_ADULT_INFANT",
    "5": "BOOKING_MULTI_PASSENGER",
  },
};

// Where "0" (go back) lands from each page — one level up, matching each
// page's own footer wording ("go back to the Help Center" from a top-level
// instruction page, just "go back" from a booking sub-page, which returns
// to the booking type menu rather than jumping all the way to MAIN).
const BACK_TARGET: Partial<Record<HelpPage, HelpPage>> = {
  BALANCE: "MAIN",
  BOOKING: "MAIN",
  QUOTE_SEARCH: "MAIN",
  SALES_REPORTS: "MAIN",
  BOOKING_SINGLE_ADULT: "BOOKING",
  BOOKING_MULTI_ADULT: "BOOKING",
  BOOKING_ADULT_CHILD: "BOOKING",
  BOOKING_ADULT_INFANT: "BOOKING",
  BOOKING_MULTI_PASSENGER: "BOOKING",
};

/** True if this message would start a fresh Help Center session. */
export function isHelpStartCommand(text: string): boolean {
  return START_COMMAND.test(text.trim());
}

/**
 * Single entry point, called BEFORE anything else touches the message.
 *
 * - Not currently in Help Center, and not /inst -> {handled:false}, caller
 *   proceeds with normal processing untouched.
 * - /inst (from any state, active or not) -> starts a FRESH session at
 *   MAIN, replacing whatever was there. Matches "only start again on an
 *   explicit /inst" — never auto-reopens on its own.
 * - Active session, message is 0 / # / a valid menu digit for the CURRENT
 *   page -> handled here, {handled:true, reply}.
 * - Active session, message is anything else (a real request) -> the
 *   defining behavior: state is cleared immediately and {handled:false}
 *   is returned so the caller forwards the ORIGINAL message to normal
 *   processing, same turn, no separate "you've left Help" detour message.
 */
export function handleHelpCenterMessage(chatId: string, text: string): { handled: boolean; reply?: string } {
  const trimmed = text.trim();

  if (isHelpStartCommand(trimmed)) {
    sessions.set(chatId, "MAIN");
    return { handled: true, reply: PAGES.MAIN };
  }

  const current = sessions.get(chatId);
  if (!current) return { handled: false };

  if (trimmed === "#") {
    sessions.delete(chatId);
    return { handled: true, reply: "Help Center closed. Send /inst anytime to reopen it." };
  }

  if (trimmed === "0") {
    const target = BACK_TARGET[current];
    if (target) {
      sessions.set(chatId, target);
      return { handled: true, reply: PAGES[target] };
    }
    // Already at MAIN — "0" has nowhere to go; treat as a no-op re-show
    // rather than falling through (still clearly Help Center navigation).
    return { handled: true, reply: PAGES.MAIN };
  }

  const transitions = MENU_TRANSITIONS[current];
  if (transitions && trimmed in transitions) {
    const target = transitions[trimmed];
    sessions.set(chatId, target);
    return { handled: true, reply: PAGES[target] };
  }

  // A bare digit that's out of range for this page's menu is still
  // clearly an attempt at Help Center navigation (not a real bot
  // request) — reprompt instead of silently falling through.
  if (transitions && /^\d+$/.test(trimmed)) {
    return { handled: true, reply: `That's not one of the options above.\n\n${PAGES[current]}` };
  }

  // Anything else: this is the exit hatch. A real bot request (a booking,
  // a balance check, a flight-selection number during an active search,
  // etc.) — drop Help Center state completely and let it through.
  sessions.delete(chatId);
  return { handled: false };
}
