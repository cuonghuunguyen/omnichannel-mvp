"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { toast } from "sonner";
import {
  ArrowUp,
  BookOpen,
  Check,
  ExternalLink,
  Paperclip,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import type { AgentInput } from "@/lib/api";
import {
  BUILDER_DRAFT_KEY,
  type AskChoicePart,
  type BuilderUIMessage,
  type ConfigProposalPart,
  type KnowledgeSeedPart,
} from "@/lib/agents/builder-messages";
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
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SUGGESTIONS = [
  "A billing support agent for a SaaS product",
  "A sales agent that routes complex deals to a human",
  "A triage router that hands off to the right team",
];

const EDIT_SUGGESTIONS = [
  "Make the tone more formal",
  "Let it escalate to a human for refunds",
  "Restrict it to billing topics only",
];

const MAX_FILES = 5;
const MAX_FILE_CHARS = 80_000;
const UPLOAD_PREFIX = "📎 ";

/** Whether a file can be read as text (the only kind we forward to the builder). */
function isTextFile(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|json|jsonc|csv|tsv|ya?ml|html?|xml|log)$/i.test(file.name)
  );
}

/**
 * The conversational config builder. It interviews the user and streams back text
 * plus `config-proposal` / `knowledge-seed` / `ask-choice` parts. Config proposals
 * are lifted to the parent (folded into the draft form); knowledge seeds render
 * inline as an actionable card whose button creates + assigns the bucket via
 * `onCreateKnowledge` (no round-trip through the assistant); choices render as
 * selectable options; and the input has a paperclip to attach text documents as
 * source material the assistant can turn into knowledge.
 */
export function AgentBuilderPanel({
  draft,
  editing = false,
  persist = true,
  onProposal,
  onCreateKnowledge,
}: {
  draft: AgentInput;
  /** Refining an existing agent (vs. creating one) — changes the prompt + intro. */
  editing?: boolean;
  /** Persist + restore the conversation via localStorage (create flow only). */
  persist?: boolean;
  onProposal: (part: ConfigProposalPart) => void;
  /**
   * Create + assign the seeded knowledge base. Resolves to the new bucket id (so
   * the card can link to it) or null on failure. Called directly from the in-chat
   * card — it does not send a message to the assistant.
   */
  onCreateKnowledge: (seed: KnowledgeSeedPart) => Promise<string | null>;
}) {
  const [input, setInput] = useState("");
  // Per-choice local selection (for multi-select) and which choices were answered.
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, setMessages } = useChat<BuilderUIMessage>({
    transport: new DefaultChatTransport<BuilderUIMessage>({
      api: "/api/agent-builder",
    }),
  });

  // Restore an unsaved build once on mount. Seeding the messages re-fires the
  // proposal-lifting effect below, which rebuilds the parent's draft + form.
  // Create flow only — editing an existing agent isn't persisted.
  useEffect(() => {
    if (!persist) return;
    const raw = localStorage.getItem(BUILDER_DRAFT_KEY);
    if (!raw) return;
    try {
      const restored = JSON.parse(raw) as BuilderUIMessage[];
      if (restored.length) setMessages(restored);
    } catch {
      localStorage.removeItem(BUILDER_DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the conversation so a refresh doesn't lose the draft.
  useEffect(() => {
    if (persist && messages.length) {
      localStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify(messages));
    }
  }, [messages, persist]);

  // Warn before unloading the page while a build is in progress.
  useEffect(() => {
    if (messages.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [messages.length]);

  // Lift each config proposal to the parent exactly once. Parts are stable once
  // added to a message, so keying by message id + part index dedupes across
  // re-renders. Knowledge seeds are NOT lifted — they render as an in-chat card.
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      m.parts.forEach((part, i) => {
        if (part.type !== "data-config-proposal") return;
        const key = `${m.id}:${i}`;
        if (seen.current.has(key)) return;
        seen.current.add(key);
        onProposal(part.data);
      });
    }
  }, [messages, onProposal]);

  const isBusy = status === "submitted" || status === "streaming";

  // Send the draft built so far so the assistant can refine its own proposals.
  const send = (text: string) =>
    sendMessage({ text }, { body: { currentDraft: draft, editing } });

  const submit = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || isBusy) return;
    send(value);
    setInput("");
  };

  const answerChoice = (choice: AskChoicePart, labels: string[]) => {
    if (!labels.length || isBusy) return;
    setAnswered((prev) => new Set(prev).add(choice.id));
    send(labels.join(", "));
  };

  const togglePick = (choiceId: string, label: string) => {
    setPicks((prev) => {
      const cur = prev[choiceId] ?? [];
      return {
        ...prev,
        [choiceId]: cur.includes(label)
          ? cur.filter((l) => l !== label)
          : [...cur, label],
      };
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || isBusy) return;
    const chosen = Array.from(files).slice(0, MAX_FILES);
    const usable = chosen.filter(isTextFile);
    const skipped = chosen.filter((f) => !isTextFile(f));
    if (skipped.length) {
      toast.error(
        `Skipped ${skipped.length} non-text file${skipped.length === 1 ? "" : "s"} (${skipped
          .map((f) => f.name)
          .join(", ")}).`,
      );
    }
    if (!usable.length) return;
    const blocks: string[] = [];
    for (const file of usable) {
      const text = (await file.text()).slice(0, MAX_FILE_CHARS);
      blocks.push(`# ${file.name}\n\n${text}`);
    }
    const names = usable.map((f) => f.name).join(", ");
    send(`${UPLOAD_PREFIX}${names}\n\n${blocks.join("\n\n---\n\n")}`);
  };

  return (
    <div className="flex h-full flex-col bg-canvas-soft">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
        <Wand2 className="size-4 text-primary" />
        <span className="text-sm font-medium text-ink">
          {editing ? "Edit with AI" : "Build with AI"}
        </span>
        <span className="text-xs text-muted-foreground">
          {editing
            ? "Describe the changes — they fill the form →"
            : "Describe the agent you want — answers fill the form →"}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="space-y-4 px-4 py-5">
            {messages.length === 0 && (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {editing
                    ? "Tell me what you'd like to change. I'll update the form as we go."
                    : "Tell me what this agent should do. I'll ask a few questions and fill in the form as we go."}
                </p>
                <div className="flex flex-col items-center gap-2">
                  {(editing ? EDIT_SUGGESTIONS : SUGGESTIONS).map((s) => (
                    <button
                      key={s}
                      onClick={() => submit(s)}
                      className="rounded-full border border-border bg-surface-card px-3 py-1.5 text-xs text-ink transition-colors hover:bg-surface-strong"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => {
              if (m.role === "user") {
                const text = m.parts
                  .filter((p) => p.type === "text")
                  .map((p) => (p.type === "text" ? p.text : ""))
                  .join("");
                if (!text.trim()) return null;
                // Uploaded files are sent as a tagged message; show a compact chip
                // instead of dumping the raw file contents into the transcript.
                if (text.startsWith(UPLOAD_PREFIX)) {
                  const names = text.slice(UPLOAD_PREFIX.length).split("\n")[0];
                  return (
                    <Message key={m.id} className="justify-end">
                      <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                        <Paperclip className="size-3.5 shrink-0" />
                        <span className="truncate">{names}</span>
                      </div>
                    </Message>
                  );
                }
                return (
                  <Message key={m.id} className="justify-end">
                    <MessageContent className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                      {text}
                    </MessageContent>
                  </Message>
                );
              }
              return (
                <div key={m.id} className="space-y-2">
                  {m.parts.map((part, i) => {
                    const key = `${m.id}-${i}`;
                    if (part.type === "text") {
                      if (!part.text.trim()) return null;
                      return (
                        <Message key={key} className="justify-start">
                          <MessageContent
                            markdown
                            className="max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-surface-card px-3.5 py-2 text-sm text-ink"
                          >
                            {part.text}
                          </MessageContent>
                        </Message>
                      );
                    }
                    if (part.type === "data-config-proposal") {
                      return (
                        <ProposalChip
                          key={key}
                          icon={<Sparkles className="size-3.5" />}
                          label={part.data.summary || "Updated the agent config"}
                        />
                      );
                    }
                    if (part.type === "data-knowledge-seed") {
                      return (
                        <KnowledgeSeedCard
                          key={key}
                          seed={part.data}
                          onCreate={onCreateKnowledge}
                        />
                      );
                    }
                    if (part.type === "data-ask-choice") {
                      return (
                        <ChoiceCard
                          key={key}
                          choice={part.data}
                          picks={picks[part.data.id] ?? []}
                          answered={answered.has(part.data.id)}
                          disabled={isBusy}
                          onToggle={(label) => togglePick(part.data.id, label)}
                          onAnswer={(labels) => answerChoice(part.data, labels)}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              );
            })}

            {status === "submitted" && (
              <Message className="justify-start">
                <Loader variant="typing" />
              </Message>
            )}
          </ChatContainerContent>
        </ChatContainerRoot>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.json,.jsonc,.csv,.tsv,.yaml,.yml,.html,.htm,.xml,.log,text/*"
          className="hidden"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={isBusy}
          onSubmit={() => submit()}
          maxHeight={160}
          className="w-full border-hairline-strong bg-surface-card"
        >
          <PromptInputTextarea placeholder="Describe the agent, or answer the question…" />
          <PromptInputActions className="justify-between pt-2">
            <PromptInputAction tooltip="Attach text documents">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-full"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
              >
                <Paperclip className="size-4" />
              </Button>
            </PromptInputAction>
            <PromptInputAction tooltip={isBusy ? "Working…" : "Send"}>
              <Button
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => submit()}
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
      </div>
    </div>
  );
}

function ProposalChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-ink">
      <span className="text-primary">{icon}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

/**
 * In-chat card for a knowledge-seed proposal. The button creates + assigns the
 * bucket directly (via `onCreate`), then swaps to a link so the user can open and
 * view the new knowledge base. Create state is local — a fresh restore shows the
 * button again (clicking re-creates), which is acceptable for an unsaved draft.
 */
function KnowledgeSeedCard({
  seed,
  onCreate,
}: {
  seed: KnowledgeSeedPart;
  onCreate: (seed: KnowledgeSeedPart) => Promise<string | null>;
}) {
  const [status, setStatus] = useState<"idle" | "creating" | "created">("idle");
  const [bucketId, setBucketId] = useState<string | null>(null);

  const create = async () => {
    setStatus("creating");
    const id = await onCreate(seed);
    if (id) {
      setBucketId(id);
      setStatus("created");
    } else {
      setStatus("idle");
    }
  };

  const docCount = seed.documents.length;
  return (
    <div className="space-y-2.5 rounded-2xl border border-primary/30 bg-primary/5 p-3.5">
      <div className="flex items-start gap-2.5">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{seed.bucketName}</p>
          <p className="text-xs text-muted-foreground">
            {docCount} starter document{docCount === 1 ? "" : "s"}
            {seed.summary ? ` · ${seed.summary}` : ""}
          </p>
          {seed.description && (
            <p className="mt-1 text-xs text-muted-foreground">{seed.description}</p>
          )}
        </div>
      </div>
      {status === "created" && bucketId ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-primary">
            <Check className="size-3.5" /> Created &amp; assigned
          </span>
          <a
            href={`/knowledge?bucket=${bucketId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            View knowledge base
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      ) : (
        <Button
          size="sm"
          className="w-full"
          disabled={status === "creating"}
          onClick={create}
        >
          {status === "creating" ? "Creating…" : "Create knowledge base"}
        </Button>
      )}
    </div>
  );
}

function ChoiceCard({
  choice,
  picks,
  answered,
  disabled,
  onToggle,
  onAnswer,
}: {
  choice: AskChoicePart;
  picks: string[];
  answered: boolean;
  disabled: boolean;
  onToggle: (label: string) => void;
  onAnswer: (labels: string[]) => void;
}) {
  const locked = answered || disabled;
  const [freeText, setFreeText] = useState("");
  const sendFreeText = () => {
    const text = freeText.trim();
    if (!text) return;
    // For multi-select, combine ticked options with the typed answer.
    onAnswer(choice.multi ? [...picks, text] : [text]);
  };
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface-card p-3.5">
      <p className="text-sm font-medium text-ink">{choice.question}</p>
      <div className="flex flex-col gap-1.5">
        {choice.options.map((opt) => {
          const selected = choice.multi
            ? picks.includes(opt.label)
            : answered;
          return (
            <button
              key={opt.label}
              disabled={locked}
              onClick={() =>
                choice.multi ? onToggle(opt.label) : onAnswer([opt.label])
              }
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${
                selected
                  ? "border-primary bg-primary/5 text-ink"
                  : "border-border bg-canvas-soft text-ink hover:bg-surface-strong disabled:hover:bg-canvas-soft"
              }`}
            >
              {choice.multi && (
                <span
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-hairline-strong"
                  }`}
                >
                  {selected && <Check className="size-3" />}
                </span>
              )}
              <span className="min-w-0">
                <span className="font-medium">{opt.label}</span>
                {opt.description && (
                  <span className="block text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {choice.multi && !answered && (
        <Button
          size="sm"
          className="w-full"
          disabled={locked || picks.length === 0}
          onClick={() => onAnswer(picks)}
        >
          Send {picks.length > 0 ? `(${picks.length})` : ""}
        </Button>
      )}
      {choice.allowFreeText && !answered && (
        <div className="flex items-center gap-2 pt-0.5">
          <Input
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendFreeText();
              }
            }}
            placeholder="Or type your own answer…"
            disabled={locked}
            className="h-9"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={locked || !freeText.trim()}
            onClick={sendFreeText}
          >
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
