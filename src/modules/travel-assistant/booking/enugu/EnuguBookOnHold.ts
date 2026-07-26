import {
  bookVarsPlatformOnHold,
  type BookOnHoldCredentials,
  type BookOnHoldRequest,
  type BookOnHoldResult,
} from "../vars-platform/VarsBookOnHold";

export type { BookOnHoldCredentials, BookOnHoldRequest, BookOnHoldResult };

const LOGIN_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/AgentLoginBS.aspx";
const REQUIREMENTS_URL = "https://booking.enuguairlines.com/vars/public/CustomerPanels/requirementsBS.aspx";
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
