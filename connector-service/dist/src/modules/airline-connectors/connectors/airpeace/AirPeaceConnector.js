"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AirPeaceConnector = void 0;
const BaseCraneConnector_1 = require("../crane/BaseCraneConnector");
// Login form VERIFIED via live DOM inspection — see ArikConnector.ts for
// the full note (same Crane platform, identical login page structure
// confirmed across all three unverified airlines in one pass).
const config = {
    airline: "AIRPEACE",
    displayName: "Air Peace",
    loginUrl: "https://book-airpeace.crane.aero/",
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
class AirPeaceConnector extends BaseCraneConnector_1.BaseCraneConnector {
    constructor() {
        super(config);
    }
}
exports.AirPeaceConnector = AirPeaceConnector;
