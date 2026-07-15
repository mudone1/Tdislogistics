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
  // REMOVED postLoginUrl: forcing this navigation was confirmed (via the
  // body-HTML diagnostic) to land on the site's own "Unexpected Error(s)
  // occurred" page instead of the real dashboard — this is a JSF app,
  // which manages server-side view state tied to how a page is reached;
  // a raw navigation likely breaks that continuity rather than helping.
  // Letting the popup settle naturally instead (see BaseCraneConnector).
  selectors: {
    usernameInput: 'role=textbox[name="User Name:"]',
    passwordInput: 'role=textbox[name="Password:"]',
    loginButton: 'text="Login"',
    // Codegen's recorded accessible name had a leading space (" Reports",
    // likely from an icon before the text) — matching on a substring
    // instead of an exact name sidesteps any doubt about whitespace
    // normalization differences between matching APIs.
    // CORRECTED: the sidebar nav is collapsed to icons-only until
    // expanded, so there's no VISIBLE "Reports" text for a text= selector
    // to find (confirmed by direct observation of the live site) — that's
    // why the previous text= attempt failed. Icon-only nav items still
    // need an accessible name (aria-label/title) for screen readers, and
    // that's exactly what the original codegen recording matched via
    // getByRole(..., {name: 'Reports'}) — which is why THAT worked live.
    // Going back to role-based matching, just without the unverified
    // regex this time (a plain string here, unlike last round).
    loggedInMarker: 'role=link[name="Reports"]',
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
