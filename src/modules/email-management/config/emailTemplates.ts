/**
 * Email Templates Configuration
 * 
 * All templates must have subject starting with "URGENT REQUEST"
 * Variables are marked with {VARIABLE_NAME} and are case-sensitive
 * 
 * Available variables:
 * {PNR} - Passenger Name Record
 * {PASSENGER_NAME} - Single passenger name
 * {PASSENGER_LIST} - Numbered list of passengers (for VOID)
 * {ROUTE} - Route (e.g., LOS-ABV)
 * {TRAVEL_DATE} - Travel date in DD/MM/YYYY format
 * {DEPARTURE_TIME} - Departure time in HH:MM format
 */

export interface EmailTemplateConfig {
  id: string;
  name: string;
  requestType:
    | "OPEN"
    | "REFUND"
    | "VOID"
    | "RESCHEDULE"
    | "REFUND_DISRUPTION"
    | "RESCHEDULE_DISRUPTION";
  subject: string;
  bodyTemplate: string;
  greeting: string; // For quick reference
  isActive: boolean;
}

export const EMAIL_TEMPLATES: Record<string, EmailTemplateConfig> = {
  OPEN: {
    id: "OPEN",
    name: "Open Ticket",
    requestType: "OPEN",
    subject: "URGENT REQUEST TO OPEN A TICKET",
    greeting: "Dear Trade Partners",
    bodyTemplate: `Dear Trade Partners,

Kindly open ticket:
{PNR}
{PASSENGER_NAME}
`,
    isActive: true,
  },

  REFUND: {
    id: "REFUND",
    name: "Voluntary Refund",
    requestType: "REFUND",
    subject: "URGENT REQUEST TO REFUND A TICKET",
    greeting: "Dear Trade Partners",
    bodyTemplate: `Dear Trade Partners,

Kindly refund ticket voluntarily.
{PNR}
{PASSENGER_NAME}
`,
    isActive: true,
  },

  REFUND_DISRUPTION: {
    id: "REFUND_DISRUPTION",
    name: "Refund Due to Disruption",
    requestType: "REFUND_DISRUPTION",
    subject: "URGENT REQUEST TO REFUND A TICKET DUE TO DISRUPTION",
    greeting: "Dear Trade Partners",
    bodyTemplate: `Dear Trade Partners,

Kindly refund ticket voluntarily.
{PNR}
{PASSENGER_NAME}
`,
    isActive: true,
  },

  VOID: {
    id: "VOID",
    name: "Void Ticket",
    requestType: "VOID",
    subject: "URGENT REQUEST TO VOID A TICKET",
    greeting: "Dear Valued Partner",
    bodyTemplate: `Dear Valued Partner,

Kindly void ticket:
{PNR}
{PASSENGER_LIST}
`,
    isActive: true,
  },

  RESCHEDULE: {
    id: "RESCHEDULE",
    name: "Reschedule Ticket",
    requestType: "RESCHEDULE",
    subject: "URGENT REQUEST TO RESCHEDULE A TICKET",
    greeting: "Dear Trade Partner",
    bodyTemplate: `Dear Trade Partner,

Kindly reschedule ticket:
{PNR}
{PASSENGER_NAME}
{ROUTE}
{TRAVEL_DATE}
{DEPARTURE_TIME}
`,
    isActive: true,
  },

  RESCHEDULE_DISRUPTION: {
    id: "RESCHEDULE_DISRUPTION",
    name: "Reschedule Due to Disruption",
    requestType: "RESCHEDULE_DISRUPTION",
    subject: "URGENT REQUEST TO RESCHEDULE A TICKET DUE TO DISRUPTION",
    greeting: "Dear Trade Partner",
    bodyTemplate: `Dear Trade Partner,

Kindly reschedule ticket due to disruption:
{PNR}
{PASSENGER_NAME}
{ROUTE}
{TRAVEL_DATE}
{DEPARTURE_TIME}
`,
    isActive: true,
  },
};

/**
 * Get template by ID
 */
export function getTemplateById(id: string): EmailTemplateConfig | undefined {
  return EMAIL_TEMPLATES[id.toUpperCase()];
}

/**
 * Get template by request type
 */
export function getTemplateByRequestType(
  requestType: string
): EmailTemplateConfig | undefined {
  return Object.values(EMAIL_TEMPLATES).find(
    (t) => t.requestType.toUpperCase() === requestType.toUpperCase()
  );
}

/**
 * Get all active templates
 */
export function getActiveTemplates(): EmailTemplateConfig[] {
  return Object.values(EMAIL_TEMPLATES).filter((t) => t.isActive);
}

/**
 * Render template with variables
 */
export function renderTemplate(
  templateId: string,
  variables: Record<string, string>
): { subject: string; body: string } | null {
  const template = getTemplateById(templateId);
  if (!template) {
    return null;
  }

  let subject = template.subject;
  let body = template.bodyTemplate;

  // Replace all variables in both subject and body
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{${key}}`;
    subject = subject.replace(new RegExp(placeholder, "g"), value);
    body = body.replace(new RegExp(placeholder, "g"), value);
  });

  // Remove any unreplaced placeholders (as empty lines)
  body = body.replace(/\{[A-Z_]+\}\n?/g, "").trim();

  return { subject, body };
}

/**
 * Format passenger list with automatic numbering
 */
export function formatPassengerList(passengers: string[]): string {
  return passengers.map((p, i) => `${i + 1}. ${p}`).join("\n");
}

/**
 * Parse natural language command to determine request type
 */
export function parseRequestType(
  command: string
): EmailTemplateConfig["requestType"] | null {
  const normalized = command.toLowerCase().trim();

  // Exact and pattern matching
  if (
    normalized === "refund" ||
    normalized === "refund this ticket" ||
    normalized.match(/^refund\s*$/i)
  ) {
    return "REFUND";
  }

  if (
    normalized === "void" ||
    normalized === "void this ticket" ||
    normalized.match(/^void\s*$/i)
  ) {
    return "VOID";
  }

  if (
    normalized === "open" ||
    normalized === "open this ticket" ||
    normalized.match(/^open\s*$/i)
  ) {
    return "OPEN";
  }

  if (
    normalized.includes("refund") &&
    normalized.includes("disruption")
  ) {
    return "REFUND_DISRUPTION";
  }

  if (
    normalized.includes("reschedule") &&
    normalized.includes("disruption")
  ) {
    return "RESCHEDULE_DISRUPTION";
  }

  if (
    normalized === "reschedule" ||
    normalized === "reschedule this ticket" ||
    normalized.match(/^reschedule/i) ||
    normalized.match(/reschedule.*to/i)
  ) {
    return "RESCHEDULE";
  }

  return null;
}

/**
 * Extract travel details from reschedule command
 * Expects format: "Reschedule to 31/08/2026" or "Reschedule to LOS-ABV on 31/08/2026 at 7:30 AM"
 */
export function parseRescheduleDetails(command: string): {
  date?: string;
  route?: string;
  time?: string;
} {
  const details: { date?: string; route?: string; time?: string } = {};

  // Extract date (DD/MM/YYYY)
  const dateMatch = command.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (dateMatch) {
    details.date = dateMatch[1];
  }

  // Extract route (XXX-YYY)
  const routeMatch = command.match(/([A-Z]{3})\s*[-–]\s*([A-Z]{3})/i);
  if (routeMatch) {
    details.route = `${routeMatch[1].toUpperCase()}-${routeMatch[2].toUpperCase()}`;
  }

  // Extract time (HH:MM AM/PM)
  const timeMatch = command.match(/(\d{1,2}):(\d{2})\s*(?:AM|PM|am|pm)/i);
  if (timeMatch) {
    details.time = `${timeMatch[1]}:${timeMatch[2]}`;
  }

  return details;
}
