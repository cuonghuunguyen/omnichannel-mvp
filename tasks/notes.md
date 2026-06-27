# Notes / decisions

- No auth in v1 (admin routes open locally); guest = name only.
- DeepSeek key in `.env` (`DEEPSEEK_API_KEY`), gitignored. `resolveModel()` routes by prefix.
- Handoff tools NOT built until M4 — Triage can talk but can't actually route yet.
- Dev: `pnpm dev`. Reset sessions: `tsx prisma/reset-conversations.ts`. Re-seed: `pnpm db:seed`.
