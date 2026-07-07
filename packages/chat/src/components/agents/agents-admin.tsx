"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Wand2 } from "lucide-react";
import { api, type AgentDTO, type AgentInput } from "@/lib/api";
import {
  BUILDER_DRAFT_KEY,
  type ConfigProposalPart,
  type KnowledgeSeedPart,
} from "@/lib/agents/builder-messages";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentForm } from "@/components/agents/agent-form";
import { AgentBuilderPanel } from "@/components/agents/agent-builder-panel";

/** Project an existing agent onto the editable config shape (drops id/timestamps). */
function agentToInput(a: AgentDTO): AgentInput {
  return {
    name: a.name,
    description: a.description,
    systemPrompt: a.systemPrompt,
    model: a.model,
    temperature: a.temperature,
    maxTokens: a.maxTokens,
    isRoutable: a.isRoutable,
    isDefault: a.isDefault,
    builtinTools: a.builtinTools,
    customTools: a.customTools,
    mcpServers: a.mcpServers,
    handoffRules: a.handoffRules,
    guardrails: a.guardrails,
    knowledge: a.knowledge,
  };
}

/** Merge a builder patch into the accumulated draft (nested objects merged). */
function mergeConfig(prev: AgentInput, patch: AgentInput): AgentInput {
  return {
    ...prev,
    ...patch,
    builtinTools: patch.builtinTools
      ? { ...prev.builtinTools, ...patch.builtinTools }
      : prev.builtinTools,
    guardrails: patch.guardrails
      ? { ...prev.guardrails, ...patch.guardrails }
      : prev.guardrails,
    knowledge: patch.knowledge
      ? { ...prev.knowledge, ...patch.knowledge }
      : prev.knowledge,
  };
}

export function AgentsAdmin() {
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | "build" | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  // Builder state: the accumulated draft (sent back to the assistant each turn),
  // the latest patch (applied to the form), and a counter that forces the form to
  // refetch buckets after one is created. Knowledge seeds render as an in-chat
  // card in the builder panel, so they no longer live in this admin's state.
  const [draft, setDraft] = useState<AgentInput>({});
  const [patch, setPatch] = useState<{ seq: number; config: AgentInput }>();
  const [bucketsVersion, setBucketsVersion] = useState(0);
  // True while refining the selected existing agent through the builder panel.
  const [aiAssist, setAiAssist] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await api.GET("/agents");
    setAgents(data?.agents ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Resume an unsaved build (e.g. after a refresh): the panel restores the
    // conversation, which replays the proposals to rebuild this draft + form.
    if (localStorage.getItem(BUILDER_DRAFT_KEY)) {
      setSelectedId("build");
    }
  }, []);

  // Derive the form patch from the accumulated draft. A batch of proposals (e.g.
  // replayed on resume) collapses into one draft update, so the form is patched
  // once with the FULL merged config — every field, not just the last proposal's.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPatch((prev) => ({ seq: (prev?.seq ?? 0) + 1, config: draft }));
  }, [draft]);

  // Merge each proposal into the accumulated draft (the effect above re-patches).
  const onProposal = useCallback(
    (part: ConfigProposalPart) =>
      setDraft((prev) => mergeConfig(prev, part.config)),
    [],
  );

  function resetBuild() {
    localStorage.removeItem(BUILDER_DRAFT_KEY);
    setDraft({});
    setPatch(undefined);
  }

  function startBuild() {
    setAiAssist(false);
    resetBuild();
    setSelectedId("build");
  }

  /** Select a list item (or "new"), leaving any AI-edit session. */
  function select(id: string | "new") {
    setAiAssist(false);
    setSelectedId(id);
  }

  // Leave the builder, discarding the persisted draft.
  function exitBuild() {
    resetBuild();
    setSelectedId(null);
  }

  // Open the builder alongside an existing agent's form, seeded with its config
  // so the assistant refines it rather than starting from scratch.
  function startEditWithAI(agent: AgentDTO) {
    setPatch(undefined);
    setDraft(agentToInput(agent));
    setAiAssist(true);
  }

  function stopEditWithAI() {
    setAiAssist(false);
    setDraft({});
  }

  // Create the seeded bucket + docs and assign it to the draft. Returns the new
  // bucket id (for the in-chat card's "View" link) or null on failure.
  async function createBucketFromSeed(
    seed: KnowledgeSeedPart,
  ): Promise<string | null> {
    const { data, error } = await api.POST("/knowledge/buckets", {
      body: { name: seed.bucketName, description: seed.description },
    });
    if (error || !data?.bucket) {
      toast.error("Failed to create knowledge base.");
      return null;
    }
    const bucketId = data.bucket.id;
    for (const doc of seed.documents) {
      await api.POST("/knowledge/buckets/{id}/documents", {
        params: { path: { id: bucketId } },
        body: { title: doc.title, content: doc.content },
      });
    }
    toast.success(
      `Created "${seed.bucketName}" with ${seed.documents.length} document${
        seed.documents.length === 1 ? "" : "s"
      }.`,
    );
    setBucketsVersion((v) => v + 1);
    // Enable knowledge on the draft and assign the new bucket.
    setDraft((prev) =>
      mergeConfig(prev, {
        knowledge: {
          enabled: true,
          bucketIds: [...(prev.knowledge?.bucketIds ?? []), bucketId],
        },
      }),
    );
    return bucketId;
  }

  const selected =
    selectedId && selectedId !== "new" && selectedId !== "build"
      ? agents.find((a) => a.id === selectedId) ?? null
      : null;

  // The builder-chat + live-form split, shared by the create and edit flows.
  function builderSplit(opts: {
    editing: boolean;
    formKey: string;
    agent?: AgentDTO;
    onSaved: () => void | Promise<void>;
    onDeleted?: () => void | Promise<void>;
    onCancel: () => void;
  }) {
    return (
      <div className="grid h-full grid-cols-2 grid-rows-1 divide-x divide-border overflow-hidden">
        <AgentBuilderPanel
          draft={draft}
          editing={opts.editing}
          persist={!opts.editing}
          onProposal={onProposal}
          onCreateKnowledge={createBucketFromSeed}
        />
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AgentForm
              key={opts.formKey}
              agent={opts.agent}
              incomingPatch={patch}
              bucketsVersion={bucketsVersion}
              onSaved={opts.onSaved}
              onDeleted={opts.onDeleted}
              onCancel={opts.onCancel}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[18rem_1fr] grid-rows-1 divide-x divide-border overflow-hidden">
      {/* Agent list */}
      <aside className="flex flex-col overflow-hidden bg-canvas-soft">
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <span className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
            Agents
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={startBuild}>
              <Wand2 className="size-4" /> Build
            </Button>
            <Button size="sm" variant="outline" onClick={() => select("new")}>
              <Plus className="size-4" /> New
            </Button>
          </div>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loading && (
            <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {!loading && agents.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No agents yet. Create one, or build one with AI.
            </p>
          )}
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => select(a.id)}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-strong ${
                selectedId === a.id ? "bg-surface-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-ink">{a.name}</span>
                {a.isDefault && (
                  <Badge variant="secondary" className="text-[10px]">
                    default
                  </Badge>
                )}
                {!a.isRoutable && (
                  <Badge variant="outline" className="text-[10px]">
                    entry-only
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {a.description || a.model}
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* Form / detail */}
      <section className="overflow-hidden">
        {selectedId === "build" ? (
          builderSplit({
            editing: false,
            formKey: "build",
            onSaved: async () => {
              resetBuild();
              await load();
              setSelectedId(null);
            },
            onCancel: exitBuild,
          })
        ) : selectedId === "new" ? (
          <div className="h-full overflow-y-auto">
            <AgentForm
              key="new"
              onSaved={async () => {
                await load();
                setSelectedId(null);
              }}
              onCancel={() => setSelectedId(null)}
            />
          </div>
        ) : selected ? (
          aiAssist ? (
            builderSplit({
              editing: true,
              formKey: `ai-${selected.id}`,
              agent: selected,
              onSaved: async () => {
                await load();
                stopEditWithAI();
              },
              onDeleted: async () => {
                await load();
                stopEditWithAI();
                setSelectedId(null);
              },
              onCancel: stopEditWithAI,
            })
          ) : (
            <div className="h-full overflow-y-auto">
              <AgentForm
                key={selected.id}
                agent={selected}
                onBuildWithAI={() => startEditWithAI(selected)}
                onSaved={async () => {
                  await load();
                }}
                onDeleted={async () => {
                  await load();
                  setSelectedId(null);
                }}
                onCancel={() => setSelectedId(null)}
              />
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            Select an agent to edit, create a new one, or build one with AI.
          </div>
        )}
      </section>
    </div>
  );
}
