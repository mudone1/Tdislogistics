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
  // Confirmed via codegen: the popup doesn't land on the dashboard on its
  // own — this explicit navigation is required right after it opens.
  postLoginUrl: "https://book-ibomair.crane.aero/JSF/RezvEntry.xhtml?faces-redirect=true#!",
  selectors: {
    usernameInput: 'role=textbox[name="User Name:"]',
    passwordInput: 'role=textbox[name="Password:"]',
    loginButton: 'text="Login"',
    // Codegen's recorded accessible name had a leading space (" Reports",
    // likely from an icon before the text) — matching on a substring
    // instead of an exact name sidesteps any doubt about whitespace
    // normalization differences between matching APIs.
    loggedInMarker: 'role=link[name=/Reports/]',
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
