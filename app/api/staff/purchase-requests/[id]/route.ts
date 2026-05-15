import { type NextRequest, NextResponse } from "next/server";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { db } from "@/lib/db";
import {
  getOpportunityById,
  STAGE_CLOSED_NO_PURCHASE,
  STAGE_CONSIDERING_PURCHASE,
  STAGE_PURCHASED,
  updateGolfDemoOpportunity,
} from "@/lib/ghl/opportunities";
import {
  getPurchaseRequestEditSideEffectWarnings,
  shouldUpdateOpportunityMonetaryValue,
} from "@/lib/purchase-request-workflow";
import {
  getPurchaseRequestDetail,
  replacePurchaseRequestItems,
  updatePurchaseRequestStatus,
} from "@/lib/queries/purchase-requests";
import { deliverPurchaseRequestEmails } from "@/lib/ghl/deliverPurchaseRequestEmails";
import {
  isPurchaseRequestLockedStatus,
  toCanonicalPurchaseRequestStatus,
} from "@/lib/purchase-request-status";
import { parsePurchaseRequestEditPayload } from "@/lib/validations/purchase-request-edit";

async function syncFinalStatusToGhl(id: number, canonicalStatus: "purchased" | "closed_lost") {
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
      return;
    }

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

  const parsed = parsePurchaseRequestEditPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await db.purchaseRequest.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
  }

  // Status-only updates are always allowed, even from locked statuses.
  if (parsed.data.mode === "status_only") {
    const updated = await updatePurchaseRequestStatus(id, parsed.data.status);
    if (!updated) {
      return NextResponse.json({ error: "Purchase request not found" }, { status: 404 });
    }

    const canonicalStatus = toCanonicalPurchaseRequestStatus(updated.status);
    if (canonicalStatus === "purchased" || canonicalStatus === "closed_lost") {
      await syncFinalStatusToGhl(id, canonicalStatus);
    }

    return NextResponse.json({ ...updated, warnings: [] });
  }

  // Full edits (clubs/notes) are only allowed from editable statuses.
  if (isPurchaseRequestLockedStatus(existing.status)) {
    return NextResponse.json(
      {
        error:
          "Club and request note edits are blocked in final statuses (purchased, fulfilled, closed_lost). You may still update the request status.",
      },
      { status: 409 }
    );
  }

  const replacement = await replacePurchaseRequestItems(id, {
    demoClubTestIds: parsed.data.clubIds,
    notes: parsed.data.notes,
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
  });

  if (!replacement.ok) {
    const status = replacement.reason === "not_found"
      ? 404
      : replacement.reason === "locked"
        ? 409
        : 400;
    return NextResponse.json({ error: replacement.message }, { status });
  }

  // Best effort: email notifications should never fail the already-saved edit.
  const emailResult = await deliverPurchaseRequestEmails(id, "updated");
  const warnings = getPurchaseRequestEditSideEffectWarnings(emailResult);

  // Best effort: update opportunity value only when currently in Considering Purchase.
  try {
    const request = await db.purchaseRequest.findUnique({
      where: { id },
      select: {
        demoSession: {
          select: {
            ghlOpportunityId: true,
          },
        },
      },
    });

    const opportunityId = request?.demoSession.ghlOpportunityId;
    if (opportunityId) {
      const opportunity = await getOpportunityById(opportunityId);
      if (!opportunity) {
        warnings.push(`GHL opportunity not found for ID ${opportunityId}.`);
      } else if (
        shouldUpdateOpportunityMonetaryValue(
          opportunity.pipelineStageId,
          STAGE_CONSIDERING_PURCHASE()
        )
      ) {
        const detail = await getPurchaseRequestDetail(id);
        const monetaryValue = detail?.estimatedSubtotal ?? undefined;

        await updateGolfDemoOpportunity(opportunityId, { monetaryValue });

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
    }
  } catch (ghlErr) {
    const message = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
    warnings.push(`GHL monetary value update failed: ${message}`);

    await db.purchaseRequest.update({
      where: { id },
      data: {
        ghlSyncStatus: "failed",
        ghlSyncError: message,
      },
    });
  }

  const canonicalStatus = toCanonicalPurchaseRequestStatus(replacement.status);
  if (canonicalStatus === "purchased" || canonicalStatus === "closed_lost") {
    await syncFinalStatusToGhl(id, canonicalStatus);
  }

  return NextResponse.json({
    id: replacement.id,
    status: replacement.status,
    warnings,
  });
}
