import {
  bookVarsPlatformOnHold,
  type BookOnHoldCredentials,
  type BookOnHoldRequest,
  type BookOnHoldResult,
} from "../vars-platform/VarsBookOnHold";

// Rano Air's VARS instance is hosted on Videcom's shared multi-tenant
// platform rather than the airline's own domain (confirmed by live
// investigation for search — see RanoAirSearch.ts) — different host shape,
// same booking engine.
const LOGIN_URL = "https://customer3.videcom.com/RanoAir/VARS/Public/CustomerPanels/AgentLoginBS.aspx";
const REQUIREMENTS_URL = "https://customer3.videcom.com/RanoAir/VARS/Public/CustomerPanels/requirementsBS.aspx";
// Not independently confirmed — inferred from the same CustomerPanels path
// pattern. Verify against a real run before relying on this for PNR
// verification.
const MMB_URL = "https://customer3.videcom.com/RanoAir/VARS/Public/CustomerPanels/MmbLoginBS.aspx";

// UNVERIFIED beyond login: the login DOM (#txtSineCode/#txtPassword/#btnOk)
// is confirmed identical to Enugu Air's (see RanoConnector.ts), but the
// booking-flow selectors this module depends on — fare classband names,
// passenger form field ids, payment options — have not been checked
// against a real Rano Air search/booking run. Do not treat a successful
// type-check as evidence this works; it needs its own live verification
// pass (same kind of check done for Enugu Air) before use.
export async function bookRanoAirOnHold(
  credentials: BookOnHoldCredentials,
  request: BookOnHoldRequest
): Promise<BookOnHoldResult> {
  return bookVarsPlatformOnHold(credentials, request, {
    logTag: "rano-booking",
    loginUrl: LOGIN_URL,
    requirementsUrl: REQUIREMENTS_URL,
    mmbUrl: MMB_URL,
    airlineLabel: "Rano Air",
  });
}
