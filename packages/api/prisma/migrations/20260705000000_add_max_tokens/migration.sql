-- Add per-agent max response token budget (maps to AI SDK maxOutputTokens).
-- Default 1024 keeps existing agents on a sensible reply length.
ALTER TABLE `Agent` ADD COLUMN `maxTokens` INT NOT NULL DEFAULT 1024;
