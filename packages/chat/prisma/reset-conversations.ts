import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";
import { mariaConfig } from "../src/lib/db";

const db = new PrismaClient({ adapter: new PrismaMariaDb(mariaConfig()) });

async function main() {
  const m = await db.message.deleteMany({});
  const c = await db.conversation.deleteMany({});
  console.log(`Deleted ${m.count} messages, ${c.count} conversations.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
