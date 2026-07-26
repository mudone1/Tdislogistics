import {
  bookVarsPlatformOnHold,
  type BookOnHoldCredentials,
  type BookOnHoldRequest,
  type BookOnHoldResult,
} from "../vars-platform/VarsBookOnHold";

export type { BookOnHoldCredentials, BookOnHoldRequest, BookOnHoldResult };

const LOGIN_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/AgentLoginBS.aspx";
// The real agent-portal booking entry point (Dashboard.aspx -> "Standard
// Booking"), not the CustomerPanels deep-link this used to point at — the
// two share identical search form field ids, but only THIS path surfaces
// the accordion payment section with the "Book Now, Pay Later" panel and
// its required agent-password re-confirmation field. Confirmed live.
const REQUIREMENTS_URL = "https://booking.enuguairlines.com/VARS/Public/b/agentSearch.aspx";
const MMB_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/MmbLoginBS.aspx";

// The one VARS-platform airline verified end-to-end through an actual
// booking (search -> fare select -> passenger details -> payment -> PNR,
// plus independent PNR verification against the public Manage My Booking
// lookup above). See VarsBookOnHold.ts for what's shared vs. what each
// airline still needs to confirm for itself.
export async function bookEnuguAirOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest
): Promise<BookOnHoldResult> {
  return bookVarsPlatformOnHold(credentials, request, {
    logTag: "enugu-booking",
    loginUrl: LOGIN_URL,
    requirementsUrl: REQUIREMENTS_URL,
    mmbUrl: MMB_URL,
    airlineLabel: "Enugu Air",
  });
}
