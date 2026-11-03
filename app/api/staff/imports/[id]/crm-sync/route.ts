import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { syncStagedFittingToGHL } from "@/lib/ghl/syncStagedFitting";
import { createPrismaStagedSyncDeps } from "@/lib/ghl/syncStagedFittingStore";

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
    const result = await syncStagedFittingToGHL(
      createPrismaStagedSyncDeps(db),
      Number(id),
    );

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
      { success: false, error: "Failed to run CRM sync.", retryable: true },
      { status: 500 },
    );
  }
}
