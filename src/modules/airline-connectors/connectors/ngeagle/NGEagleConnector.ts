import { BaseCraneConnector } from "../crane/BaseCraneConnector";
import type { CraneConnectorConfig } from "../crane/CraneConnectorConfig";

// Login form VERIFIED via live DOM inspection of the real login page.
// Same Oracle Crane platform as Aero/Air Peace/Arik (see AirPeaceConnector.ts)
// but NOT structurally identical: the login button here has a different
// class (no "login_button" class at all) and the password field has no
// id, only a name attribute — matched here by the one thing every Crane
// login button actually shares regardless of styling, the
// `logInControl()` onclick handler. Post-login/balance-page selectors
// are still inferred (copied from Ibom's independently-verified ones),
// not confirmed, until a session actually reaches the dashboard.
const config: CraneConnectorConfig = {
  airline: "NGEAGLE",
  displayName: "NG Eagle",
  loginUrl: "https://book-ngeagle.crane.aero/",
  selectors: {
    usernameInput: "#USERNAME",
    passwordInput: 'input[name="PASSWORD"]',
    loginButton: 'div[onclick*="logInControl"]',
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

export class NGEagleConnector extends BaseCraneConnector {
  constructor() {
    super(config);
  }
}
