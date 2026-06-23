"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, ArrowRightLeft, BookOpen, CircleCheck, Square, UserRound } from "lucide-react";
import type {
  ChatUIMessage,
  GuardrailDataPart,
  KnowledgeDataPart,
  RoutingDataPart,
} from "@/lib/agents/ui-messages";
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

/**
 * One rendered block inside an assistant turn. The AI SDK collapses a whole
 * orchestration response (which may span several agents) into a single
 * UIMessage, so we split that message back into per-agent bubbles + transition
 * chips by walking its parts in order. A `data-routing` of kind "agent" both
 * emits its chip and switches the author for everything that follows — so the
 * answering agent's text lands in its own bubble instead of being appended to
 * the previous agent's. (Reloaded history already arrives as separate messages,
 * one per hop, so this is a no-op there.)
 */
type RenderBlock =
  | { kind: "text"; agentName?: string; authorKind?: "ai" | "human"; text: string }
  | { kind: "knowledge"; data: KnowledgeDataPart }
  | { kind: "routing"; data: RoutingDataPart }
  | { kind: "guardrail"; data: GuardrailDataPart };

function toRenderBlocks(message: ChatUIMessage): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let agentName = message.metadata?.agentName;
  let authorKind = message.metadata?.authorKind;
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) blocks.push({ kind: "text", agentName, authorKind, text: buffer });
    buffer = "";
  };
  for (const part of message.parts) {
    if (part.type === "text") {
      buffer += part.text;
    } else if (part.type === "data-knowledge") {
      flush();
      blocks.push({ kind: "knowledge", data: part.data });
    } else if (part.type === "data-routing") {
      flush();
      blocks.push({ kind: "routing", data: part.data });
      if (part.data.kind === "agent") {
        agentName = part.data.agentName;
        authorKind = "ai";
      }
    } else if (part.type === "data-guardrail") {
      flush();
      blocks.push({ kind: "guardrail", data: part.data });
    }
  }
  flush();
  return blocks;
}

/**
 * A single user turn. Memoized so it only re-renders when its own message
 * object changes — typing in the composer or other messages streaming in
 * won't touch it.
 */
const UserTurn = memo(function UserTurn({ message }: { message: ChatUIMessage }) {
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
  if (!text.trim()) return null;
  return (
    <div className="space-y-2">
      <Message className="justify-end">
        <div className="flex max-w-[80%] flex-col gap-1">
          <MessageContent className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">
            {text}
          </MessageContent>
        </div>
      </Message>
    </div>
  );
});

/**
 * A single assistant turn, split into per-agent bubbles + transition chips.
 * `toRenderBlocks` runs through `useMemo` keyed on the message, so during
 * streaming only the message whose parts changed recomputes its blocks; all
 * settled turns are skipped. `assignment`/`closed` only gate the guardrail
 * "connect me to a human" button.
 */
const AssistantTurn = memo(function AssistantTurn({
  message,
  assignment,
  closed,
  onEscalate,
}: {
  message: ChatUIMessage;
  assignment: "ai" | "human";
  closed: boolean;
  onEscalate: () => void;
}) {
  const blocks = useMemo(() => toRenderBlocks(message), [message]);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const key = `${message.id}-${i}`;
        if (block.kind === "text") {
          return (
            <Message key={key} className="justify-start">
              <div className="flex max-w-[80%] flex-col gap-1">
                {block.agentName && (
                  <Badge
                    variant={
                      block.authorKind === "human" ? "default" : "secondary"
                    }
                    className="flex w-fit items-center gap-1 text-xs"
                  >
                    {block.authorKind === "human" && (
                      <UserRound className="size-3" />
                    )}
                    {block.agentName}
                  </Badge>
                )}
                <MessageContent
                  markdown
                  className="rounded-2xl rounded-bl-md border border-border bg-surface-card px-4 py-2.5 text-ink"
                >
                  {block.text}
                </MessageContent>
              </div>
            </Message>
          );
        }
        if (block.kind === "knowledge") {
          return (
            <div
              key={key}
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
            >
              <BookOpen className="size-3.5" />
              <span>
                {block.data.resultCount > 0
                  ? `Searched knowledge base — ${block.data.resultCount} source${
                      block.data.resultCount === 1 ? "" : "s"
                    }`
                  : "Searched knowledge base — no matches"}
              </span>
            </div>
          );
        }
        if (block.kind === "routing") {
          return (
            <div
              key={key}
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"
            >
              {block.data.kind === "human" ? (
                <>
                  <UserRound className="size-3.5" />
                  <span>Escalated to a human agent</span>
                </>
              ) : block.data.kind === "end" ? (
                <>
                  <CircleCheck className="size-3.5" />
                  <span>Conversation ended</span>
                </>
              ) : (
                <>
                  <ArrowRightLeft className="size-3.5" />
                  <span>Routed to {block.data.agentName}</span>
                </>
              )}
            </div>
          );
        }
        // guardrail
        return block.data.offerHuman && assignment !== "human" && !closed ? (
          <div key={key} className="flex justify-start">
            <Button size="sm" variant="outline" onClick={onEscalate}>
              <UserRound className="size-3.5" /> Connect me to a human
            </Button>
          </div>
        ) : null;
      })}
    </div>
  );
});

/**
 * The scrolling message list. Memoized so that composer keystrokes — which
 * live in their own component and never touch `ChatView` — cannot re-render
 * the whole conversation. It still re-renders while streaming (the `messages`
 * array identity changes) but settled turns bail out via their own memo.
 */
const MessageList = memo(function MessageList({
  messages,
  status,
  assignment,
  closed,
  onEscalate,
}: {
  messages: ChatUIMessage[];
  status: string;
  assignment: "ai" | "human";
  closed: boolean;
  onEscalate: () => void;
}) {
  return (
    <ChatContainerContent className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      {messages.map((m) =>
        m.role === "user" ? (
          <UserTurn key={m.id} message={m} />
        ) : (
          <AssistantTurn
            key={m.id}
            message={m}
            assignment={assignment}
            closed={closed}
            onEscalate={onEscalate}
          />
        ),
      )}
      {status === "submitted" && (
        <Message className="justify-start">
          <Loader variant="typing" />
        </Message>
      )}
    </ChatContainerContent>
  );
});

/**
 * The prompt box. Owns its own `input` state so that typing re-renders only
 * this small subtree — never `ChatView` or the message list.
 */
const ChatComposer = memo(function ChatComposer({
  isBusy,
  closed,
  onSubmit,
}: {
  isBusy: boolean;
  closed: boolean;
  onSubmit: (text: string) => void;
}) {
  const [input, setInput] = useState("");

  const submit = () => {
    const text = input.trim();
    if (!text || isBusy || closed) return;
    onSubmit(text);
    setInput("");
  };

  return (
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
  );
});

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

  const handleSubmit = useCallback(
    (text: string) => {
      sendMessage({ text });
    },
    [sendMessage],
  );

  const escalateToHuman = useCallback(async () => {
    setAssignment("human");
    await fetch(`/api/conversations/${conversationId}/escalate`, {
      method: "POST",
    });
  }, [conversationId]);

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <ChatContainerRoot className="h-full">
          <MessageList
            messages={messages}
            status={status}
            assignment={assignment}
            closed={closed}
            onEscalate={escalateToHuman}
          />
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
            <ChatComposer
              isBusy={isBusy}
              closed={closed}
              onSubmit={handleSubmit}
            />
          </>
        )}
      </div>
    </div>
  );
}
