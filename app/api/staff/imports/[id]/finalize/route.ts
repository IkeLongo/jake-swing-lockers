import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { finalizeStagedImport } from "@/lib/imports/staged-finalization";
import { createPrismaStagedFinalizeDeps } from "@/lib/imports/staged-finalization-store";

// POST /api/staff/imports/[id]/finalize
//
// Locally finalizes a staged TrackMan import from the state already stored on
// the ImportBatch (customer, opportunity, club summaries). The request body is
// intentionally ignored: nothing the client sends can change the outcome.
// CRM (GHL) sync is not performed here.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const staffSession = getStaffSessionFromRequest(req);
  if (!staffSession) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }
  const batchId = Number(id);

  try {
    const staffUser = await db.staffUser.findUnique({
      where: { id: staffSession.staffUserId },
      select: { name: true },
    });

    const result = await finalizeStagedImport(
      createPrismaStagedFinalizeDeps(db),
      { batchId, salesRep: staffUser?.name ?? null },
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, retryable: result.retryable },
        { status: result.status },
      );
    }

    return NextResponse.json({
      success: true,
      alreadyFinalized: result.alreadyFinalized,
      demoSessionId: result.demoSessionId,
      golfClientId: result.golfClientId,
      opportunityResolution: result.opportunityResolution,
      ghlOpportunityId: result.ghlOpportunityId,
      clubCount: result.clubCount,
    });
  } catch (error) {
    console.error("[POST /api/staff/imports/[id]/finalize]", error);
    return NextResponse.json(
      {
        error: "Failed to finalize the fitting. Nothing was saved; please try again.",
        code: "internal_error",
        retryable: true,
      },
      { status: 500 },
    );
  }
}
