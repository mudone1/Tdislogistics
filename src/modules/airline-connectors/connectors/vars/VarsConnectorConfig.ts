import type { AirlineKey } from "../../core/types";

/**
 * Everything that differs between VARS/Videcom-platform airlines (Enugu
 * Air, United Nigeria, XeJet, Rano Air) is just the login URL and display
 * name — confirmed via live DOM inspection of all four agent-login pages:
 * identical field ids (#txtSineCode, #txtPassword, #btnOk) and identical
 * post-login structure ("Logged in as: ..." marker, balance surfaced as
 * "Agent Credit Limit = <amount> <currency>" inside Account -> Replenish
 * Account). BaseVarsConnector's login/nav/balance-read logic is 100%
 * shared — a new VARS-platform airline is "add a config object", nothing
 * else.
 */
export interface VarsConnectorConfig {
  airline: AirlineKey;
  displayName: string;
  loginUrl: string;
}
