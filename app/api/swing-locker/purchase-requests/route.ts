import { type NextRequest, NextResponse } from "next/server";
import { getSwingLockerSessionFromRequest } from "@/lib/auth/requireSwingLockerSession";
import {
  getExistingPurchaseRequest,
  createPurchaseRequest,
  getPurchaseRequestDetail,
} from "@/lib/queries/purchase-requests";
import { db } from "@/lib/db";
import { deliverPurchaseRequestEmails } from "@/lib/ghl/deliverPurchaseRequestEmails";
import {
  updateGolfDemoOpportunity,
  getOpportunityById,
  STAGE_DEMO_SUBMITTED,
  STAGE_SWING_LOCKER_SENT,
  STAGE_LOCKER_OPENED,
  STAGE_CONSIDERING_PURCHASE,
} from "@/lib/ghl/opportunities";

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
    },
    select: { id: true, clubType: true, estimatedPrice: true },
  });

  if (clubs.length !== clubIdList.length) {
    return NextResponse.json(
      { error: "One or more club IDs are invalid for this session" },
      { status: 400 }
    );
  }

  // ── Duplicate guard ─────────────────────────────────────────────────────────
  const existing = await getExistingPurchaseRequest(golfClientId, demoSessionId);
  if (existing) {
    return NextResponse.json(
      { error: "A purchase request already exists for this session", id: existing.id },
      { status: 409 }
    );
  }

  // ── Create request ──────────────────────────────────────────────────────────
  const items = clubs.map((club) => ({
    demoClubTestId: club.id,
    clubType: club.clubType,
    estimatedPrice: club.estimatedPrice != null ? Number(club.estimatedPrice) : null,
  }));

  const result = await createPurchaseRequest(golfClientId, demoSessionId, items, notesStr);

  // ── Send confirmation emails ────────────────────────────────────────────────
  // Failures are caught and logged inside the helper — purchase request creation
  // always succeeds regardless of email delivery outcome.
  await deliverPurchaseRequestEmails(result.id);

  // ── Move GHL opportunity to Considering Purchase stage ─────────────────────────
  // After successful request creation and email delivery, check if the session has
  // a linked GHL opportunity. If so, move it to Considering Purchase stage with the
  // purchase request subtotal as the opportunity monetary value.
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
          const detail = await getPurchaseRequestDetail(result.id);
          const monetaryValue = detail?.estimatedSubtotal ?? undefined;
          const consideringPurchaseId = STAGE_CONSIDERING_PURCHASE();

          await updateGolfDemoOpportunity(sessionWithOpp.ghlOpportunityId, {
            pipelineStageId: consideringPurchaseId,
            monetaryValue,
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

  return NextResponse.json({ id: result.id }, { status: 201 });
}
