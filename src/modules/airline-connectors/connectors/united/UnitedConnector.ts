import { BaseVarsConnector } from "../vars/BaseVarsConnector";

// Login form confirmed identical to Enugu Air's (same #txtSineCode/
// #txtPassword/#btnOk field ids) via direct DOM inspection of the public
// login page. Post-login balance flow inherited from BaseVarsConnector —
// see its header comment for what's actually been tested end-to-end.
export class UnitedConnector extends BaseVarsConnector {
  constructor() {
    super({
      airline: "UNITED",
      displayName: "United Nigeria",
      loginUrl: "https://booking.flyunitednigeria.com/VARS/Public/CustomerPanels/AgentLoginBS.aspx",
    });
  }
}
