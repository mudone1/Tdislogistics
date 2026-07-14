import type { AirlineKey } from "../../core/types";

/**
 * Everything that differs between Air Peace / Aero / Arik / Ibom / NG Eagle
 * lives in one of these config objects. BaseCraneConnector's login/nav/
 * balance-read logic is 100% shared — a new Crane-platform airline is
 * "implement this config object", nothing else.
 *
 * IMPORTANT — SELECTORS ARE PLACEHOLDERS:
 * I don't have network access or valid agent credentials in this
 * environment, so I can't inspect these portals' real authenticated pages.
 * Every selector below is a reasonable *guess* based on common patterns for
 * this kind of B2B travel portal — not a verified value. Before running any
 * connector for real, replace these using Playwright's codegen tool against
 * each airline's actual site, logged in with a real (test, ideally)
 * account:
 *
 *   npx playwright codegen https://book-airpeace.crane.aero/
 *
 * That records your actual clicks/typing and gives you working selectors
 * to paste in here. Treat every "TODO: verify" comment as a hard blocker
 * before enabling that airline's scheduled sync in production.
 */
export interface CraneConnectorConfig {
  airline: AirlineKey;
  displayName: string;
  loginUrl: string;

  /**
   * Some Crane-platform airlines open the post-login popup to a blank/
   * intermediate page rather than the real dashboard — confirmed via
   * codegen against Ibom Air, where an explicit navigation to this URL is
   * required right after the popup opens, before anything else works.
   * Leave unset for airlines where the popup lands on the dashboard on
   * its own.
   */
  postLoginUrl?: string;

  selectors: {
    usernameInput: string; // TODO: verify
    passwordInput: string; // TODO: verify
    loginButton: string; // TODO: verify
    /** Present only once truly logged in — used by isLoggedIn(). */
    loggedInMarker: string; // TODO: verify
    logoutButton: string; // TODO: verify

    /** Balance page fields, once on Reports → Invoice Management. */
    totalBalance: string; // TODO: verify
    currency: string; // TODO: verify — often embedded in the same string as totalBalance
    partnerCard: string; // TODO: verify
    invoiceReference: string; // TODO: verify
    srName: string; // TODO: verify
  };

  menuLabels: {
    reportsMenu: string; // e.g. "Reports"
    invoiceManagementItem: string; // e.g. "Invoice Management"
  };
}
