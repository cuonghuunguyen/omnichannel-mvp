// Chunking for ingestion. Two layers:
//
//  - chunkText: the paragraph-packing primitive (whole paragraphs up to a target
//    size, carrying a small trailing overlap so a fact split across a boundary is
//    retrievable from both sides). Used directly for plain prose.
//  - chunkDocument: structure-aware chunking with an auto-detected strategy. Our
//    extractor emits Markdown, and research is consistent that splitting on the
//    header tree (keeping code/tables atomic) plus a contextual prefix
//    (doc title + heading path) is the single biggest retrieval win when the
//    content has structure. Everything else falls back to recursive splitting,
//    which degrades to the paragraph packer for unstructured prose.

export type ChunkOptions = {
  /** Target chunk size in characters. */
  size?: number;
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlap?: number;
};

const DEFAULT_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? DEFAULT_SIZE;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split into paragraphs, then hard-split any paragraph larger than `size`.
  const paragraphs = normalized
    .split(/\n{2,}/)
    .flatMap((p) => (p.length > size ? splitLong(p, size) : [p]))
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > size) {
      chunks.push(current);
      current = overlap > 0 ? tail(current, overlap) + "\n\n" + para : para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Hard-split an over-long paragraph on sentence-ish boundaries, then by length. */
function splitLong(text: string, size: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (buf && buf.length + sentence.length + 1 > size) {
      out.push(buf);
      buf = sentence;
    } else {
      buf = buf ? buf + " " + sentence : sentence;
    }
    while (buf.length > size) {
      out.push(buf.slice(0, size));
      buf = buf.slice(size);
    }
  }
  if (buf) out.push(buf);
  return out;
}

function tail(text: string, n: number): string {
  if (text.length <= n) return text;
  const slice = text.slice(text.length - n);
  // Start the overlap at a word boundary for readability.
  const space = slice.indexOf(" ");
  return space > 0 ? slice.slice(space + 1) : slice;
}

// ── Structure-aware chunking ──────────────────────────────────────────────────

/** How a document is split into chunks. `auto` is detected from the content. */
export type ChunkStrategy = "auto" | "markdown" | "recursive" | "paragraph" | "sentence";

/** The shape the extractor reports a document in, used to pick a strategy. */
export type DocFormat = "markdown" | "html" | "text";

/**
 * A chunk plus the structural context it came from (e.g. the Markdown heading
 * path). `context` is prepended to `content` only for *embedding* — the stored
 * payload keeps the raw `content` so citations show the passage unchanged.
 */
export type Chunk = {
  content: string;
  /** e.g. "Amenities › Pool" — heading trail above this chunk. */
  context?: string;
};

export type ChunkDocumentOptions = ChunkOptions & {
  /** Defaults to "auto". */
  strategy?: ChunkStrategy;
  /** Hint from the extractor; helps `auto` pick a strategy. */
  format?: DocFormat;
};

const MARKDOWN_HEADER = /^(#{1,6})\s+(.+?)\s*#*$/;

/** Pick a concrete strategy from the content + format hint. */
export function detectStrategy(text: string, format?: DocFormat): Exclude<ChunkStrategy, "auto"> {
  if (format === "markdown") return "markdown";
  // Markdown headers present even without a format hint → treat as markdown.
  if (/^#{1,6}\s+\S/m.test(text)) return "markdown";
  return "recursive";
}

/**
 * Chunk a document with an auto-detected (or forced) strategy. Returns chunks
 * carrying their structural `context`. The resolved strategy is returned too so
 * callers can record it on the document.
 */
export function chunkDocument(
  text: string,
  opts: ChunkDocumentOptions = {},
): { chunks: Chunk[]; strategy: Exclude<ChunkStrategy, "auto"> } {
  const normalized = text.replace(/\r\n/g, "\n");
  const strategy =
    !opts.strategy || opts.strategy === "auto"
      ? detectStrategy(normalized, opts.format)
      : opts.strategy;
  const size = opts.size ?? DEFAULT_SIZE;
  const overlap = opts.overlap ?? DEFAULT_OVERLAP;

  let chunks: Chunk[];
  switch (strategy) {
    case "markdown":
      chunks = chunkMarkdown(normalized, size, overlap);
      break;
    case "sentence":
      chunks = recursiveChunks(normalized, size, overlap, [". ", " "]).map((c) => ({ content: c }));
      break;
    case "recursive":
      chunks = recursiveChunks(normalized, size, overlap).map((c) => ({ content: c }));
      break;
    case "paragraph":
    default:
      chunks = chunkText(normalized, { size, overlap }).map((c) => ({ content: c }));
      break;
  }
  return { chunks: chunks.filter((c) => c.content.trim()), strategy };
}

/**
 * Markdown header-aware chunking. Walks the document tracking the heading stack
 * so every chunk records its heading path as `context`. Fenced code blocks are
 * never split. Section bodies larger than `size` are recursively split, each
 * piece inheriting the section's heading path.
 */
function chunkMarkdown(text: string, size: number, overlap: number): Chunk[] {
  const lines = text.split("\n");
  const out: Chunk[] = [];

  // Heading stack: index = level-1 (h1..h6). headingPath() joins the live trail.
  const headings: string[] = [];
  const headingPath = () => headings.filter(Boolean).join(" › ");

  let body: string[] = [];
  let inFence = false;
  let fenceMarker = "";

  const flush = (path: string) => {
    const section = body.join("\n").trim();
    body = [];
    if (!section) return;
    const pieces = section.length > size ? recursiveChunks(section, size, overlap) : [section];
    for (const content of pieces) out.push({ content, context: path || undefined });
  };

  for (const line of lines) {
    const fence = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (line.trimStart().startsWith(fenceMarker)) {
        inFence = false;
      }
      body.push(line);
      continue;
    }

    const header = !inFence && line.match(MARKDOWN_HEADER);
    if (header) {
      // Close the current section under the path it belonged to, then update the
      // heading stack for what follows.
      flush(headingPath());
      const level = header[1].length;
      headings.length = level - 1; // pop deeper/sibling headings
      headings[level - 1] = header[2].trim();
      continue;
    }

    body.push(line);
  }
  flush(headingPath());
  return out;
}

/**
 * Recursive character splitter: try increasingly fine separators until pieces
 * fit `size`, packing adjacent pieces back up to `size` with `overlap`. The
 * default separator ladder mirrors the common RAG recursive splitter.
 */
export function recursiveChunks(
  text: string,
  size: number,
  overlap: number,
  separators: string[] = ["\n\n", "\n", ". ", " "],
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= size) return [trimmed];

  // Find the coarsest separator that actually divides this text.
  const sep = separators.find((s) => trimmed.includes(s));
  const rest = sep ? separators.slice(separators.indexOf(sep) + 1) : [];
  const parts = sep ? splitKeepSep(trimmed, sep) : hardSlice(trimmed, size);

  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    const piece = part.length > size && sep ? null : part;
    if (piece === null) {
      // Part still too big for this level — recurse with finer separators.
      if (current.trim()) chunks.push(current.trim());
      current = "";
      chunks.push(...recursiveChunks(part, size, overlap, rest.length ? rest : []));
      continue;
    }
    if (current && current.length + piece.length > size) {
      chunks.push(current.trim());
      current = overlap > 0 ? tail(current, overlap) + piece : piece;
    } else {
      current += piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/** Split on a separator but keep it attached to the preceding piece. */
function splitKeepSep(text: string, sep: string): string[] {
  const parts = text.split(sep);
  return parts.map((p, i) => (i < parts.length - 1 ? p + sep : p)).filter((p) => p.length);
}

/** Last-resort fixed-width slicing for text with no usable separators. */
function hardSlice(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
