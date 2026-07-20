import { BaseCraneConnector } from "../crane/BaseCraneConnector";
import type { CraneConnectorConfig } from "../crane/CraneConnectorConfig";

// Login form VERIFIED via live DOM inspection — see ArikConnector.ts for
// the full note (same Crane platform, identical login page structure
// confirmed across all three unverified airlines in one pass).
const config: CraneConnectorConfig = {
  airline: "AERO",
  displayName: "Aero Contractors",
  loginUrl: "https://flyaero.crane.aero/",
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

export class AeroConnector extends BaseCraneConnector {
  constructor() {
    super(config);
  }
}
