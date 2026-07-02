-- Phase 41 D-06: Add per-workspace guardrail model override column to Tenant.
-- null = use the agent's own chat model as the guardrail classifier.
ALTER TABLE `Tenant` ADD COLUMN `guardModel` VARCHAR(191) NULL;
