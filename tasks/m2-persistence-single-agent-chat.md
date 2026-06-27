# M2 — Persistence + single-agent guest chat ✅

- ✅ `POST /api/users` — guest identify/upsert by name (info persists)
- ✅ `POST/GET /api/conversations`, `GET /api/conversations/:id` (history as UIMessages)
- ✅ `POST /api/chat` — streams current agent, persists both sides, graceful errors
- ✅ Guest chat UI: name-gate → session → prompt-kit chat, agent badge, handoff banner placeholder
- ✅ `lib/routing.ts` — flag→agent resolution (+ deliver_to_human rule evaluator, ready for M5)
- ✅ Verified live: DeepSeek streaming reply + persistence
