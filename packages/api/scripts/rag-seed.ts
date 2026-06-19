// Seed a demo knowledge base into the RAG store and wire it to the seeded
// specialist agents. Run AFTER `docker compose up -d`, `pnpm rag:setup`, and
// `pnpm db:seed`:
//   pnpm rag:seed
//
// Uses the default embedding provider (EMBEDDING_PROVIDER, "local" by default —
// downloads the bge-small model on first run).
import "dotenv/config";
import { createBucket, ingestDocument, listBuckets } from "@/lib/rag/buckets";
import { ragPool } from "@/lib/rag/store";
import { db } from "@/lib/db";

const DOCS: { title: string; source: string; content: string }[] = [
  {
    title: "Amenities & Hours",
    source: "azure-bay/amenities",
    content: `Azure Bay Hotel & Resort amenities and operating hours.

Pool: The outdoor infinity pool is open daily from 7:00 AM to 9:00 PM. Towels are provided poolside. Children under 12 must be accompanied by an adult.

Spa: The Azure Spa offers massages, facials, and a sauna. Open 9:00 AM to 8:00 PM. Booking is recommended; call extension 540 or ask the front desk.

Fitness center: The 24-hour gym is on level 2 and is accessible with your room key. It has cardio machines, free weights, and a Peloton studio.

Restaurant: Tide & Table serves breakfast 6:30–10:30 AM, lunch 12:00–2:30 PM, and dinner 6:00–10:00 PM. Room service is available 24 hours.`,
  },
  {
    title: "Check-in & Check-out",
    source: "azure-bay/check-in",
    content: `Check-in and check-out policy.

Check-in time is 3:00 PM. Early check-in may be available on request and is subject to availability; ask at booking or call ahead.

Check-out time is 11:00 AM. Late check-out until 2:00 PM can be arranged for a fee of $40, subject to availability.

A valid government-issued photo ID and the credit card used for booking are required at check-in. A $100 incidental hold is placed on the card and released at check-out.`,
  },
  {
    title: "Wi-Fi & Connectivity",
    source: "azure-bay/wifi",
    content: `Internet access.

Complimentary high-speed Wi-Fi is available throughout the property for all guests. Connect to the "AzureBay-Guest" network and enter your room number and last name to sign in.

Premium Wi-Fi (for streaming and video calls) is included for guests in Suite categories and Loyalty Gold members; others can upgrade for $12.99 per day.`,
  },
  {
    title: "Rooms, Rates & Packages",
    source: "azure-bay/rooms",
    content: `Room types and packages.

Harbor View King: 1 king bed, 35 sqm, partial bay view. From $189/night.
Deluxe Ocean Suite: 1 king bed plus sofa bed, 60 sqm, full ocean view and balcony. From $329/night.
Garden Twin: 2 double beds, 32 sqm, garden view, family-friendly. From $159/night.

Packages: The "Romance Package" adds a bottle of sparkling wine, late check-out, and a couples' spa credit for $89. The "Family Fun" package includes breakfast for four and waived resort fees for stays of 3+ nights.

The resort fee is $25/night and covers pool, gym, and Wi-Fi.`,
  },
  {
    title: "Cancellation & Pet Policy",
    source: "azure-bay/policies",
    content: `Cancellation and pets.

Cancellation: Standard rate bookings can be cancelled free of charge up to 48 hours before arrival. Cancellations within 48 hours are charged one night's stay. Non-refundable rates cannot be cancelled or modified.

Pets: Azure Bay is pet-friendly for dogs under 25 kg. A pet fee of $50 per stay applies, with a maximum of two pets per room. Pets must not be left unattended in rooms.`,
  },
];

const TENANT_ID = process.env.TENANT_ID?.trim() || "default";

async function main() {
  // Reuse an existing demo bucket if present, else create one (this tenant's).
  const existing = (await listBuckets(TENANT_ID)).find((b) => b.name === "Azure Bay Knowledge");
  const bucket = existing ?? (await createBucket({
    tenantId: TENANT_ID,
    name: "Azure Bay Knowledge",
    description: "Hotel policies, amenities, rooms, and FAQs for Azure Bay Hotel & Resort.",
  }));
  console.log(`Bucket: ${bucket.name} (${bucket.id}) — ${bucket.embeddingProvider}/${bucket.embeddingModel}`);

  if (!existing) {
    for (const doc of DOCS) {
      const d = await ingestDocument(bucket.id, TENANT_ID, doc);
      console.log(`  ingested "${d.title}" — ${d.chunkCount} chunks`);
    }
  } else {
    console.log("  bucket already existed; skipped ingestion.");
  }

  // Assign the bucket to the specialist agents so they answer from it.
  const knowledge = JSON.stringify({ enabled: true, bucketIds: [bucket.id], topK: 5 });
  const res = await db.agent.updateMany({
    where: { tenantId: TENANT_ID, id: { in: ["seed-support", "seed-sales"] } },
    data: { knowledge },
  });
  console.log(`Assigned knowledge base to ${res.count} seeded agent(s).`);

  await db.$disconnect();
  await ragPool().end();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
