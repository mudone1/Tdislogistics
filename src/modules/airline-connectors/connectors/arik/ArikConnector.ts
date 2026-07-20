import { BaseCraneConnector } from "../crane/BaseCraneConnector";
import type { CraneConnectorConfig } from "../crane/CraneConnectorConfig";

// Login form (username/password/button) VERIFIED via live DOM inspection
// against the real page — #USERNAME, #PASSWORD, and the "Login" control is
// a clickable <div class="login_button btn">, NOT a <button>, which is why
// the old button[type="submit"] guess never matched anything.
// loggedInMarker/totalBalance are copied from IbomConnector.ts's
// independently-verified values (all five airlines run the same Crane
// platform, confirmed structurally identical on the login page) but NOT
// yet independently confirmed post-login for this airline specifically —
// Ibom's own login is blocked by USER_AUTHENTICATION_ERROR right now, so
// there's no working session to verify a dashboard selector against yet.
const config: CraneConnectorConfig = {
  airline: "ARIK",
  displayName: "Arik Air",
  loginUrl: "https://arikair.crane.aero/",
  selectors: {
    usernameInput: "#USERNAME",
    passwordInput: "#PASSWORD",
    loginButton: ".login_button",
    loggedInMarker: 'role=link[name="Reports"]',
    logoutButton: 'a[href*="logout"], button:has-text("Logout")',
    totalBalance: "text=/^[\\d,]+\\.\\d{2}$/",
    currency: "",
    partnerCard: '[data-testid="partner-card"]',
    invoiceReference: '[data-testid="invoice-reference"]',
    srName: '[data-testid="sr-name"]',
  },
  menuLabels: {
    reportsMenu: "Reports",
    invoiceManagementItem: "Invoice Management",
  },
};

export class ArikConnector extends BaseCraneConnector {
  constructor() {
    super(config);
  }
}
