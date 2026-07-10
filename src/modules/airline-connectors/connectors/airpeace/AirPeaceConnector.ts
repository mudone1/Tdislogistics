import { BaseCraneConnector } from "../crane/BaseCraneConnector";
import type { CraneConnectorConfig } from "../crane/CraneConnectorConfig";

// TODO: verify every selector below against the real portal (see the
// warning in CraneConnectorConfig.ts). These are structurally reasonable
// placeholders for a typical Crane-platform login/dashboard, not confirmed
// values.
const config: CraneConnectorConfig = {
  airline: "AIRPEACE",
  displayName: "Air Peace",
  loginUrl: "https://book-airpeace.crane.aero/",
  selectors: {
    usernameInput: 'input[name="username"]',
    passwordInput: 'input[name="password"]',
    loginButton: 'button[type="submit"]',
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

export class AirPeaceConnector extends BaseCraneConnector {
  constructor() {
    super(config);
  }
}
