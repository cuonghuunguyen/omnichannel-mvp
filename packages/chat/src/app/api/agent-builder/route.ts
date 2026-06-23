// Admin-only: proxies the config-builder conversation to the AI Config API and
// streams its UIMessage response (text + config/knowledge proposal parts) back to
// the browser. Stateless — unlike /api/chat there's no conversation DB or SSE bus;
// the builder produces a draft the admin reviews and saves via the agents API.
export const maxDuration = 60;

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? "";

export async function POST(req: Request) {
  // The AI SDK transport sends { messages, ... }; the builder panel adds the
  // draft built so far via the transport body, so we forward the whole payload.
  const body = await req.json();

  const upstream = await fetch(`${API_URL}/agent-builder`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({
      messages: body.messages ?? [],
      currentDraft: body.currentDraft ?? null,
      editing: body.editing ?? false,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(JSON.stringify({ error: "builder service error", detail }), {
      status: 502,
    });
  }

  // Pass the AI SDK stream straight through, preserving its headers so the
  // client `useChat` parses it correctly.
  const headers = new Headers();
  for (const key of ["content-type", "cache-control", "x-vercel-ai-ui-message-stream"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
