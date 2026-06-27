-- Runs once on first container start (docker-entrypoint-initdb.d).
-- Creates the two databases the stack uses — `agents` (AI Config API) and
-- `chat` (chat service) — and grants the `app` user full access to both. Each
-- service owns its database; there are no cross-service foreign keys.
CREATE DATABASE IF NOT EXISTS agents CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS chat   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT ALL PRIVILEGES ON agents.* TO 'app'@'%';
GRANT ALL PRIVILEGES ON chat.*   TO 'app'@'%';
-- Dev convenience: `prisma migrate dev` creates a transient shadow database, so
-- the app user needs database-creation rights. This is a throwaway dev MySQL;
-- in production you'd use `prisma migrate deploy` (no shadow DB) and a scoped user.
GRANT ALL PRIVILEGES ON *.* TO 'app'@'%';
FLUSH PRIVILEGES;
