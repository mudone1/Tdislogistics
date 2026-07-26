import {
  bookVarsPlatformOnHold,
  type BookOnHoldCredentials,
  type BookOnHoldRequest,
  type BookOnHoldResult,
} from "../vars-platform/VarsBookOnHold";

const LOGIN_URL = "https://booking.xejet.com/VARS/public/CustomerPanels/AgentLoginBS.aspx";
const REQUIREMENTS_URL = "https://booking.xejet.com/VARS/public/CustomerPanels/requirementsBS.aspx";
// Not independently confirmed — inferred from the same CustomerPanels path
// pattern. Verify against a real run before relying on this for PNR
// verification.
const MMB_URL = "https://booking.xejet.com/VARS/public/CustomerPanels/MmbLoginBS.aspx";

// UNVERIFIED beyond login: the login DOM (#txtSineCode/#txtPassword/#btnOk)
// is confirmed identical to Enugu Air's (see XeJetConnector.ts), but the
// booking-flow selectors this module depends on — fare classband names,
// passenger form field ids, payment options — have not been checked
// against a real XeJet search/booking run. Do not treat a successful
// type-check as evidence this works; it needs its own live verification
// pass (same kind of check done for Enugu Air) before use.
export async function bookXeJetOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest
): Promise<BookOnHoldResult> {
  return bookVarsPlatformOnHold(credentials, request, {
    logTag: "xejet-booking",
    loginUrl: LOGIN_URL,
    requirementsUrl: REQUIREMENTS_URL,
    mmbUrl: MMB_URL,
    airlineLabel: "XeJet",
  });
}
