// File extraction: turn an uploaded file into text (Markdown) plus any images,
// so the rest of the ingestion pipeline (chunk → embed → store) only ever deals
// with text + image items, never raw file formats.
//
// This is the "markitdown-style" layer. Text-like inputs (txt/md/csv) are
// decoded directly with no dependency; everything else (pdf/docx/pptx/xlsx/html/
// images) is delegated to the markitdown-node backend behind the `Extractor`
// interface, so the heavy parsing deps load lazily and can be swapped per format.
import type { DocFormat } from "@/lib/rag/chunk";

/** A raw image pulled from a file (the file itself, or an embedded figure). */
export type ExtractedImage = {
  /** Raw bytes, for true multimodal embedding (Phase 2). */
  data: Buffer;
  /** e.g. "image/png". */
  mediaType: string;
  /** Alt text / caption if the source provided one. */
  alt?: string;
  /** OCR or surrounding text, used as the text-embedding fallback. */
  text?: string;
};

export type ExtractedDoc = {
  /** Shape of `text`, so the chunker can pick a strategy. */
  format: DocFormat;
  /** Full textual representation (Markdown for converted docs) for chunking. */
  text: string;
  /** Images for multimodal embedding; empty for pure-text documents. */
  images: ExtractedImage[];
  meta: {
    filename: string;
    mimeType?: string;
    /** Detected source format, e.g. "pdf", "docx", "image", "text". */
    sourceFormat: string;
    title?: string;
    pageCount?: number;
  };
  warnings?: string[];
};

export type ExtractInput = {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
};

export interface Extractor {
  extract(input: ExtractInput): Promise<ExtractedDoc>;
}

const TEXT_EXT = new Set(["txt", "text", "log"]);
const MARKDOWN_EXT = new Set(["md", "markdown", "mdown"]);
const CSV_EXT = new Set(["csv", "tsv"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "tiff", "tif", "bmp"]);

const IMAGE_MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
  tif: "image/tiff",
  bmp: "image/bmp",
};

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export function isImageFile(filename: string, mimeType?: string): boolean {
  if (mimeType?.startsWith("image/")) return true;
  return IMAGE_EXT.has(fileExtension(filename));
}

/**
 * Extract a file into text + images. Plain-text/markdown/csv are decoded inline
 * (no heavy deps); all other formats go through the markitdown backend.
 */
export async function extractFile(input: ExtractInput): Promise<ExtractedDoc> {
  const ext = fileExtension(input.filename);

  // Fast, dependency-free path for text-like content.
  if (MARKDOWN_EXT.has(ext) || input.mimeType === "text/markdown") {
    return textDoc(input, "markdown", "markdown");
  }
  if (TEXT_EXT.has(ext) || input.mimeType === "text/plain") {
    return textDoc(input, "text", "text");
  }
  if (CSV_EXT.has(ext) || input.mimeType === "text/csv") {
    // CSV is small and the markitdown CSV backend just tables it; treat as text.
    return textDoc(input, "text", "csv");
  }

  // Everything else → markitdown backend (lazy-loaded).
  const { markitdownExtractor } = await import("@/lib/rag/extract/markitdown");
  return markitdownExtractor().extract(input);
}

function textDoc(input: ExtractInput, format: DocFormat, sourceFormat: string): ExtractedDoc {
  return {
    format,
    text: input.buffer.toString("utf8"),
    images: [],
    meta: { filename: input.filename, mimeType: input.mimeType, sourceFormat },
  };
}

export function imageMediaType(filename: string, mimeType?: string): string {
  if (mimeType?.startsWith("image/")) return mimeType;
  return IMAGE_MEDIA[fileExtension(filename)] ?? "image/png";
}
