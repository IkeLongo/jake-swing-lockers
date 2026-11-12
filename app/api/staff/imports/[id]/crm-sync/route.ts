import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { runClaimedStagedFittingSync } from "@/lib/ghl/runClaimedStagedFittingSync";
import { FITTING_RECONCILIATION_MESSAGE } from "@/lib/ghl/syncErrorMarker";

// POST /api/staff/imports/[id]/crm-sync
//
// Retryable CRM sync for a locally finalized staged fitting. The body is
// ignored: everything is derived from the persisted ImportBatch/DemoSession.
// A CRM failure never changes the local fitting.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!getStaffSessionFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  try {
    const batch = await db.importBatch.findUnique({
      where: { id: Number(id) },
      select: { demoSessionId: true },
    });
    if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
    if (!batch.demoSessionId) {
      return NextResponse.json({ error: "Finalize the fitting before syncing." }, { status: 409 });
    }
    const sessionId = batch.demoSessionId;
    const claimResult = await runClaimedStagedFittingSync(db, Number(id), sessionId);
    if (claimResult.status === "customer_busy") {
      return NextResponse.json(
        { success: false, status: "failed", code: "customer-sync-pending", error: "Customer contact synchronization is in progress. Retry CRM sync after it completes.", retryable: true },
        { status: 409 },
      );
    }
    if (claimResult.status !== "result") {
      return NextResponse.json(
        { success: false, status: "failed", code: "sync-needs-reconciliation", error: FITTING_RECONCILIATION_MESSAGE, retryable: false },
        { status: 409 },
      );
    }
    const result = claimResult.result;

    if (result.ok) {
      return NextResponse.json({
        success: true,
        status: "synced",
        alreadySynced: result.alreadySynced,
        demoSessionId: result.demoSessionId,
        ghlContactId: result.ghlContactId,
        ghlOpportunityId: result.ghlOpportunityId,
      });
    }

    if (result.status === "failed") {
      // The fitting itself is saved; 502 signals only that the CRM step failed.
      return NextResponse.json(
        {
          success: false,
          status: "failed",
          demoSessionId: result.demoSessionId,
          retryable: result.retryable,
          ...(result.code ? { code: result.code } : {}),
          error: result.error,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { success: false, error: result.error, code: result.code },
      { status: result.httpStatus },
    );
  } catch (error) {
    console.error("[POST /api/staff/imports/[id]/crm-sync]", error);
    return NextResponse.json(
      { success: false, status: "failed", error: "CRM sync could not be confirmed. Refresh the fitting and seek staff review before retrying.", retryable: false },
      { status: 500 },
    );
  }
}
