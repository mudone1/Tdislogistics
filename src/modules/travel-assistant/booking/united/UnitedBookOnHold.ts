import {
  bookVarsPlatformOnHold,
  type BookOnHoldCredentials,
  type BookOnHoldRequest,
  type BookOnHoldResult,
  type OnBookingStage,
} from "../vars-platform/VarsBookOnHold";

const LOGIN_URL = "https://booking.flyunitednigeria.com/VARS/Public/CustomerPanels/AgentLoginBS.aspx";
// The real agent-portal booking entry point (Dashboard.aspx -> "Standard
// Booking"), confirmed live to follow the exact same pattern as Enugu Air's
// — not the CustomerPanels deep-link, which never surfaces the accordion
// payment section with the "Book Now, Pay Later" panel and its required
// agent-password re-confirmation field.
const REQUIREMENTS_URL = "https://booking.flyunitednigeria.com/VARS/Public/b/agentSearch.aspx";
// Not independently confirmed — inferred from the same CustomerPanels path
// pattern Enugu Air uses (AgentLoginBS.aspx / requirementsBS.aspx /
// MmbLoginBS.aspx all live side-by-side there). Verify against a real run
// before relying on this for PNR verification.
const MMB_URL = "https://booking.flyunitednigeria.com/VARS/Public/CustomerPanels/MmbLoginBS.aspx";

// UNVERIFIED beyond login and the requirementsUrl fix above: the login DOM
// (#txtSineCode/#txtPassword/#btnOk) is confirmed identical to Enugu Air's
// (see UnitedConnector.ts), but the booking-flow selectors this module
// depends on — fare classband names, passenger form field ids, payment
// options — have not been checked against a real United Nigeria
// search/booking run. Do not treat a successful type-check as evidence
// this works; it needs its own live verification pass (same kind of check
// done for Enugu Air) before use.
export async function bookUnitedNigeriaOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest,
  onStage?: OnBookingStage,
  forceFreshLogin?: boolean,
  isCancelled?: () => Promise<boolean>
): Promise<BookOnHoldResult> {
  return bookVarsPlatformOnHold(
    credentials,
    request,
    {
      logTag: "united-booking",
      loginUrl: LOGIN_URL,
      requirementsUrl: REQUIREMENTS_URL,
      mmbUrl: MMB_URL,
      airlineLabel: "United Nigeria",
    },
    onStage,
    forceFreshLogin,
    isCancelled
  );
}
