"use client";

import { useEffect, useState } from "react";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";
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

  // Restore guest identity from localStorage.
  useEffect(() => {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUser(JSON.parse(raw));
      } catch {
        localStorage.removeItem(USER_KEY);
      }
    }
  }, []);

  // With a user but no conversation, load the entry-agent choices.
  useEffect(() => {
    if (!user || conversation) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/agents");
      const { agents: list } = (await res.json()) as { agents: AgentChoice[] };
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
    const { conversation: conv } = await res.json();
    const histRes = await fetch(`/api/conversations/${conv.id}`);
    const { messages } = await histRes.json();
    setConversation(conv);
    setInitialMessages(messages ?? []);
    setLoading(false);
  }

  async function identify() {
    const name = nameInput.trim();
    if (!name) return;
    setLoading(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const { user: u } = await res.json();
    const guest = { id: u.id, name: u.name };
    localStorage.setItem(USER_KEY, JSON.stringify(guest));
    setUser(guest);
    setLoading(false);
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
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 rounded-xl border p-6 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Welcome</h1>
            <p className="text-sm text-muted-foreground">
              Enter your name to start chatting.
            </p>
          </div>
          <div className="space-y-2">
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
          <Button onClick={identify} disabled={loading || !nameInput.trim()} className="w-full">
            Start chat
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">
          Chatting as <strong>{user.name}</strong>
        </span>
        <Button variant="ghost" size="sm" onClick={reset}>
          New session / switch user
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
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-sm space-y-4 rounded-xl border p-6 shadow-sm">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Start a conversation</h2>
                <p className="text-sm text-muted-foreground">
                  Choose which agent should greet you.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="entry-agent">Agent</Label>
                <select
                  id="entry-agent"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  disabled={loading || agents.length === 0}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
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
                  <p className="text-xs text-muted-foreground">
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
