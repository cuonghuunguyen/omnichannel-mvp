"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { AgentDTO, AgentInput } from "@/lib/agents/agent-io";
import type { Bucket } from "@/lib/rag/types";
import { MODEL_OPTIONS, DEFAULT_MODEL_ID } from "@/lib/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

// Row shapes keep nested JSON as editable text; parsed/validated on save.
type CustomToolRow = {
  name: string;
  description: string;
  schemaText: string;
  endpoint: string;
};
type McpServerRow = { name: string; url: string; headersText: string };
type HandoffRuleRow = { flag: string; keywordsText: string; assignTo: string };

function toCustomRows(a?: AgentDTO): CustomToolRow[] {
  return (a?.customTools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    schemaText: JSON.stringify(t.schema ?? {}, null, 2),
    endpoint: t.endpoint,
  }));
}
function toMcpRows(a?: AgentDTO): McpServerRow[] {
  return (a?.mcpServers ?? []).map((s) => ({
    name: s.name,
    url: s.url,
    headersText: s.headers ? JSON.stringify(s.headers, null, 2) : "",
  }));
}
function toRuleRows(a?: AgentDTO): HandoffRuleRow[] {
  return (a?.handoffRules ?? []).map((r) => ({
    flag: r.when.flag ?? "",
    keywordsText: (r.when.keywords ?? []).join(", "),
    assignTo: r.assignTo,
  }));
}

export function AgentForm({
  agent,
  onSaved,
  onDeleted,
  onCancel,
}: {
  agent?: AgentDTO;
  onSaved: () => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const isNew = !agent;

  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [model, setModel] = useState(agent?.model ?? DEFAULT_MODEL_ID);
  const [temperature, setTemperature] = useState(agent?.temperature ?? 0.7);
  const [isRoutable, setIsRoutable] = useState(agent?.isRoutable ?? true);
  const [isDefault, setIsDefault] = useState(agent?.isDefault ?? false);

  const [sendMessage, setSendMessage] = useState(
    agent?.builtinTools.sendMessage ?? true,
  );
  const [deliverToAgent, setDeliverToAgent] = useState(
    agent?.builtinTools.deliverToAgent ?? false,
  );
  const [deliverToHuman, setDeliverToHuman] = useState(
    agent?.builtinTools.deliverToHuman ?? false,
  );
  const [endConversation, setEndConversation] = useState(
    agent?.builtinTools.endConversation ?? false,
  );

  const [customTools, setCustomTools] = useState<CustomToolRow[]>(
    toCustomRows(agent),
  );
  const [mcpServers, setMcpServers] = useState<McpServerRow[]>(toMcpRows(agent));
  const [handoffRules, setHandoffRules] = useState<HandoffRuleRow[]>(
    toRuleRows(agent),
  );

  const [guardEnabled, setGuardEnabled] = useState(
    agent?.guardrails.enabled ?? false,
  );
  const [guardScope, setGuardScope] = useState(agent?.guardrails.scope ?? "");
  const [guardRefusal, setGuardRefusal] = useState(
    agent?.guardrails.refusal ?? "",
  );

  const [knowledgeEnabled, setKnowledgeEnabled] = useState(
    agent?.knowledge.enabled ?? false,
  );
  const [knowledgeBucketIds, setKnowledgeBucketIds] = useState<string[]>(
    agent?.knowledge.bucketIds ?? [],
  );
  const [knowledgeTopK, setKnowledgeTopK] = useState(agent?.knowledge.topK ?? 5);
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  useEffect(() => {
    fetch("/api/knowledge/buckets")
      .then((r) => r.json())
      .then((json) => setBuckets(json.buckets ?? []))
      .catch(() => setBuckets([]));
  }, []);

  const [saving, setSaving] = useState(false);

  function buildInput(): AgentInput | null {
    if (!name.trim()) {
      toast.error("Name is required.");
      return null;
    }

    // Parse custom-tool schemas.
    const parsedTools = [];
    for (const t of customTools) {
      if (!t.name.trim()) {
        toast.error("Every custom tool needs a name.");
        return null;
      }
      let schema: Record<string, unknown>;
      try {
        schema = t.schemaText.trim() ? JSON.parse(t.schemaText) : {};
      } catch {
        toast.error(`Tool "${t.name}": schema is not valid JSON.`);
        return null;
      }
      parsedTools.push({
        name: t.name.trim(),
        description: t.description,
        schema,
        endpoint: t.endpoint.trim(),
      });
    }

    // Parse MCP server headers.
    const parsedServers = [];
    for (const s of mcpServers) {
      if (!s.url.trim()) {
        toast.error("Every MCP server needs a URL.");
        return null;
      }
      let headers: Record<string, string> | undefined;
      if (s.headersText.trim()) {
        try {
          headers = JSON.parse(s.headersText);
        } catch {
          toast.error(`MCP server "${s.name || s.url}": headers are not valid JSON.`);
          return null;
        }
      }
      parsedServers.push({
        name: s.name.trim() || s.url.trim(),
        url: s.url.trim(),
        ...(headers ? { headers } : {}),
      });
    }

    const parsedRules = handoffRules.map((r) => ({
      when: {
        ...(r.flag.trim() ? { flag: r.flag.trim() } : {}),
        ...(r.keywordsText.trim()
          ? {
              keywords: r.keywordsText
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean),
            }
          : {}),
      },
      assignTo: r.assignTo.trim() || "queue",
    }));

    return {
      name: name.trim(),
      description,
      systemPrompt,
      model,
      temperature,
      isRoutable,
      isDefault,
      builtinTools: { sendMessage, deliverToAgent, deliverToHuman, endConversation },
      customTools: parsedTools,
      mcpServers: parsedServers,
      handoffRules: parsedRules,
      guardrails: {
        enabled: guardEnabled,
        scope: guardScope.trim(),
        refusal: guardRefusal.trim(),
      },
      knowledge: {
        enabled: knowledgeEnabled,
        bucketIds: knowledgeBucketIds,
        topK: knowledgeTopK,
      },
    };
  }

  async function save() {
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    const res = await fetch(
      isNew ? "/api/agents" : `/api/agents/${agent!.id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    setSaving(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "save failed" }));
      toast.error(error ?? "Failed to save agent.");
      return;
    }
    toast.success(isNew ? "Agent created." : "Agent saved.");
    await onSaved();
  }

  async function remove() {
    if (!agent) return;
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete agent.");
      return;
    }
    toast.success("Agent deleted.");
    await onDeleted?.();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-light tracking-tight text-ink">
          {isNew ? "New agent" : `Edit ${agent!.name}`}
        </h2>
        <div className="flex gap-2">
          {!isNew && onDeleted && (
            <Button variant="ghost" size="sm" onClick={remove}>
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Basics */}
      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown to other agents when they decide whether to route here."
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="systemPrompt">Master prompt</Label>
          <Textarea
            id="systemPrompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="The agent's system prompt / instructions."
            rows={6}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-11 w-full rounded-md border border-hairline-strong bg-surface-card px-4 text-sm text-ink outline-none transition-colors focus-visible:border-2 focus-visible:border-ink"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="temperature">Temperature ({temperature})</Label>
            <Input
              id="temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
          </div>
        </div>
      </section>

      {/* Routing flags */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">Routing</h3>
        <ToggleRow
          label="Routable"
          hint="Can be a deliver_to_agent target for other agents."
          checked={isRoutable}
          onChange={setIsRoutable}
        />
        <ToggleRow
          label="Default entry agent"
          hint="New conversations start here unless routed elsewhere. Only one agent can be default."
          checked={isDefault}
          onChange={setIsDefault}
        />
      </section>

      {/* Built-in tools */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">Built-in tools</h3>
        <ToggleRow
          label="send_message"
          hint="Speak to the user mid-turn."
          checked={sendMessage}
          onChange={setSendMessage}
        />
        <ToggleRow
          label="deliver_to_agent"
          hint="Hand off to another routable agent."
          checked={deliverToAgent}
          onChange={setDeliverToAgent}
        />
        <ToggleRow
          label="deliver_to_human"
          hint="Escalate the conversation to a human operator."
          checked={deliverToHuman}
          onChange={setDeliverToHuman}
        />
        <ToggleRow
          label="end_conversation"
          hint="Close the conversation once the user's request is fully resolved."
          checked={endConversation}
          onChange={setEndConversation}
        />
      </section>

      {/* Guardrails */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">Guardrails</h3>
        <ToggleRow
          label="Enabled"
          hint="Hardens the prompt against injection and fabrication. With a scope set below, also runs a classifier that blocks off-topic requests."
          checked={guardEnabled}
          onChange={setGuardEnabled}
        />
        {guardEnabled && (
          <>
            <div className="space-y-2">
              <Label htmlFor="guardScope">Allowed scope</Label>
              <Textarea
                id="guardScope"
                value={guardScope}
                onChange={(e) => setGuardScope(e.target.value)}
                placeholder="What this agent may discuss, e.g. 'Pricing, plans, and product capabilities for Acme. Nothing else.' Leave empty to harden the prompt without off-topic blocking (e.g. a router)."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guardRefusal">Refusal message (optional)</Label>
              <Textarea
                id="guardRefusal"
                value={guardRefusal}
                onChange={(e) => setGuardRefusal(e.target.value)}
                placeholder="Shown when a request is blocked. Leave empty for a sensible default."
                rows={2}
              />
            </div>
          </>
        )}
      </section>

      {/* Knowledge (RAG) */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
          Knowledge (RAG)
        </h3>
        <ToggleRow
          label="search_knowledge"
          hint="Give this agent a tool to retrieve from assigned knowledge bases (hybrid search + rerank) and ground its answers."
          checked={knowledgeEnabled}
          onChange={setKnowledgeEnabled}
        />
        {knowledgeEnabled && (
          <>
            <div className="space-y-2">
              <Label>Assigned knowledge bases</Label>
              {buckets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No knowledge bases yet — create one under Knowledge.
                </p>
              ) : (
                <div className="space-y-1 rounded-xl border border-border bg-surface-card p-3">
                  {buckets.map((b) => {
                    const checked = knowledgeBucketIds.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-surface-strong"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setKnowledgeBucketIds((ids) =>
                              e.target.checked
                                ? [...ids, b.id]
                                : ids.filter((x) => x !== b.id),
                            )
                          }
                        />
                        <span className="text-ink">{b.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {b.documentCount ?? 0} docs · {b.embeddingProvider}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledgeTopK">Results per search (topK)</Label>
              <Input
                id="knowledgeTopK"
                type="number"
                min={1}
                max={20}
                value={knowledgeTopK}
                onChange={(e) => setKnowledgeTopK(Number(e.target.value))}
              />
            </div>
          </>
        )}
      </section>

      {/* Custom tools */}
      <RowSection
        title="Custom tools"
        hint="HTTP endpoints called with the tool input as the JSON body."
        onAdd={() =>
          setCustomTools((rows) => [
            ...rows,
            { name: "", description: "", schemaText: "{}", endpoint: "" },
          ])
        }
        empty={customTools.length === 0}
      >
        {customTools.map((t, i) => (
          <RowCard key={i} onRemove={() => setCustomTools((r) => r.filter((_, j) => j !== i))}>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="tool_name"
                value={t.name}
                onChange={(e) => updateRow(setCustomTools, i, { name: e.target.value })}
              />
              <Input
                placeholder="https://api.example.com/tool"
                value={t.endpoint}
                onChange={(e) => updateRow(setCustomTools, i, { endpoint: e.target.value })}
              />
            </div>
            <Input
              placeholder="Description (when to use this tool)"
              value={t.description}
              onChange={(e) => updateRow(setCustomTools, i, { description: e.target.value })}
            />
            <Textarea
              placeholder='Input JSON Schema, e.g. {"type":"object","properties":{...}}'
              value={t.schemaText}
              onChange={(e) => updateRow(setCustomTools, i, { schemaText: e.target.value })}
              rows={3}
              className="font-mono text-xs"
            />
          </RowCard>
        ))}
      </RowSection>

      {/* MCP servers */}
      <RowSection
        title="MCP servers"
        hint="Remote MCP servers whose tools are merged into this agent."
        onAdd={() =>
          setMcpServers((rows) => [...rows, { name: "", url: "", headersText: "" }])
        }
        empty={mcpServers.length === 0}
      >
        {mcpServers.map((s, i) => (
          <RowCard key={i} onRemove={() => setMcpServers((r) => r.filter((_, j) => j !== i))}>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="name"
                value={s.name}
                onChange={(e) => updateRow(setMcpServers, i, { name: e.target.value })}
              />
              <Input
                placeholder="https://mcp.example.com/sse"
                value={s.url}
                onChange={(e) => updateRow(setMcpServers, i, { url: e.target.value })}
              />
            </div>
            <Textarea
              placeholder='Optional headers JSON, e.g. {"Authorization":"Bearer ..."}'
              value={s.headersText}
              onChange={(e) => updateRow(setMcpServers, i, { headersText: e.target.value })}
              rows={2}
              className="font-mono text-xs"
            />
          </RowCard>
        ))}
      </RowSection>

      {/* Handoff rules */}
      <RowSection
        title="Handoff rules (deliver_to_human)"
        hint="Evaluated top-down; first match wins. assignTo is a human User.id or 'queue'."
        onAdd={() =>
          setHandoffRules((rows) => [
            ...rows,
            { flag: "", keywordsText: "", assignTo: "queue" },
          ])
        }
        empty={handoffRules.length === 0}
      >
        {handoffRules.map((r, i) => (
          <RowCard key={i} onRemove={() => setHandoffRules((rs) => rs.filter((_, j) => j !== i))}>
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="when flag (optional)"
                value={r.flag}
                onChange={(e) => updateRow(setHandoffRules, i, { flag: e.target.value })}
              />
              <Input
                placeholder="keywords, comma-separated"
                value={r.keywordsText}
                onChange={(e) => updateRow(setHandoffRules, i, { keywordsText: e.target.value })}
              />
              <Input
                placeholder="assignTo (User.id or queue)"
                value={r.assignTo}
                onChange={(e) => updateRow(setHandoffRules, i, { assignTo: e.target.value })}
              />
            </div>
          </RowCard>
        ))}
      </RowSection>
    </div>
  );
}

/** Generic immutable row patch helper. */
function updateRow<T>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  index: number,
  patch: Partial<T>,
) {
  setter((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function RowSection({
  title,
  hint,
  onAdd,
  empty,
  children,
}: {
  title: string;
  hint: string;
  onAdd: () => void;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
      {empty ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

function RowCard({
  children,
  onRemove,
}: {
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="relative space-y-2 rounded-xl border border-border bg-surface-card p-4">
      <button
        onClick={onRemove}
        className="absolute right-3 top-3 text-muted-foreground transition-colors hover:text-destructive"
        aria-label="Remove"
      >
        <Trash2 className="size-4" />
      </button>
      {children}
    </div>
  );
}
