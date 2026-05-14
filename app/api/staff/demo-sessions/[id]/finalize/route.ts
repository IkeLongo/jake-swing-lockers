import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { syncGolfDemoToGHL } from "@/lib/ghl/syncGolfDemo";

// ── POST /api/staff/demo-sessions/[id]/finalize ───────────────────────────────
//
// Finalizes a reviewed demo session by persisting club averages into permanent
// golf tables (DemoClubTest + ClubTestMetrics).
//
// Body: { batchId: number }
//
// Behavior:
//   1. Require staff auth.
//   2. Validate DemoSession exists.
//   3. If already finalized → return idempotent success (no duplicate writes).
//   4. Validate ImportBatch exists and belongs to this session.
//   5. Load ImportClubSummary rows where includeInReport === true.
//   6. If none included → 400 error.
//   7. Transaction:
//      a. Create DemoClubTest per included club summary.
//      b. Create ClubTestMetrics for each DemoClubTest.
//      c. Mark DemoSession.status = "finalized".
//      d. Mark ImportBatch.status = "finalized".
//
// Data mapping: ImportClubSummary → DemoClubTest + ClubTestMetrics
//   clubName       → DemoClubTest.clubType
//   shotCount      → (no direct column — stored via ClubTestMetrics context)
//   avgClubSpeed   → ClubTestMetrics.clubSpeed
//   avgBallSpeed   → ClubTestMetrics.ballSpeed
//   avgSpinRate    → ClubTestMetrics.spinRate  (rounded to Int)
//   avgCarry       → ClubTestMetrics.carryDistance
//   avgTotal       → ClubTestMetrics.totalDistance
//   avgMaxHeight   → (no column in ClubTestMetrics V1 — skipped, see TODO)
//
// TODO (post-finalization): Swing Locker link generation
// TODO (post-finalization): GHL follow-up sync trigger
// TODO (post-finalization): Customer access / OTP setup

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const staffSession = getStaffSessionFromRequest(req);
  if (!staffSession) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Parse session ID ─────────────────────────────────────────────────────────
  const { id: idStr } = await params;
  const sessionId = parseInt(idStr, 10);
  if (isNaN(sessionId) || sessionId <= 0) {
    return NextResponse.json(
      { error: "Invalid session ID." },
      { status: 400 },
    );
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let batchId: number;
  try {
    const body = (await req.json()) as { batchId?: unknown };
    batchId = typeof body.batchId === "number" ? body.batchId : parseInt(String(body.batchId), 10);
    if (isNaN(batchId) || batchId <= 0) throw new Error("invalid batchId");
  } catch {
    return NextResponse.json(
      { error: "batchId (number) is required." },
      { status: 400 },
    );
  }

  // ── Load DemoSession ─────────────────────────────────────────────────────────
  const session = await db.demoSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, needsRefinalization: true },
  });
  if (!session) {
    return NextResponse.json(
      { error: "Demo session not found." },
      { status: 404 },
    );
  }

  // ── Already finalized and not dirty — true idempotent short-circuit ───────────
  if (session.status === "finalized" && !session.needsRefinalization) {
    return NextResponse.json({
      success: true,
      alreadyFinalized: true,
      message: "This demo session has already been finalized.",
    });
  }

  // ── Load ImportBatch — verify it belongs to this session ─────────────────────
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true, demoSessionId: true, status: true },
  });
  if (!batch) {
    return NextResponse.json(
      { error: "Import batch not found." },
      { status: 404 },
    );
  }
  if (batch.demoSessionId !== sessionId) {
    return NextResponse.json(
      { error: "Import batch does not belong to this session." },
      { status: 400 },
    );
  }

  // ── Load included club summaries ─────────────────────────────────────────────
  const summaries = await db.importClubSummary.findMany({
    where: { importBatchId: batchId, includeInReport: true },
    orderBy: { clubName: "asc" },
  });

  if (summaries.length === 0) {
    return NextResponse.json(
      {
        error:
          "No clubs are included in the report. Enable at least one club before finalizing.",
      },
      { status: 400 },
    );
  }

  // ── Transactional write ──────────────────────────────────────────────────────
  const isRefinalize = session.status === "finalized";

  // ── Re-finalization guard: block if purchase requests reference club tests ────
  //
  // Re-finalization deletes and recreates DemoClubTest rows. If PurchaseRequestItem
  // rows reference those rows via demoClubTestId (no cascade), Prisma throws P2003.
  // Block early with a 409 rather than letting the transaction fail mid-way.
  //
  // TODO (future): implement versioned/soft-deactivated club tests so re-finalization
  // can coexist with historical purchase requests without blocking.
  if (isRefinalize) {
    const purchaseRequestCount = await db.purchaseRequest.count({
      where: { demoSessionId: sessionId },
    });
    if (purchaseRequestCount > 0) {
      return NextResponse.json(
        {
          error:
            "This session already has purchase requests tied to finalized club tests. " +
            "Re-finalization is blocked to preserve purchase request history.",
        },
        { status: 409 },
      );
    }
  }

  try {
    await db.$transaction(async (tx) => {
      // For re-finalization: delete existing DemoClubTest rows (and their metrics)
      // for this session before recreating from current ImportClubSummary state.
      if (isRefinalize) {
        const existingTests = await tx.demoClubTest.findMany({
          where: { demoSessionId: sessionId },
          select: { id: true },
        });
        const testIds = existingTests.map((t) => t.id);
        if (testIds.length > 0) {
          await tx.clubTestMetrics.deleteMany({
            where: { clubTestId: { in: testIds } },
          });
          await tx.demoClubTest.deleteMany({
            where: { id: { in: testIds } },
          });
        }
      }

      for (let i = 0; i < summaries.length; i++) {
        const s = summaries[i]!;

        // Round Decimal spinRate to Int for ClubTestMetrics
        const spinRateInt =
          s.avgSpinRate !== null
            ? Math.round(s.avgSpinRate.toNumber())
            : null;

        // a. Create DemoClubTest
        const clubTest = await tx.demoClubTest.create({
          data: {
            demoSessionId: sessionId,
            clubType: s.clubName,
            estimatedPrice: s.estimatedPrice ?? null,
            sortOrder: i,
            clubRole: "demo",
            pairIndex: 0,
            isRecommended: false,
          },
          select: { id: true },
        });

        // b. Create ClubTestMetrics
        await tx.clubTestMetrics.create({
          data: {
            clubTestId: clubTest.id,
            clubSpeed: s.avgClubSpeed,
            ballSpeed: s.avgBallSpeed,
            spinRate: spinRateInt,
            carryDistance: s.avgCarry,
            totalDistance: s.avgTotal,
            // smashFactor, launchAngle, dispersion: not in ImportClubSummary V1
            // avgMaxHeight: no matching column in ClubTestMetrics V1 — skipped
            // TODO: add maxHeight to ClubTestMetrics when schema is extended
          },
        });
      }

      // c. Mark session as finalized and clear the dirty flag
      await tx.demoSession.update({
        where: { id: sessionId },
        data: { status: "finalized", needsRefinalization: false },
      });

      // d. Mark import batch as finalized
      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: "finalized" },
      });
    });
  } catch (err) {
    console.error("[POST /api/staff/demo-sessions/[id]/finalize]", err);
    return NextResponse.json(
      { error: "Failed to finalize session. Please try again." },
      { status: 500 },
    );
  }

  // Trigger CRM sync after finalize/re-finalize succeeds.
  // Finalization must remain successful even if external GHL sync fails.
  try {
    const ghlSync = await syncGolfDemoToGHL(sessionId);
    if (!ghlSync.success) {
      console.warn(
        "[POST /api/staff/demo-sessions/[id]/finalize] GHL sync failed:",
        ghlSync.error,
      );
    }
  } catch (err) {
    console.error(
      "[POST /api/staff/demo-sessions/[id]/finalize] Unexpected GHL sync error:",
      err,
    );
  }

  return NextResponse.json({
    success: true,
    alreadyFinalized: false,
    isRefinalize,
    clubCount: summaries.length,
    message: isRefinalize
      ? "Demo session re-finalized successfully. Club data has been updated."
      : "Demo session finalized successfully. Club averages have been saved.",
  });
}
