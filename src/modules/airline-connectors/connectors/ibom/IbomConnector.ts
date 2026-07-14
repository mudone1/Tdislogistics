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
    // Switched from role=link[name=/Reports/] — the granular login logs
    // confirmed we DO reach the correct authenticated URL every time, but
    // that selector never matched anything, meaning the regex-inside-a-
    // role-selector-string syntax likely isn't valid Playwright syntax
    // (as opposed to the real page missing "Reports"). Plain text= is
    // simple, well-documented substring/case-insensitive matching with no
    // such ambiguity.
    loggedInMarker: 'text=Reports',
    logoutButton: 'a[href*="logout"], button:has-text("Logout")',
    // Same fix as loggedInMarker above — role=gridcell[name=/regex/] is
    // the same unconfirmed syntax, so switching preemptively to the
    // well-documented text=/regex/ engine instead of waiting to discover
    // the same bug in a second round. Trade-off: this matches ANY element
    // with money-shaped text, not specifically a gridcell — if this grabs
    // the wrong number once we can actually test this step, we'll need to
    // scope it down (e.g. anchored near the "NGN :" label from the
    // recording).
    totalBalance: 'text=/^[\\d,]+\\.\\d{2}$/',
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
