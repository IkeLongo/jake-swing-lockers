import { type NextRequest, NextResponse } from "next/server";
import { getSwingLockerSessionFromRequest } from "@/lib/auth/requireSwingLockerSession";
import {
  getExistingPurchaseRequest,
  createPurchaseRequest,
} from "@/lib/queries/purchase-requests";
import { db } from "@/lib/db";
import { deliverPurchaseRequestEmails } from "@/lib/ghl/deliverPurchaseRequestEmails";
import {
  updateGolfDemoOpportunity,
  getOpportunityById,
  STAGE_CONSIDERING_PURCHASE,
} from "@/lib/ghl/opportunities";
import { isDuplicatePurchaseRequest, purchaseClubName } from "@/lib/purchase-request-workflow";
import { drainPurchaseRequestOpportunityValue } from "@/lib/ghl/purchaseRequestOpportunityValue";

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getSwingLockerSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { golfClientId } = session;

  // ── Parse + validate body ───────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).demoSessionId !== "number" ||
    !Array.isArray((body as Record<string, unknown>).clubIds) ||
    ((body as Record<string, unknown>).clubIds as unknown[]).length === 0
  ) {
    return NextResponse.json(
      { error: "demoSessionId (number) and clubIds (non-empty array) are required" },
      { status: 400 }
    );
  }

  const { demoSessionId, clubIds, notes } = body as {
    demoSessionId: number;
    clubIds: unknown[];
    notes?: unknown;
  };

  // All clubIds must be numbers
  if (!clubIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ error: "clubIds must be an array of numbers" }, { status: 400 });
  }
  const clubIdList = clubIds as number[];

  // Optional notes must be a string if provided
  const notesStr =
    typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : undefined;

  // ── Verify session ownership + finalized status ─────────────────────────────
  const demoSession = await db.demoSession.findFirst({
    where: {
      id: demoSessionId,
      clientId: golfClientId, // ownership
      status: "finalized",    // finalized-only
    },
    select: { id: true },
  });

  if (!demoSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // ── Verify all clubIds belong to this session ───────────────────────────────
  const clubs = await db.demoClubTest.findMany({
    where: {
      id: { in: clubIdList },
      demoSessionId, // security: clubs must belong to the verified session
      availableForPurchase: true,
    },
    select: { id: true, clubType: true, clubRole: true, tags: true, estimatedPrice: true },
  });

  if (clubs.length !== clubIdList.length) {
    return NextResponse.json(
      { error: "One or more clubs are not available for purchase in this session" },
      { status: 400 }
    );
  }

  // ── Duplicate guard ─────────────────────────────────────────────────────────
  const existing = await getExistingPurchaseRequest(golfClientId, demoSessionId);
  if (isDuplicatePurchaseRequest(existing)) {
    return NextResponse.json(
      { error: "A purchase request already exists for this session", id: existing.id },
      { status: 409 }
    );
  }

  // ── Create request ──────────────────────────────────────────────────────────
  const items = clubs.map((club) => ({
    demoClubTestId: club.id,
    clubType: purchaseClubName(club),
    estimatedPrice: club.estimatedPrice != null ? Number(club.estimatedPrice) : null,
  }));

  const result = await createPurchaseRequest(golfClientId, demoSessionId, items, notesStr);

  // ── Send confirmation emails ────────────────────────────────────────────────
  // Email failures must not prevent the saved request's value synchronization.
  try {
    await deliverPurchaseRequestEmails(result.id);
  } catch (error) {
    console.error("[purchase-request] Failed to deliver confirmation emails:", error);
  }

  // ── Move GHL opportunity to Considering Purchase stage ─────────────────────────
  // After successful request creation and email delivery, check if the session has
  // a linked GHL opportunity. If so, move it to Considering Purchase stage.
  // Failure here does not block the purchase request.
  try {
    const sessionWithOpp = await db.demoSession.findUnique({
      where: { id: demoSessionId },
      select: { ghlOpportunityId: true },
    });

    if (sessionWithOpp?.ghlOpportunityId) {
      const opp = await getOpportunityById(sessionWithOpp.ghlOpportunityId);
      if (opp) {
        // Stages that block moving forward to Considering Purchase.
        // Skip if already in final stages (Purchased, Closed, etc).
        const stagesToSkip = [
          process.env.GHL_SWINGLOCKER_STAGE_NEEDS_ANOTHER_FITTING_ID,
          process.env.GHL_SWINGLOCKER_STAGE_PURCHASED_ID,
          process.env.GHL_SWINGLOCKER_STAGE_CLOSED_NO_PURCHASE_ID,
          process.env.GHL_SWINGLOCKER_STAGE_LONG_TERM_NURTURE_ID,
        ].filter((id): id is string => !!id);

        // If already in a skip stage, do not move
        if (!stagesToSkip.includes(opp.pipelineStageId)) {
          // Allowed: Demo Submitted, Swing Locker Sent, Locker Opened,
          // Engaged / In Conversation, or already Considering Purchase
          const consideringPurchaseId = STAGE_CONSIDERING_PURCHASE();

          await updateGolfDemoOpportunity(sessionWithOpp.ghlOpportunityId, {
            pipelineStageId: consideringPurchaseId,
          });

          // Update purchase request with GHL sync status
          await db.purchaseRequest.update({
            where: { id: result.id },
            data: {
              ghlOpportunityId: sessionWithOpp.ghlOpportunityId,
              ghlSyncStatus: "synced",
              ghlLastSyncedAt: new Date(),
              ghlSyncError: null,
            },
          });
        }
      }
    }
  } catch (stageErr) {
    // Log but do not fail the purchase request
    const errorMessage =
      stageErr instanceof Error ? stageErr.message : String(stageErr);
    console.warn(
      "[POST /api/swing-locker/purchase-requests] Failed to move opportunity to Considering Purchase:",
      errorMessage
    );

    // Mark purchase request with GHL error
    try {
      await db.purchaseRequest.update({
        where: { id: result.id },
        data: {
          ghlSyncStatus: "failed",
          ghlSyncError: errorMessage,
        },
      });
    } catch (updateErr) {
      console.error(
        "[POST /api/swing-locker/purchase-requests] Failed to log GHL error on purchase request:",
        updateErr
      );
    }
  }

  try {
    if (!result.opportunityId) {
      throw new Error("The fitting has no linked GHL opportunity for value synchronization.");
    }
    if (await drainPurchaseRequestOpportunityValue(result.opportunityId) === "queued") {
      console.warn("[purchase-request] Opportunity value update is queued behind another attempt.", { requestId: result.id });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[purchase-request] Opportunity value synchronization failed:", message);
    try {
      await db.purchaseRequest.update({
        where: { id: result.id },
        data: { ghlSyncStatus: "failed", ghlSyncError: message },
      });
    } catch (updateError) {
      console.error("[purchase-request] Failed to record the opportunity value sync error:", updateError);
    }
  }

  return NextResponse.json({ id: result.id }, { status: 201 });
}
