import { type NextRequest, NextResponse } from "next/server";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { db } from "@/lib/db";
import {
  getOpportunityById,
  STAGE_CLOSED_NO_PURCHASE,
  STAGE_PURCHASED,
  updateGolfDemoOpportunity,
} from "@/lib/ghl/opportunities";
import { updatePurchaseRequestStatus } from "@/lib/queries/purchase-requests";
import {
  LEGACY_PURCHASE_REQUEST_STATUS_MAP,
  PURCHASE_REQUEST_STATUSES,
  toCanonicalPurchaseRequestStatus,
} from "@/lib/purchase-request-status";

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

  const canonicalStatus =
    typeof status === "string" ? toCanonicalPurchaseRequestStatus(status) : null;
  if (!canonicalStatus) {
    return NextResponse.json(
      {
        error: `status must be one of: ${PURCHASE_REQUEST_STATUSES.join(", ")} (legacy accepted during rollout: ${Object.keys(LEGACY_PURCHASE_REQUEST_STATUS_MAP).join(", ")})`,
      },
      { status: 400 }
    );
  }

  const updated = await updatePurchaseRequestStatus(id, canonicalStatus);
  if (!updated) {
    return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  }

  // Only final outcome statuses move GHL stages.
  if (canonicalStatus === "purchased" || canonicalStatus === "closed_lost") {
    try {
      const request = await db.purchaseRequest.findUnique({
        where: { id },
        select: {
          id: true,
          demoSession: { select: { ghlOpportunityId: true } },
        },
      });

      const opportunityId = request?.demoSession.ghlOpportunityId;
      if (!opportunityId) {
        await db.purchaseRequest.update({
          where: { id },
          data: {
            ghlSyncStatus: "failed",
            ghlSyncError: "Missing linked DemoSession.ghlOpportunityId for final status sync",
          },
        });
      } else {
        const purchasedStageId = STAGE_PURCHASED();
        const closedNoPurchaseStageId = STAGE_CLOSED_NO_PURCHASE();
        const targetStageId =
          canonicalStatus === "purchased" ? purchasedStageId : closedNoPurchaseStageId;

        const opportunity = await getOpportunityById(opportunityId);
        if (!opportunity) {
          throw new Error(`GHL opportunity not found for ID ${opportunityId}`);
        }

        // Staff actions are authoritative for final outcome corrections.
        // Allow movement between purchased ↔ closed_lost to correct mistakes.
        // Skip only if already in the exact target stage (idempotent no-op).
        const isAlreadyTarget = opportunity.pipelineStageId === targetStageId;

        if (!isAlreadyTarget) {
          await updateGolfDemoOpportunity(opportunityId, { pipelineStageId: targetStageId });
        }

        await db.purchaseRequest.update({
          where: { id },
          data: {
            ghlOpportunityId: opportunityId,
            ghlSyncStatus: "synced",
            ghlLastSyncedAt: new Date(),
            ghlSyncError: null,
          },
        });
      }
    } catch (syncErr) {
      const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
      console.warn(
        `[PATCH /api/staff/purchase-requests/${id}] Final status GHL sync failed:`,
        message
      );
      await db.purchaseRequest.update({
        where: { id },
        data: {
          ghlSyncStatus: "failed",
          ghlSyncError: message,
        },
      });
    }
  }

  return NextResponse.json(updated);
}
