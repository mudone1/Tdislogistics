import { BaseVarsConnector } from "../vars/BaseVarsConnector";

// Login form confirmed identical to Enugu Air's (same #txtSineCode/
// #txtPassword/#btnOk field ids) via direct DOM inspection of the public
// login page. Post-login balance flow inherited from BaseVarsConnector —
// see its header comment for what's actually been tested end-to-end.
export class XeJetConnector extends BaseVarsConnector {
  constructor() {
    super({
      airline: "XEJET",
      displayName: "XeJet",
      loginUrl: "https://booking.xejet.com/VARS/public/CustomerPanels/AgentLoginBS.aspx",
    });
  }
}
