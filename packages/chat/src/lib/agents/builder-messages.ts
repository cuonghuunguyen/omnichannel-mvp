// The config-builder UIMessage contract, consumed by the builder panel. Mirrors
// packages/api/src/lib/agents/builder.ts — the two services don't share a package
// (true split), so the shape is duplicated. The builder PRODUCES these parts; the
// admin UI CONSUMES them and folds the proposals into an editable draft.
import type { UIMessage } from "ai";
import type { AgentInput } from "@/lib/api";

/**
 * localStorage key for the in-progress build. The builder conversation is the
 * source of truth (proposals are replayed from it to rebuild the draft on
 * resume), so persisting the messages is enough to recover an unsaved draft.
 */
export const BUILDER_DRAFT_KEY = "agent-builder:draft";

/** A partial agent config the assistant proposes, merged into the draft form. */
export type ConfigProposalPart = {
  /** One-line, human-readable summary of what this proposal sets. */
  summary: string;
  /** Partial agent config to merge into the draft. */
  config: AgentInput;
};

/** Seed knowledge the assistant proposes — a bucket plus a few starter docs. */
export type KnowledgeSeedPart = {
  summary: string;
  bucketName: string;
  description?: string;
  documents: { title: string; content: string }[];
};

/** A question the assistant asks as selectable options instead of free text. */
export type AskChoicePart = {
  id: string;
  question: string;
  options: { label: string; description?: string }[];
  multi: boolean;
  /** Also offer a free-text box so the user can answer outside the options. */
  allowFreeText: boolean;
};

/** The builder's streamed UIMessage shape: plain text + the interaction parts. */
export type BuilderUIMessage = UIMessage<
  never,
  {
    "config-proposal": ConfigProposalPart;
    "knowledge-seed": KnowledgeSeedPart;
    "ask-choice": AskChoicePart;
  }
>;
