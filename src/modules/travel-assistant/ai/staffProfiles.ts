// TDIS Staff Personality & Intelligence Profiles
// ------------------------------------------------
// Internal people-intelligence knowledge base for the TDIS Assistant. Sourced
// from the "TDIS Staff Personality & Intelligence Profile" internal document.
//
// These are WORKING personality models — descriptive observations, not fixed
// truths. They should evolve only when new, trusted internal information is
// provided. Keep this file as the single place to update: edit an entry here
// (or add a new one) and the chatbot picks it up automatically — no prompt or
// orchestration logic needs to change.
//
// Rules the assistant must honour when answering (encoded in STAFF_KNOWLEDGE
// below): answer briefly and respectfully, never invent traits or personal
// details, and never add negative or sensitive information.

export interface StaffProfile {
  /** Display name or title the assistant should use. */
  name: string;
  /** Common ways a user might refer to this person (lowercased, no punctuation). */
  aliases: string[];
  /** Role / position within TDIS, if documented. */
  role: string;
  /** Documented strengths and the value they bring. */
  strengths: string;
  /** One-line summary the assistant can lead with. */
  summary: string;
}

// Order roughly follows the source document (Managing Director first).
export const STAFF_PROFILES: StaffProfile[] = [
  {
    name: "Mr. Adewale Adelabu",
    aliases: [
      "adewale adelabu",
      "adewale",
      "adelabu",
      "mr adewale",
      "mr adelabu",
      "managing director",
      "md",
      "the md",
      "director",
    ],
    role: "Managing Director of TDIS — strategic anchor of the organization",
    strengths:
      "Vision-driven leadership: listens first, solves customer problems before selling, empowers people, thinks long-term, executes decisively, and develops those around him.",
    summary:
      "Managing Director of TDIS and its strategic anchor — a vision-driven leader focused on people and long-term growth.",
  },
  {
    name: "Bisi",
    aliases: ["bisi"],
    role: "Team member",
    strengths:
      "Compassion and empathy — considers people first and brings emotional intelligence to interactions.",
    summary: "Known for empathy, care, and supporting colleagues.",
  },
  {
    name: "Kate",
    aliases: ["kate"],
    role: "Team member",
    strengths:
      "Resilience and perseverance — continues performing steadily despite pressure and workload.",
    summary: "Recognized for resilience, persistence, and commitment.",
  },
  {
    name: "Akeeb",
    aliases: ["akeeb"],
    role: "Team member",
    strengths:
      "Speed, execution, and urgency — focused on getting work done quickly and keeping momentum.",
    summary: "Known for execution, responsiveness, and momentum.",
  },
  {
    name: "Precious",
    aliases: ["precious"],
    role: "Team member",
    strengths:
      "Consistency and dependable daily effort — builds success through discipline and reliability.",
    summary: "Recognized for consistency and dependable execution.",
  },
  {
    name: "Florence",
    aliases: ["florence"],
    role: "Team member",
    strengths:
      "Joy, positivity, and uplifting morale — helps create a welcoming environment for the team.",
    summary: "Known for positive energy and encouraging team spirit.",
  },
  {
    name: "Shola",
    aliases: ["shola"],
    role: "Team member",
    strengths:
      "Unity, collaboration, and teamwork — connects people and supports collective success.",
    summary: "Known for collaboration and bringing people together.",
  },
  {
    name: "Muhammad Abdulwahab",
    aliases: ["muhammad abdulwahab", "muhammad", "muhammed", "abdulwahab"],
    role: "Team member — versatility and systems thinking",
    strengths:
      "Versatility and systems thinking — connects business, technology, operations, HR, design, marketing, and automation to solve problems holistically, favouring scalable systems and continuous improvement.",
    summary: "Known for versatility, innovation, and connecting ideas across disciplines.",
  },
];

function renderProfile(p: StaffProfile): string {
  return [
    `- ${p.name}`,
    `  Role: ${p.role}`,
    `  Strengths: ${p.strengths}`,
    `  One-line summary: "${p.summary}"`,
  ].join("\n");
}

// The block injected into the assistant's context. It carries both the data
// and the behavioural guardrails so answers stay respectful and grounded.
export const STAFF_KNOWLEDGE = `TDIS PEOPLE KNOWLEDGE (internal team profiles):
You also know the TDIS team. When a user asks about a team member (or "who is X",
"tell me about X", "what is X known for"), answer with a concise, professional
summary of that person's role, strengths, and contribution to TDIS.

RULES for people questions:
- Keep it brief — 2 to 4 sentences — unless the user explicitly asks for more detail.
- Use ONLY what is documented below. Never invent roles, traits, achievements, or
  personal/sensitive details, and never add negative characteristics.
- These are working, evolving observations, not absolute facts. If asked for something
  not documented, say you don't have that on record rather than guessing.
- Maintain a warm, respectful, professional tone.
- If asked about someone not listed here, say you don't have a profile for them yet.

Profiles:
${STAFF_PROFILES.map(renderProfile).join("\n")}`;
