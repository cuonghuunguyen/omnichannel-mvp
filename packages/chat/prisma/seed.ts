import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const db = new PrismaClient({ adapter });

// The chat service owns Users (guests + human operators). Agents live in the AI
// Config API service and reference this human by id ("seed-human-agent") as a
// plain string — seed the agents there with `pnpm --filter @agent-routing/api db:seed`.
async function main() {
  const human = await db.user.upsert({
    where: { id: "seed-human-agent" },
    update: {},
    create: {
      id: "seed-human-agent",
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
