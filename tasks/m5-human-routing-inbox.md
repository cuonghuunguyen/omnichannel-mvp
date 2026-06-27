# M5 — Human routing + inbox ✅

- ✅ `deliver_to_human` evaluates `handoffRules` (in `/api/chat`) → sets `assignmentType=human`, `status=escalated`, `humanAgentId` (rule match or queue=null)
- ✅ `/api/chat` gates: `assignmentType==="human"` persists+broadcasts the guest message then returns an empty UI stream (no LLM)
- ✅ `lib/events.ts` in-process pub/sub (globalThis singleton); `GET /api/conversations/:id/stream` (SSE, heartbeat); `POST /api/conversations/:id/messages` (human reply, authored by human_agent User); `POST /api/conversations/:id/claim`
- ✅ `GET /api/conversations?status=escalated,assigned` (admin list w/ user+agent names); `GET /api/users?kind=human_agent`
- ✅ Admin `/inbox` (`components/inbox/inbox.tsx`): queue (polled 5s), claim, thread, reply box; live via SSE
- ✅ Guest live updates: `chat-view` opens SSE, appends human replies (dedupe by id), flips banner on escalation; human-author badge
- ✅ `messages.ts` `toUIMessage` resolves AI vs human author → `metadata.authorKind`/`agentName`; history GET joins `authorAgent`+`authorUser`
- ✅ Verified live: refund msg → escalated/human/seed-human-agent; gated guest follow-up returns `[DONE]` only; claim→reply reaches guest SSE; guest msg reaches inbox SSE; reload shows correct per-author badges
