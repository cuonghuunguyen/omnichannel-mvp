import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";

// Reuse the client across hot-reloads in dev to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Build the MariaDB/MySQL pool config from DATABASE_URL
 * (e.g. mysql://app:app@localhost:3307/agents). The Prisma 7 MySQL driver
 * adapter takes discrete connection fields rather than a connection string.
 */
export function mariaConfig() {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://app:app@localhost:3307/agents");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: 5,
    // MySQL 8 defaults to caching_sha2_password; over a non-TLS dev connection
    // the driver must fetch the server's RSA public key to finish the handshake.
    allowPublicKeyRetrieval: true,
  };
}

const adapter = new PrismaMariaDb(mariaConfig());

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
