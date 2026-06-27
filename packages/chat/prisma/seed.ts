import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { mariaConfig } from "../src/lib/db";

const adapter = new PrismaMariaDb(mariaConfig());
const db = new PrismaClient({ adapter });

// The chat service owns Users (guests + human operators). Agents live in the AI
// Config API service and reference this human by id ("seed-human-agent") as a
// plain string — seed the agents there with `pnpm --filter @agent-routing/api db:seed`.
// The demo tenant the seed data belongs to. Tenants are created at runtime via
// sign-up; this well-known "default" tenant exists only so the seed human
// operator has a home (mirrored in the API DB). Sign in as "Default Tenant".
const TENANT_ID = "default";

async function main() {
  // The tenant the seed data belongs to (registry duplicated in the API DB).
  await db.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: "Default Tenant" },
  });

  const human = await db.user.upsert({
    where: { id: "seed-human-agent" },
    update: {},
    create: {
      id: "seed-human-agent",
      tenantId: TENANT_ID,
      name: "Dana (Front Desk Manager)",
      kind: "human_agent",
    },
  });

  console.log(`Seeded human operator: ${human.name} (${human.id}).`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
