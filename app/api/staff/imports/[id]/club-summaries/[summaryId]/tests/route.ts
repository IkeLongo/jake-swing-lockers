import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { parsePositiveRouteId } from "@/lib/imports/trackmanShotReview";
import { setStagedCurrentTests } from "@/lib/imports/stagedComparison";
import { createPrismaComparisonStore } from "@/lib/imports/stagedComparisonStore";

// PUT /api/staff/imports/[id]/club-summaries/[summaryId]/tests
//
// Sets the complete list of Test summaries compared against the Current
// summary [summaryId]. Body: { testSummaryIds: number[] } ([] clears them all).
// Response: { success, currentSummaryId, testSummaryIds, changed }.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; summaryId: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id, summaryId } = await params;
  const batchId = parsePositiveRouteId(id);
  const currentSummaryId = parsePositiveRouteId(summaryId);
  if (batchId === null || currentSummaryId === null) {
    return NextResponse.json({ error: "Invalid ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const testSummaryIds =
    body !== null && typeof body === "object"
      ? (body as { testSummaryIds?: unknown }).testSummaryIds
      : undefined;
  if (!Array.isArray(testSummaryIds)) {
    return NextResponse.json(
      { error: "testSummaryIds must be an array of positive integers." },
      { status: 422 },
    );
  }

  const result = await db.$transaction((tx) =>
    setStagedCurrentTests(
      createPrismaComparisonStore(tx),
      batchId,
      currentSummaryId,
      testSummaryIds,
    ),
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    currentSummaryId: result.currentSummaryId,
    testSummaryIds: result.testSummaryIds,
    changed: result.changed,
  });
}
