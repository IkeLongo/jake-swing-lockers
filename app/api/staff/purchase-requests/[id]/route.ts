import { type NextRequest, NextResponse } from "next/server";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { updatePurchaseRequestStatus } from "@/lib/queries/purchase-requests";

const VALID_STATUSES = ["pending", "contacted", "completed", "cancelled"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { status } = (body ?? {}) as Record<string, unknown>;

  if (typeof status !== "string" || !(VALID_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const updated = await updatePurchaseRequestStatus(id, status);
  if (!updated) {
    return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
