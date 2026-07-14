import { BaseCraneConnector } from "../crane/BaseCraneConnector";
import type { CraneConnectorConfig } from "../crane/CraneConnectorConfig";

// VERIFIED via `npx playwright codegen` against the real login page
// (username, password, login button — confirmed working). Everything
// else below (loggedInMarker, logout, balance page fields) is still an
// unverified placeholder — needs the same codegen treatment on the
// post-login dashboard and the Reports -> Invoice Management page.
const config: CraneConnectorConfig = {
  airline: "IBOM",
  displayName: "Ibom Air",
  loginUrl: "https://book-ibomair.crane.aero/",
  selectors: {
    usernameInput: 'role=textbox[name="User Name:"]',
    passwordInput: 'role=textbox[name="Password:"]',
    loginButton: 'text="Login"',
    // TODO: verify — capture once logged in via popup (see BaseCraneConnector.login())
    loggedInMarker: '[data-testid="dashboard-header"], .dashboard-welcome',
    logoutButton: 'a[href*="logout"], button:has-text("Logout")',
    totalBalance: '[data-testid="total-balance"], .invoice-total-balance',
    currency: '[data-testid="balance-currency"]',
    partnerCard: '[data-testid="partner-card"]',
    invoiceReference: '[data-testid="invoice-reference"]',
    srName: '[data-testid="sr-name"]',
  },
  menuLabels: {
    reportsMenu: "Reports",
    invoiceManagementItem: "Invoice Management",
  },
};

export class IbomConnector extends BaseCraneConnector {
  constructor() {
    super(config);
  }
}
