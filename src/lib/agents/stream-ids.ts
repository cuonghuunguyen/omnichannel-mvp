import type { UIMessageChunk } from "ai";

/**
 * Rewrite text/reasoning block ids in a UI message stream so they are unique.
 *
 * When several `streamText` calls (multiple agent hops, or multi-step turns) are
 * merged into one assistant message, providers tend to reuse the same block id
 * (e.g. DeepSeek emits `txt-0` every step). Identical ids make the client
 * collapse distinct blocks into one. We assign a fresh id per block, keyed by
 * the original id so the start/delta/end of a block stay consistent.
 */
export function withUniqueBlockIds<Chunk extends UIMessageChunk>(
  stream: ReadableStream<Chunk>,
  prefix: string,
): ReadableStream<Chunk> {
  const active = new Map<string, string>();
  let counter = 0;

  return stream.pipeThrough(
    new TransformStream<Chunk, Chunk>({
      transform(chunk, controller) {
        const remappable =
          chunk.type.startsWith("text-") || chunk.type.startsWith("reasoning-");
        if (remappable && "id" in chunk && typeof chunk.id === "string") {
          const isStart = chunk.type.endsWith("-start");
          if (isStart) active.set(chunk.id, `${prefix}-${counter++}`);
          const mapped = active.get(chunk.id);
          if (mapped) {
            controller.enqueue({ ...chunk, id: mapped });
            if (chunk.type.endsWith("-end")) active.delete(chunk.id);
            return;
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
