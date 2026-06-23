"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SendHorizontal, UserRound } from "lucide-react";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Operator = { id: string; name: string };
type ConversationRow = {
  id: string;
  status: string;
  assignmentType: string;
  humanAgentId: string | null;
  updatedAt: string;
  user?: { name: string } | null;
  currentAgentName?: string | null;
};

const INBOX_STATUSES = "escalated,assigned";

export function Inbox() {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatUIMessage[]>([]);
  const [reply, setReply] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const claimedByMe = selected?.humanAgentId === operator?.id;

  const refreshList = useCallback(async () => {
    const res = await fetch(`/api/conversations?status=${INBOX_STATUSES}`);
    const { conversations: list } = await res.json();
    setConversations(list ?? []);
  }, []);

  // Identify the operator (first human agent) and load the queue; poll for new
  // escalations.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/users?kind=human_agent");
      const { users } = await res.json();
      if (users?.[0]) setOperator({ id: users[0].id, name: users[0].name });
    })();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch
    refreshList();
    // Poll only to discover brand-new escalations; status changes on the
    // selected conversation already arrive via its SSE stream (see below), so
    // a long interval is plenty and keeps idle operators off the network.
    const t = setInterval(refreshList, 15000);
    return () => clearInterval(t);
  }, [refreshList]);

  // Load history + subscribe to live updates for the selected conversation.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/conversations/${selectedId}`);
      const { messages: history } = await res.json();
      if (!cancelled) setMessages(history ?? []);
    })();

    const es = new EventSource(`/api/conversations/${selectedId}/stream`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.kind === "message") {
        const msg = event.message as ChatUIMessage;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
        );
      } else if (event.kind === "status") {
        refreshList();
      }
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [selectedId, refreshList]);

  // Keep the thread scrolled to the latest message.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  async function claim() {
    if (!selected || !operator) return;
    await fetch(`/api/conversations/${selected.id}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanAgentId: operator.id }),
    });
    await refreshList();
  }

  async function closeConversation() {
    if (!selected) return;
    if (!confirm("Close this conversation? The guest can no longer send messages."))
      return;
    await fetch(`/api/conversations/${selected.id}/close`, { method: "POST" });
    setSelectedId(null);
    setMessages([]);
    await refreshList();
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text || !selected || !operator) return;
    setReply("");
    const res = await fetch(`/api/conversations/${selected.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, humanAgentId: operator.id }),
    });
    const { message } = await res.json();
    if (message) {
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
    }
  }

  return (
    <div className="flex h-full">
      {/* Queue */}
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-canvas-soft">
        <div className="flex items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
          <span>Escalated</span>
          {operator && <span className="normal-case tracking-normal">You: {operator.name}</span>}
        </div>
        {conversations.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No escalations yet.
          </p>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={cn(
              "flex w-full flex-col items-start gap-1.5 border-b border-border px-4 py-3 text-left text-sm transition-colors hover:bg-surface-strong",
              selectedId === c.id && "bg-surface-card",
            )}
          >
            <span className="font-medium text-ink">{c.user?.name ?? "Guest"}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge
                variant={c.status === "assigned" ? "default" : "destructive"}
                className="text-[10px]"
              >
                {c.status}
              </Badge>
              {c.humanAgentId && <span>claimed</span>}
            </span>
          </button>
        ))}
      </aside>

      {/* Thread */}
      <section className="flex flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation to view it.
          </div>
        ) : (
          <>
            <header className="flex h-16 items-center justify-between border-b border-border px-6">
              <span className="text-base font-medium text-ink">
                {selected.user?.name ?? "Guest"}
              </span>
              <div className="flex items-center gap-2">
                {!claimedByMe && (
                  <Button size="sm" onClick={claim}>
                    Claim
                  </Button>
                )}
                {claimedByMe && (
                  <Badge variant="secondary" className="text-xs">
                    Claimed by you
                  </Badge>
                )}
                <Button size="sm" variant="outline" onClick={closeConversation}>
                  Close
                </Button>
              </div>
            </header>

            <div ref={threadRef} className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto p-6">
              {messages.map((m) => {
                const isOperator = m.metadata?.authorKind === "human";
                const isGuest = m.role === "user";
                const text = m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join("");
                if (!text.trim()) return null;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-1",
                      isOperator ? "items-end" : "items-start",
                    )}
                  >
                    {!isGuest && m.metadata?.agentName && (
                      <Badge
                        variant={isOperator ? "default" : "secondary"}
                        className="flex items-center gap-1 text-[10px]"
                      >
                        {isOperator && <UserRound className="size-3" />}
                        {m.metadata.agentName}
                      </Badge>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] whitespace-pre-wrap px-4 py-2.5 text-sm",
                        isOperator
                          ? "rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                          : isGuest
                            ? "rounded-2xl rounded-bl-md bg-surface-strong text-ink"
                            : "rounded-2xl rounded-bl-md border border-border bg-surface-card text-ink",
                      )}
                    >
                      {text}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border bg-canvas-soft p-4">
              {claimedByMe ? (
                <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
                  <Textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                    placeholder="Reply to the guest…"
                    className="min-h-[44px] flex-1 resize-none rounded-xl border-hairline-strong bg-surface-card"
                  />
                  <Button
                    size="icon"
                    onClick={sendReply}
                    disabled={!reply.trim()}
                    className="size-11 shrink-0"
                  >
                    <SendHorizontal className="size-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  Claim this conversation to reply.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
