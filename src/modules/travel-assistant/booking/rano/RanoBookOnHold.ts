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
// The real agent-portal booking entry point (Dashboard.aspx -> "Standard
// Booking"), confirmed live to follow the exact same pattern as Enugu Air's
// and United Nigeria's — not the CustomerPanels deep-link, which never
// surfaces the accordion payment section with the "Book Now, Pay Later"
// panel and its required agent-password re-confirmation field.
const REQUIREMENTS_URL = "https://customer3.videcom.com/RanoAir/VARS/Public/b/agentSearch.aspx";
// Confirmed live: exact same #txtSurname/#txtPNR/#btnOk fields as Enugu Air,
// and a bogus lookup returns "Booking not found!" matching the shared
// BOOKING_NOT_FOUND_MARKER regex in VarsBookOnHold.ts.
const MMB_URL = "https://customer3.videcom.com/RanoAir/VARS/Public/CustomerPanels/MmbLoginBS.aspx";

// Verified live end-to-end up to (not including) final submission: fare
// selection uses United's whole-card-click mechanism (card gains
// "panel-active"), but Rano only ever offers a single "Economy" classband
// per flight — no Promo/Saver split — so its FARE_CLASS_PREFERENCE entry in
// connector-service/src/server.ts is ["Economy", "Economy"]. Passenger form
// field ids (passenger1firstname/lastname/mobilephonenumber/emailaddress/
// emailaddressverification/specialservicerequest0) and the payment radio
// group (optpaymentformofpayment, including "NoPaymentRequered" for Book
// Now Pay Later) are identical to United Nigeria's.
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
