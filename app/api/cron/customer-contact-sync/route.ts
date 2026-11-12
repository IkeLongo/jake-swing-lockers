import { timingSafeEqual } from "node:crypto";
import { runCustomerContactSyncBatch } from "@/lib/ghl/runCustomerContactSyncBatch";
import { runPendingFittingSyncBatch } from "@/lib/ghl/runPendingFittingSyncBatch";

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
    const startedAt = Date.now();
    const customerFirst = Math.floor(startedAt / 86_400_000) % 2 === 0;
    const remaining = () => Math.max(0, 22_000 - (Date.now() - startedAt));
    let customer: Awaited<ReturnType<typeof runCustomerContactSyncBatch>> | undefined;
    let fittings: Awaited<ReturnType<typeof runPendingFittingSyncBatch>> | undefined;
    const runCustomer = async () => {
      const budget = remaining();
      if (budget > 0) customer = await runCustomerContactSyncBatch(2, undefined, { stopStartingAfterMs: Math.min(7_000, budget) });
    };
    const runFittings = async () => {
      const budget = remaining();
      if (budget > 0) fittings = await runPendingFittingSyncBatch({ stopStartingAfterMs: budget });
    };
    if (customerFirst) {
      await runCustomer();
      if (customer?.status !== "disabled") await runFittings();
    } else {
      await runFittings();
      if (fittings?.status !== "disabled") await runCustomer();
    }
    const status = customer?.status === "disabled" || fittings?.status === "disabled" ? "disabled" : "completed";
    const result = { ...customer, status, fittings };
    return Response.json(result, { status: (customer?.summary.errors || fittings?.errors) ? 500 : 200 });
  } catch (error) {
    console.error("[customer-contact-sync-cron] Batch failed.", error);
    return Response.json({ error: "CRM recovery failed." }, { status: 500 });
  }
}
