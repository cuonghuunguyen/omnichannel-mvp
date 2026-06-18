"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, type AgentDTO } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentForm } from "@/components/agents/agent-form";

export function AgentsAdmin() {
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.GET("/agents");
    setAgents(data?.agents ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const selected =
    selectedId && selectedId !== "new"
      ? agents.find((a) => a.id === selectedId) ?? null
      : null;

  return (
    <div className="grid h-full grid-cols-[18rem_1fr] divide-x divide-border overflow-hidden">
      {/* Agent list */}
      <aside className="flex flex-col overflow-hidden bg-canvas-soft">
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <span className="text-xs font-semibold uppercase tracking-[0.096em] text-muted-foreground">
            Agents
          </span>
          <Button size="sm" variant="outline" onClick={() => setSelectedId("new")}>
            <Plus className="size-4" /> New
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loading && (
            <p className="px-2 py-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {!loading && agents.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No agents yet. Create one.
            </p>
          )}
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
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
      <section className="overflow-y-auto">
        {selectedId === "new" ? (
          <AgentForm
            key="new"
            onSaved={async () => {
              await load();
              setSelectedId(null);
            }}
            onCancel={() => setSelectedId(null)}
          />
        ) : selected ? (
          <AgentForm
            key={selected.id}
            agent={selected}
            onSaved={async () => {
              await load();
            }}
            onDeleted={async () => {
              await load();
              setSelectedId(null);
            }}
            onCancel={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            Select an agent to edit, or create a new one.
          </div>
        )}
      </section>
    </div>
  );
}
