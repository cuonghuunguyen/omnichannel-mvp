"use client";

import { useEffect, useState } from "react";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";
import { api } from "@/lib/api";
import { ChatView } from "@/components/chat/chat-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GuestUser = { id: string; name: string };
type Conversation = {
  id: string;
  assignmentType: "ai" | "human";
  status: string;
};
type AgentChoice = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isRoutable: boolean;
};

const USER_KEY = "agent-routing.guest";

export function ChatApp() {
  const [user, setUser] = useState<GuestUser | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [initialMessages, setInitialMessages] = useState<ChatUIMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Entry-agent picker state (shown before a conversation starts).
  const [agents, setAgents] = useState<AgentChoice[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  // Restore guest identity from localStorage. We optimistically use the stored
  // user, then re-identify by name in the background so a stale id (e.g. after a
  // DB reset wiped the user) self-heals to a valid one before any DB write.
  useEffect(() => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return;
    let stored: GuestUser;
    try {
      stored = JSON.parse(raw);
    } catch {
      localStorage.removeItem(USER_KEY);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(stored);
    loginByName(stored.name).then((guest) => {
      if (guest) setUser(guest);
    });
  }, []);

  // With a user but no conversation, load the entry-agent choices.
  useEffect(() => {
    if (!user || conversation) return;
    let cancelled = false;
    (async () => {
      const { data } = await api.GET("/agents");
      const list: AgentChoice[] = data?.agents ?? [];
      if (cancelled) return;
      // Agents that can serve as an entry point: the default plus routable ones.
      const entry = list.filter((a) => a.isDefault || a.isRoutable);
      setAgents(entry);
      setSelectedAgentId(entry.find((a) => a.isDefault)?.id ?? entry[0]?.id ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [user, conversation]);

  async function startConversation() {
    if (!user) return;
    setLoading(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // routingFlag = chosen agent id; backend falls back to default if empty.
      body: JSON.stringify({ userId: user.id, routingFlag: selectedAgentId || undefined }),
    });
    if (!res.ok) {
      // The stored user no longer exists (e.g. the DB was reset) — drop the
      // stale identity and send the guest back to the name gate to re-identify.
      setLoading(false);
      reset();
      return;
    }
    const { conversation: conv } = await res.json();
    // A freshly created conversation has no history yet, so skip the extra
    // round-trip to GET /api/conversations/{id} — it would always return [].
    setConversation(conv);
    setInitialMessages([]);
    setLoading(false);
  }

  // Identify/upsert a guest by name, persisting the returned (valid) id.
  async function loginByName(name: string): Promise<GuestUser | null> {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const { user: u } = await res.json();
    const guest = { id: u.id, name: u.name };
    localStorage.setItem(USER_KEY, JSON.stringify(guest));
    return guest;
  }

  async function identify() {
    const name = nameInput.trim();
    if (!name) return;
    setLoading(true);
    const guest = await loginByName(name);
    setLoading(false);
    if (guest) setUser(guest);
  }

  function reset() {
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setConversation(null);
    setInitialMessages([]);
    setNameInput("");
  }

  if (!user) {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden p-6">
        <div className="orb top-[-6rem] left-[-4rem] h-72 w-72 bg-gradient-lavender" />
        <div className="orb right-[-5rem] bottom-[-7rem] h-80 w-80 bg-gradient-mint" />
        <div className="relative z-10 w-full max-w-sm space-y-8 rounded-2xl border border-border bg-surface-card/90 p-8 shadow-[0_4px_16px_rgba(0,0,0,0.04)] backdrop-blur-sm">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
              Agent Routing
            </p>
            <h1 className="text-4xl font-light leading-tight tracking-[-0.96px] text-ink">
              Welcome
            </h1>
            <p className="text-sm leading-relaxed text-body">
              Enter your name to start a conversation with our agents.
            </p>
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && identify()}
              placeholder="e.g. Alex"
              autoFocus
            />
          </div>
          <Button
            onClick={identify}
            disabled={loading || !nameInput.trim()}
            className="w-full"
          >
            {loading ? "One moment…" : "Start chat"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-canvas-soft px-6 py-4">
        <span className="text-sm font-medium text-body">
          Chatting as <span className="font-semibold text-ink">{user.name}</span>
        </span>
        <Button variant="outline" size="sm" onClick={reset}>
          Switch user
        </Button>
      </header>
      <div className="flex-1 overflow-hidden">
        {conversation ? (
          <ChatView
            conversationId={conversation.id}
            initialMessages={initialMessages}
            initialAssignment={conversation.assignmentType}
            initialStatus={conversation.status}
          />
        ) : (
          <div className="relative flex h-full items-center justify-center overflow-hidden p-6">
            <div className="orb top-[-7rem] right-[-5rem] h-80 w-80 bg-gradient-peach" />
            <div className="orb bottom-[-6rem] left-[-4rem] h-72 w-72 bg-gradient-sky" />
            <div className="relative z-10 w-full max-w-sm space-y-8 rounded-2xl border border-border bg-surface-card/90 p-8 shadow-[0_4px_16px_rgba(0,0,0,0.04)] backdrop-blur-sm">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
                  New conversation
                </p>
                <h2 className="text-3xl font-light leading-tight tracking-[-0.72px] text-ink">
                  Who should help you?
                </h2>
                <p className="text-sm leading-relaxed text-body">
                  Pick an agent to greet you — you can always be routed elsewhere.
                </p>
              </div>
              <div className="space-y-2.5">
                <Label htmlFor="entry-agent">Agent</Label>
                <select
                  id="entry-agent"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  disabled={loading || agents.length === 0}
                  className="h-11 w-full rounded-md border border-hairline-strong bg-surface-card px-4 text-sm text-ink outline-none transition-colors focus-visible:border-2 focus-visible:border-ink disabled:opacity-50"
                >
                  {agents.length === 0 && <option value="">Loading agents…</option>}
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                {selectedAgentId && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {agents.find((a) => a.id === selectedAgentId)?.description}
                  </p>
                )}
              </div>
              <Button
                onClick={startConversation}
                disabled={loading || !selectedAgentId}
                className="w-full"
              >
                {loading ? "Starting…" : "Start chat"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
