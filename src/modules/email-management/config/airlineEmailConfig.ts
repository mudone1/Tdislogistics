/**
 * Airline Email Configuration
 * Central registry of airline email recipients for the email management system
 * 
 * Structure:
 * - Each airline has a unique code
 * - First recipient in the array is the primary "To" recipient
 * - All additional recipients are automatically CCed
 */

export interface AirlineEmailConfig {
  code: string;
  name: string;
  recipients: {
    email: string;
    isPrimary?: boolean;
  }[];
  isActive: boolean;
}

export const AIRLINE_EMAIL_CONFIG: Record<string, AirlineEmailConfig> = {
  XEJET: {
    code: "XEJET",
    name: "XEJET",
    recipients: [
      { email: "commercial@xejet.com", isPrimary: true },
    ],
    isActive: true,
  },
  IBOM: {
    code: "IBOM",
    name: "IBOM AIR",
    recipients: [
      { email: "tmcaccounts@ibomair.com", isPrimary: true },
      { email: "Emem.inyang@ibomair.com" },
    ],
    isActive: true,
  },
  AIRPEACE: {
    code: "AIRPEACE",
    name: "AIR PEACE",
    recipients: [
      { email: "commercialhelpdesk@flyairpeace.com", isPrimary: true },
      { email: "sale@flyairpeace.com" },
      { email: "oluebubechukwu.ewoh@airpeace.onmicrosoft.com" },
    ],
    isActive: true,
  },
  ARIK: {
    code: "ARIK",
    name: "ARIK",
    recipients: [
      { email: "travelagencydesk@arikair.com", isPrimary: true },
      { email: "monsur.Ojelabi@arikair.com" },
      { email: "offiong.aquaisua@arikair.com" },
      { email: "folarin.oyelami@arikair.com" },
    ],
    isActive: true,
  },
  AERO: {
    code: "AERO",
    name: "AERO",
    recipients: [
      { email: "travelagencydesk@acn.aero", isPrimary: true },
      { email: "Chukwugbo.c@acn.aero" },
      { email: "Oyawa.o@acn.aero" },
      { email: "Tickethelpdesk@acn.aero" },
    ],
    isActive: true,
  },
  UNITED: {
    code: "UNITED",
    name: "UNITED NIGERIA",
    recipients: [
      { email: "travelagencydesk@flyunitednigeria.com", isPrimary: true },
    ],
    isActive: true,
  },
  NGEAGLE: {
    code: "NGEAGLE",
    name: "NG EAGLE",
    recipients: [
      { email: "Tapayments@ngeagle.com", isPrimary: true },
      { email: "Travelagency@ngeagle.com" },
      { email: "Hafsat.abubakar@ngeagle.com" },
      { email: "Agnes.ichie@ngeagle.com" },
    ],
    isActive: true,
  },
  VALUEJET: {
    code: "VALUEJET",
    name: "VALUEJET",
    recipients: [
      { email: "travelagencydesk@flyvaluejet.com", isPrimary: true },
      { email: "charity.onumaegbu@flyvaluejet.com" },
    ],
    isActive: true,
  },
  RANO: {
    code: "RANO",
    name: "RANO AIR",
    recipients: [
      { email: "travelagency@ranoair.com", isPrimary: true },
      { email: "customercare@ranoair.com" },
    ],
    isActive: true,
  },
  ENUGU: {
    code: "ENUGU",
    name: "ENUGU AIR",
    recipients: [
      { email: "travelagents@enuguairlines.com", isPrimary: true },
    ],
    isActive: true,
  },
};

/**
 * Get all active airlines
 */
export function getActiveAirlines(): AirlineEmailConfig[] {
  return Object.values(AIRLINE_EMAIL_CONFIG).filter((airline) => airline.isActive);
}

/**
 * Get airline by code
 */
export function getAirlineByCode(code: string): AirlineEmailConfig | undefined {
  return AIRLINE_EMAIL_CONFIG[code.toUpperCase()];
}

/**
 * Get airline recipients
 */
export function getAirlineRecipients(airlineCode: string) {
  const airline = getAirlineByCode(airlineCode);
  if (!airline) {
    return { to: null, cc: [] };
  }

  const [primary, ...cc] = airline.recipients;
  return {
    to: primary.email,
    cc: cc.map((r) => r.email),
  };
}

/**
 * Find airline by email address (reverse lookup)
 */
export function findAirlineByEmail(email: string): AirlineEmailConfig | undefined {
  return Object.values(AIRLINE_EMAIL_CONFIG).find((airline) =>
    airline.recipients.some((r) => r.email.toLowerCase() === email.toLowerCase())
  );
}

/**
 * Get all airline codes (sorted)
 */
export function getAllAirlineCodes(): string[] {
  return Object.keys(AIRLINE_EMAIL_CONFIG).sort();
}
