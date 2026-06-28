// markitdown-node adapter: the binary-format backend for the Extractor. Loaded
// lazily (only when a non-text file is ingested) because it pulls in heavy
// parsing deps (pdf-ts, mammoth, exceljs, jsdom, sharp, tesseract.js). Isolating
// it here means swapping converters later touches only this file.
//
// We load it through createRequire (its CommonJS build) rather than `import`:
// markitdown-node's ESM bundle calls `require` internally, which throws in this
// "type": "module" package. The CJS build works correctly.
import { createRequire } from "node:module";
import type { DocumentItem, ConversionResult } from "markitdown-node";
import type { DocFormat } from "@/lib/rag/chunk";
import {
  imageMediaType,
  isImageFile,
  type ExtractedDoc,
  type ExtractedImage,
  type ExtractInput,
  type Extractor,
} from "@/lib/rag/extract/index";

const require = createRequire(import.meta.url);

type MarkitdownModule = {
  convertDocument(source: Buffer | string, filename?: string): Promise<ConversionResult>;
};

let cached: MarkitdownModule | undefined;
function lib(): MarkitdownModule {
  if (!cached) cached = require("markitdown-node") as MarkitdownModule;
  return cached;
}

export function markitdownExtractor(): Extractor {
  return {
    async extract(input: ExtractInput): Promise<ExtractedDoc> {
      const result = await lib().convertDocument(input.buffer, input.filename);
      const text = (result.markdown_content ?? "").trim();
      const sourceFormat = String(result.document?.metadata?.format ?? "unknown");
      const warnings = [...(result.warnings ?? []), ...(result.errors ?? [])];

      const images: ExtractedImage[] = [];
      // The file is itself an image: keep the raw bytes for multimodal embedding,
      // with the OCR'd markdown as the text fallback.
      if (isImageFile(input.filename, input.mimeType)) {
        images.push({
          data: input.buffer,
          mediaType: imageMediaType(input.filename, input.mimeType),
          text: text || undefined,
        });
      }
      // Plus any figures embedded inside a document (DOCX/PPTX/HTML/PDF).
      if (result.document?.content) {
        collectImages(result.document.content, images);
      }

      // markitdown emits Markdown; an image-only file with no OCR text is "text".
      const format: DocFormat = text ? "markdown" : "text";

      return {
        format,
        text,
        images,
        meta: {
          filename: input.filename,
          mimeType: input.mimeType,
          sourceFormat,
          title: result.document?.metadata?.title,
          pageCount: result.document?.metadata?.pageCount,
        },
        warnings: warnings.length ? warnings : undefined,
      };
    },
  };
}

/** Depth-first collect of embedded image items that carry raw bytes. */
function collectImages(items: DocumentItem[], out: ExtractedImage[]): void {
  for (const item of items) {
    // Compare the enum's string value directly so we don't import the enum at
    // runtime (it lives in the CJS-only module).
    if (String(item.type) === "image") {
      const img = item as DocumentItem & { data?: Buffer; src?: string; alt?: string };
      if (img.data && img.data.length) {
        out.push({
          data: img.data,
          mediaType: guessMediaType(img.src),
          alt: img.alt,
          text: img.alt,
        });
      }
    }
    if (item.children?.length) collectImages(item.children, out);
  }
}

function guessMediaType(src?: string): string {
  if (!src) return "image/png";
  const m = src.match(/\.(png|jpe?g|webp|gif|tiff?|bmp)(?:$|\?)/i);
  const ext = m?.[1]?.toLowerCase();
  if (!ext) return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return `image/${ext}`;
}
