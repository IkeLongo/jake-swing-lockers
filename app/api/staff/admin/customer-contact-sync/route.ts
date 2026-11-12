import { NextRequest, NextResponse } from "next/server";
import { requireAdminStaffSession } from "@/lib/auth/requireAdminStaffSession";
import {
  DEFAULT_CUSTOMER_SYNC_BATCH_SIZE,
  MAX_CUSTOMER_SYNC_BATCH_SIZE,
  runCustomerContactSyncBatch,
} from "@/lib/ghl/runCustomerContactSyncBatch";
import { isCustomerContactSyncEnabled } from "@/lib/ghl/customerContactSyncProcessor";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdminStaffSession(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Access denied." },
      { status: auth.reason === "no_session" ? 401 : 403 },
    );
  }

  if (!isCustomerContactSyncEnabled()) {
    return NextResponse.json(
      { error: "Customer contact synchronization is disabled." },
      { status: 409 },
    );
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json." },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "limit")
  ) {
    return NextResponse.json({ error: "Invalid batch options." }, { status: 400 });
  }
  const { limit = DEFAULT_CUSTOMER_SYNC_BATCH_SIZE } = body as { limit?: unknown };
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CUSTOMER_SYNC_BATCH_SIZE
  ) {
    return NextResponse.json({ error: "Invalid batch size." }, { status: 400 });
  }

  try {
    const result = await runCustomerContactSyncBatch(limit);
    return NextResponse.json(result, {
      status: result.status === "disabled" ? 409 : 200,
    });
  } catch {
    console.error("[customer-contact-sync-batch] Failed to start the batch.");
    return NextResponse.json(
      { error: "Failed to run customer contact synchronization." },
      { status: 500 },
    );
  }
}
