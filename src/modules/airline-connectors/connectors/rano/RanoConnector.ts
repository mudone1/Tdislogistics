import { BaseVarsConnector } from "../vars/BaseVarsConnector";

// Login form confirmed identical to Enugu Air's (same #txtSineCode/
// #txtPassword/#btnOk field ids) via direct DOM inspection of the public
// login page, despite living on a different domain (customer3.videcom.com
// rather than a per-airline "booking.<name>.com" domain). Post-login
// balance flow inherited from BaseVarsConnector — see its header comment
// for what's actually been tested end-to-end.
export class RanoConnector extends BaseVarsConnector {
  constructor() {
    super({
      airline: "RANO",
      displayName: "Rano Air",
      loginUrl: "https://customer3.videcom.com/RanoAir/VARS/Public/CustomerPanels/AgentLoginBS.aspx",
    });
  }
}
