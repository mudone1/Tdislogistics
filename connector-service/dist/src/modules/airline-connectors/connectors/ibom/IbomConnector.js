import { BaseCraneConnector } from "../crane/BaseCraneConnector";
// TODO: verify every selector — see AirPeaceConnector.ts for the full note.
const config = {
    airline: "IBOM",
    displayName: "Ibom Air",
    loginUrl: "https://book-ibomair.crane.aero/",
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
export class IbomConnector extends BaseCraneConnector {
    constructor() {
        super(config);
    }
}
