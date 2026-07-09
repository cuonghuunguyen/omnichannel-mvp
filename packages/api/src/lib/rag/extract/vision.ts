// Vision captioning: the text fallback for images when a bucket's embedder can't
// embed images directly. We ask a vision-capable model to describe the image so
// the description can be chunked + embedded like any other text. OCR text from
// the extractor is preferred when present; captioning fills the gap for diagrams,
// photos, and screenshots where there's little or no text layer.
import { generateText } from "ai";
import { resolveModel } from "@/lib/models";
import type { ExtractedImage } from "@/lib/rag/extract/index";
import { logger } from "@/lib/logger";

/** Vision model for captioning; Sonnet is vision-capable and cheap enough here. */
const VISION_MODEL = process.env.VISION_MODEL?.trim() || "claude-sonnet-4-6";

const SYSTEM =
  "You describe images for a search index. Write a dense, factual description: " +
  "what the image shows, any visible text verbatim, and details someone might " +
  "search for. No preamble — just the description.";

/**
 * Produce searchable text for an image. Uses OCR/alt text from the extractor when
 * available; otherwise asks the vision model to describe it. Returns "" if both
 * the source text is empty and captioning fails (caller decides what to do).
 */
export async function imageToText(image: ExtractedImage): Promise<string> {
  const existing = image.text?.trim();
  if (existing) return existing;
  try {
    const { text } = await generateText({
      model: resolveModel(VISION_MODEL),
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image for search." },
            { type: "image", image: image.data, mediaType: image.mediaType },
          ],
        },
      ],
    });
    return text.trim();
  } catch (err) {
    logger.error({ err }, "[rag] image captioning failed");
    return "";
  }
}
