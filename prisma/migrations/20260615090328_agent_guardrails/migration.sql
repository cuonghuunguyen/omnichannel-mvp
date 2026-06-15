-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "isRoutable" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "builtinTools" TEXT NOT NULL DEFAULT '{}',
    "customTools" TEXT NOT NULL DEFAULT '[]',
    "mcpServers" TEXT NOT NULL DEFAULT '[]',
    "handoffRules" TEXT NOT NULL DEFAULT '[]',
    "guardrails" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Agent" ("builtinTools", "createdAt", "customTools", "description", "handoffRules", "id", "isDefault", "isRoutable", "mcpServers", "model", "name", "systemPrompt", "temperature", "updatedAt") SELECT "builtinTools", "createdAt", "customTools", "description", "handoffRules", "id", "isDefault", "isRoutable", "mcpServers", "model", "name", "systemPrompt", "temperature", "updatedAt" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
