// Text chunking for ingestion. Paragraph-aware: we pack whole paragraphs up to
// a target size, carrying a small overlap of trailing text into the next chunk
// so a fact split across a boundary is still retrievable from both sides.

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
