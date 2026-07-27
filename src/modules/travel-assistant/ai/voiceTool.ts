// Shared between the voice-session mint route (server) and the WebRTC hook
// (client) so the tool name can never drift between where it's declared to
// OpenAI and where the client recognizes it on the data channel. Contains
// no secrets — safe to import from client code.
export const ROUTE_TO_TRAVEL_ASSISTANT_TOOL_NAME = "route_to_travel_assistant";

export const ROUTE_TO_TRAVEL_ASSISTANT_TOOL = {
  type: "function",
  name: ROUTE_TO_TRAVEL_ASSISTANT_TOOL_NAME,
  description:
    "Send a flight search, Book-on-Hold, or sales-report request to the full text assistant, which has live flight search, the booking automation, and the reporting engine. Restate the user's request clearly and completely as text, including any route, dates, or passenger details (name, phone, email) they've given you in this conversation — the tool has no memory of the voice conversation beyond what you pass it here.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The user's request restated as a complete text message — e.g. \"search flights from Lagos to Abuja tomorrow\" or \"book Enugu Air Lagos to Abuja tomorrow for John Doe, john@email.com, 08012345678\".",
      },
    },
    required: ["message"],
  },
} as const;
