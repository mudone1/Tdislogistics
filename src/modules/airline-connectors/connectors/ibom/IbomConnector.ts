import { BaseCraneConnector } from "../crane/BaseCraneConnector";
import type { CraneConnectorConfig } from "../crane/CraneConnectorConfig";

// VERIFIED via `npx playwright codegen` against the real login page and a
// real logged-in session:
// - username/password/login button: confirmed working
// - loggedInMarker: the "Reports" nav link only exists once actually
//   authenticated (confirmed reachable in the real recorded session)
// - totalBalance: the real balance lives in a data-grid cell formatted
//   like "698,405.00" — matched here by PATTERN (any grid cell shaped
//   like a money amount), not that literal value, since the whole point
//   is reading whatever the CURRENT balance is. This is my best attempt
//   from one recorded session; if Test Connection succeeds but returns
//   a suspicious/wrong-looking number, it likely means more than one
//   gridcell matches this pattern and we need a tighter selector anchored
//   to the "NGN :" label seen next to it in the recording.
const config: CraneConnectorConfig = {
  airline: "IBOM",
  displayName: "Ibom Air",
  loginUrl: "https://book-ibomair.crane.aero/",
  selectors: {
    usernameInput: 'role=textbox[name="User Name:"]',
    passwordInput: 'role=textbox[name="Password:"]',
    loginButton: 'text="Login"',
    loggedInMarker: 'role=link[name="Reports"]',
    logoutButton: 'a[href*="logout"], button:has-text("Logout")',
    totalBalance: 'role=gridcell[name=/^[\\d,]+\\.\\d{2}$/]',
    currency: '',
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
