import { subscribe, type ConversationEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of a conversation's live updates (new messages and
 * status changes). Both the guest chat and the human inbox subscribe to this.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ConversationEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const unsubscribe = subscribe(id, send);

      // Open the stream and keep it warm against idle proxy timeouts.
      controller.enqueue(encoder.encode(": connected\n\n"));
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 25_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    // Fires when the client disconnects.
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
