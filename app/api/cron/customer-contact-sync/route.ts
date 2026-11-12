import { timingSafeEqual } from "node:crypto";
import { runCustomerContactSyncBatch } from "@/lib/ghl/runCustomerContactSyncBatch";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[customer-contact-sync-cron] CRON_SECRET is not configured.");
    return Response.json({ error: "Cron is not configured." }, { status: 503 });
  }
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runCustomerContactSyncBatch(2, undefined, { stopStartingAfterMs: 20_000 });
    if (result.summary.errors > 0) {
      return Response.json(result, { status: 500 });
    }
    return Response.json(result);
  } catch (error) {
    console.error("[customer-contact-sync-cron] Batch failed.", error);
    return Response.json({ error: "Customer contact synchronization failed." }, { status: 500 });
  }
}
