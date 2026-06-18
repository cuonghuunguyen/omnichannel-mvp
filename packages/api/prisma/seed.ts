import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./agents.db",
});
const db = new PrismaClient({ adapter });

// The human operator that escalations route to. The User row itself lives in the
// chat service's DB (seeded there); agents reference it by this well-known id as
// a plain string (no cross-service FK).
const HUMAN_ID = "seed-human-agent";

// Demo domain: "Azure Bay Hotel & Resort" — an online booking/concierge service.
// A Concierge greets every guest and routes to Reservations (book/modify rooms)
// or Guest Services (in-stay help), escalating billing disputes to a human.
async function main() {
  // Default entry agent: the Concierge greets the guest and routes. It carries
  // guardrails (broad hotel scope) so off-topic/injection is blocked at the door.
  await db.agent.upsert({
    where: { id: "seed-triage" },
    update: {},
    create: {
      id: "seed-triage",
      name: "Concierge",
      description:
        "Front-desk concierge for Azure Bay Hotel. Greets the guest, figures out what they need, and hands off to Reservations or Guest Services (or a human for billing disputes).",
      systemPrompt:
        "You are the front-desk concierge for Azure Bay Hotel & Resort. Greet the guest warmly and briefly, " +
        "and determine whether they want to book/change a stay (Reservations) or need help during/after a stay " +
        "such as amenities, check-in, or in-room issues (Guest Services). Use deliver_to_agent to hand off to the " +
        "right specialist. If the guest is upset, asks for a person, or mentions a billing dispute, refund, or " +
        "chargeback, use deliver_to_human. Keep your own messages short and welcoming.",
      isDefault: true,
      isRoutable: false,
      builtinTools: JSON.stringify({
        sendMessage: true,
        deliverToAgent: true,
        deliverToHuman: true,
      }),
      handoffRules: JSON.stringify([
        { when: { keywords: ["refund", "dispute", "chargeback", "billing"] }, assignTo: HUMAN_ID },
        { when: {}, assignTo: "queue" },
      ]),
      guardrails: JSON.stringify({
        enabled: true,
        scope:
          "Anything related to Azure Bay Hotel & Resort: room bookings and availability, rates and packages, " +
          "amenities, check-in/check-out, on-site services, and existing reservations. " +
          "Do not help with anything unrelated (coding help, homework, general knowledge, other companies, etc.).",
        refusal:
          "I'm the Azure Bay concierge, so I can only help with your stay and reservations here. " +
          "I can't help with that — but I'd be glad to connect you to a member of our team if you'd like.",
      }),
    },
  });

  // Reservations specialist: rooms, rates, packages, booking and changes.
  await db.agent.upsert({
    where: { id: "seed-sales" },
    update: {},
    create: {
      id: "seed-sales",
      name: "Reservations",
      description:
        "Handles room availability, rates, packages, and booking, changing, or cancelling reservations.",
      systemPrompt:
        "You are a warm, efficient reservations specialist for Azure Bay Hotel & Resort. Help guests check room " +
        "availability, explain room types, rates, and packages, and book, modify, or cancel reservations. Ask for " +
        "the dates, number of guests, and room preference when booking. If the guest needs help during their stay " +
        "(amenities, check-in, in-room issues), use deliver_to_agent to Guest Services. For billing disputes or " +
        "refunds, use deliver_to_human. When the guest is all set and says goodbye, give a short farewell and use " +
        "end_conversation to close it.",
      isRoutable: true,
      builtinTools: JSON.stringify({ sendMessage: true, deliverToAgent: true, deliverToHuman: true, endConversation: true }),
      handoffRules: JSON.stringify([{ when: {}, assignTo: "queue" }]),
      guardrails: JSON.stringify({
        enabled: true,
        scope:
          "Room availability, rates, packages, and booking, modifying, or cancelling reservations at Azure Bay " +
          "Hotel & Resort. Do not help with anything unrelated (coding help, homework, general knowledge, etc.).",
        refusal:
          "I'm the Reservations assistant, so I can only help with bookings, rates, and availability at Azure Bay. " +
          "I can't help with that — but I can connect you to a human if you'd like.",
      }),
    },
  });

  // Guest Services specialist: in-stay help, amenities, and issue resolution.
  await db.agent.upsert({
    where: { id: "seed-support" },
    update: {},
    create: {
      id: "seed-support",
      name: "Guest Services",
      description:
        "Helps current and arriving guests with check-in/out, amenities, on-site services, and in-room issues.",
      systemPrompt:
        "You are a patient, attentive guest-services specialist for Azure Bay Hotel & Resort. Help guests with " +
        "check-in and check-out, amenities and hours (pool, spa, gym, restaurant), Wi-Fi, housekeeping requests, " +
        "and in-room issues (AC, TV, etc.). If the guest wants to book or change a reservation, use deliver_to_agent " +
        "to Reservations. If you cannot resolve the issue or the guest asks for a person, use deliver_to_human. Once " +
        "the issue is resolved and the guest confirms they're all set, give a short farewell and use end_conversation to close it.",
      isRoutable: true,
      builtinTools: JSON.stringify({ sendMessage: true, deliverToAgent: true, deliverToHuman: true, endConversation: true }),
      handoffRules: JSON.stringify([{ when: {}, assignTo: HUMAN_ID }]),
      guardrails: JSON.stringify({
        enabled: true,
        scope:
          "In-stay guest support for Azure Bay Hotel & Resort: check-in/out, amenities, on-site services, Wi-Fi, " +
          "housekeeping, and in-room issues. Do not help with anything unrelated (coding help, homework, general knowledge, etc.).",
        refusal:
          "I'm the Azure Bay Guest Services assistant, so I can only help with your stay and on-site services. " +
          "I can't help with that — but I can connect you to a human if you'd like.",
      }),
    },
  });

  console.log("Seeded 3 AI agents (Concierge default, Reservations, Guest Services).");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
