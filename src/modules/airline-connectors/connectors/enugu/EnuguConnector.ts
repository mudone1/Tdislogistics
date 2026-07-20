import { BaseVarsConnector } from "../vars/BaseVarsConnector";

export class EnuguConnector extends BaseVarsConnector {
  constructor() {
    super({
      airline: "ENUGU",
      displayName: "Enugu Air",
      loginUrl: "https://booking.enuguairlines.com/vars/public/CustomerPanels/AgentLoginBS.aspx",
    });
  }
}
