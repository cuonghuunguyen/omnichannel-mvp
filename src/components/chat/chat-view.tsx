"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, ArrowRightLeft, BookOpen, CircleCheck, Square, UserRound } from "lucide-react";
import type { ChatUIMessage } from "@/lib/agents/ui-messages";
import {
  ChatContainerContent,
  ChatContainerRoot,
} from "@/components/ui/chat-container";
import { Message, MessageContent } from "@/components/ui/message";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { ScrollButton } from "@/components/ui/scroll-button";
import { Loader } from "@/components/ui/loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ChatView({
  conversationId,
  initialMessages,
  initialAssignment,
  initialStatus,
}: {
  conversationId: string;
  initialMessages: ChatUIMessage[];
  initialAssignment: "ai" | "human";
  initialStatus: string;
}) {
  const [input, setInput] = useState("");
  const [assignment, setAssignment] = useState(initialAssignment);
  const [closed, setClosed] = useState(initialStatus === "closed");
  const containerRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, setMessages } = useChat<ChatUIMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { conversationId },
    }),
  });

  // Seed history once on mount.
  useEffect(() => {
    if (initialMessages.length) setMessages(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates: append human-operator replies and react to escalation. The
  // guest ignores "ai"/"guest" echoes — those already arrive via useChat.
  useEffect(() => {
    const es = new EventSource(`/api/conversations/${conversationId}/stream`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.kind === "status") {
        if (event.status === "closed") setClosed(true);
        setAssignment(event.assignmentType === "human" ? "human" : "ai");
      } else if (event.kind === "message" && event.origin === "human") {
        const msg = event.message as ChatUIMessage;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
        );
        setAssignment("human");
      }
    };
    return () => es.close();
  }, [conversationId, setMessages]);

  const isBusy = status === "submitted" || status === "streaming";

  const submit = () => {
    const text = input.trim();
    if (!text || isBusy || closed) return;
    sendMessage({ text });
    setInput("");
  };

  const escalateToHuman = async () => {
    setAssignment("human");
    await fetch(`/api/conversations/${conversationId}/escalate`, {
      method: "POST",
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
            {messages.map((m) => {
              const isUser = m.role === "user";
              const text = m.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("");
              const routings = m.parts.filter((p) => p.type === "data-routing");
              const guardrails = m.parts.filter(
                (p) => p.type === "data-guardrail",
              );
              const knowledge = m.parts.filter((p) => p.type === "data-knowledge");
              return (
                <div key={m.id} className="space-y-2">
                  {text.trim() && (
                    <Message
                      className={isUser ? "justify-end" : "justify-start"}
                    >
                      <div className="flex max-w-[80%] flex-col gap-1">
                        {!isUser && m.metadata?.agentName && (
                          <Badge
                            variant={
                              m.metadata.authorKind === "human"
                                ? "default"
                                : "secondary"
                            }
                            className="flex w-fit items-center gap-1 text-xs"
                          >
                            {m.metadata.authorKind === "human" && (
                              <UserRound className="size-3" />
                            )}
                            {m.metadata.agentName}
                          </Badge>
                        )}
                        <MessageContent
                          markdown={!isUser}
                          className={
                            isUser
                              ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground"
                              : "rounded-2xl rounded-bl-md border border-border bg-surface-card px-4 py-2.5 text-ink"
                          }
                        >
                          {text}
                        </MessageContent>
                      </div>
                    </Message>
                  )}
                  {knowledge.map((p, i) => (
                    <div
                      key={`${m.id}-kb-${i}`}
                      className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <BookOpen className="size-3.5" />
                      <span>
                        {p.data.resultCount > 0
                          ? `Searched knowledge base — ${p.data.resultCount} source${
                              p.data.resultCount === 1 ? "" : "s"
                            }`
                          : "Searched knowledge base — no matches"}
                      </span>
                    </div>
                  ))}
                  {routings.map((p, i) => (
                    <div
                      key={`${m.id}-routing-${i}`}
                      className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
                    >
                      {p.data.kind === "human" ? (
                        <>
                          <UserRound className="size-3.5" />
                          <span>Escalated to a human agent</span>
                        </>
                      ) : p.data.kind === "end" ? (
                        <>
                          <CircleCheck className="size-3.5" />
                          <span>Conversation ended</span>
                        </>
                      ) : (
                        <>
                          <ArrowRightLeft className="size-3.5" />
                          <span>Routed to {p.data.agentName}</span>
                        </>
                      )}
                    </div>
                  ))}
                  {guardrails.map((p, i) =>
                    p.data.offerHuman && assignment !== "human" && !closed ? (
                      <div
                        key={`${m.id}-guard-${i}`}
                        className="flex justify-start"
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={escalateToHuman}
                        >
                          <UserRound className="size-3.5" /> Connect me to a human
                        </Button>
                      </div>
                    ) : null,
                  )}
                </div>
              );
            })}
            {status === "submitted" && (
              <Message className="justify-start">
                <Loader variant="typing" />
              </Message>
            )}
          </ChatContainerContent>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <ScrollButton />
          </div>
        </ChatContainerRoot>
      </div>

      <div className="border-t border-border bg-canvas-soft p-4">
        {closed ? (
          <p className="text-center text-sm text-muted-foreground">
            This conversation has ended.
          </p>
        ) : (
          <>
            {assignment === "human" && (
              <p className="mb-3 flex items-center justify-center gap-1.5 text-center text-sm text-muted-foreground">
                <UserRound className="size-3.5" />
                You&apos;re connected to a human agent.
              </p>
            )}
            <PromptInput
              value={input}
              onValueChange={setInput}
              isLoading={isBusy}
              onSubmit={submit}
              maxHeight={200}
              className="mx-auto w-full max-w-2xl border-hairline-strong bg-surface-card"
            >
              <PromptInputTextarea placeholder="Type your message…" />
              <PromptInputActions className="justify-end pt-2">
                <PromptInputAction tooltip={isBusy ? "Working…" : "Send"}>
                  <Button
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={submit}
                    disabled={isBusy || !input.trim()}
                  >
                    {isBusy ? (
                      <Square className="size-4 fill-current" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </PromptInput>
          </>
        )}
      </div>
    </div>
  );
}
