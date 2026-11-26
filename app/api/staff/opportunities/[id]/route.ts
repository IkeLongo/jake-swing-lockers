import { db } from "@/lib/db";
import { getOpportunityById } from "@/lib/ghl/opportunities";
import { mapGhlStageToJlStage } from "@/lib/pipeline/stages";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { calculateFittingValue, sumPrices } from "@/lib/fitting-value";
import { PURCHASE_REQUEST_VALUE_STATUSES } from "@/lib/purchase-request-status";
import type { NextRequest } from "next/server";

/**
 * GET /api/staff/opportunities/[id]
 *
 * Returns opportunity details including:
 * - Local GolfClient, DemoSessions, and PurchaseRequests
 * - GHL opportunity stage and monetary value (optional if GHL is unavailable)
 *
 * Requires staff authentication. Unauthenticated requests return 401.
 * Data is always returned from local DB (if any sessions exist).
 * GHL opportunity details (stage, monetaryValue) are fetched and included if available.
 *
 * Response:
 * - 200: Opportunity found locally
 * - 401: Unauthenticated or unauthorized staff
 * - 404: No local DemoSessions linked to this opportunity ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Authentication ──────────────────────────────────────────────────────
  const staffSession = getStaffSessionFromRequest(request);
  if (!staffSession) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id: opportunityId } = await params;

  if (!opportunityId || typeof opportunityId !== "string") {
    return Response.json(
      { error: "Invalid opportunity ID" },
      { status: 400 }
    );
  }

  // ── Fetch all local data first (always available) ────────────────────────

  const sessions = await db.demoSession.findMany({
    where: { ghlOpportunityId: opportunityId },
    select: {
      id: true,
      demoDate: true,
      status: true,
      currentClub: true,
      clientGoal: true,
      notes: true,
      client: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      importBatches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          rowCount: true,
          clubSummaries: {
            select: { id: true, includeInReport: true, estimatedPrice: true },
          },
        },
      },
      purchaseRequests: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
        },
      },
    },
    orderBy: { demoDate: "desc" },
  });

  // 404 if no sessions exist for this opportunity
  if (sessions.length === 0) {
    return Response.json(
      { error: "No sessions found for this opportunity" },
      { status: 404 }
    );
  }

  // ── Fetch purchase requests for this opportunity (via sessions) ──────────

  const purchaseRequests = await db.purchaseRequest.findMany({
    where: {
      demoSession: {
        ghlOpportunityId: opportunityId,
      },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      demoSessionId: true,
      items: {
        select: {
          estimatedPrice: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── Determine client name from primary (most recent) session ─────────────

  const primarySession = sessions[0]!;
  const clientName =
    [primarySession.client.firstName, primarySession.client.lastName]
      .filter(Boolean)
      .join(" ") ||
    primarySession.client.email ||
    "Unknown";

  // ── Fetch GHL opportunity (optional; safe failure) ─────────────────────

  let ghlStage: string | null = null;
  let ghlMonetaryValue: number = 0;
  let ghlUnavailable = false;

  try {
    const opp = await getOpportunityById(opportunityId, AbortSignal.timeout(10_000));
    if (opp) {
      ghlStage = mapGhlStageToJlStage(opp.pipelineStageId);
      const monetaryValue = (opp as Record<string, unknown>).monetaryValue;
      ghlMonetaryValue = typeof monetaryValue === "number" ? monetaryValue : 0;
    } else {
      // getOpportunityById returns null if fetch fails or opportunity doesn't exist in GHL
      ghlUnavailable = true;
    }
  } catch (error) {
    // Additional safety: catch any unexpected errors during GHL fetch
    ghlUnavailable = true;
    console.warn("[opportunities API] Failed to fetch GHL opportunity", {
      opportunityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // ── Calculate local values ────────────────────────────────────────────

  const qualifyingStatuses = new Set<string>(PURCHASE_REQUEST_VALUE_STATUSES);
  const estimatedValue = calculateFittingValue(
    sessions.flatMap((session) =>
      session.status === "finalized" ? session.importBatches[0]?.clubSummaries ?? [] : [],
    ),
  );
  const purchaseRequestValue = sumPrices(
    purchaseRequests.flatMap((req) =>
      qualifyingStatuses.has(req.status) ? req.items.map((item) => item.estimatedPrice) : [],
    ),
  );

  // ── Build response ─────────────────────────────────────────────────────

  return Response.json({
    opportunityId,
    customerName: clientName,
    primaryContact: {
      email: primarySession.client.email,
      phone: primarySession.client.phone,
    },
    estimatedOpportunityValue: estimatedValue.total,
    estimatedOpportunityHasMissingPrices: estimatedValue.hasMissingPrices,
    purchaseRequestValue,
    ghl: {
      stage: ghlStage,
      monetaryValue: ghlMonetaryValue,
      unavailable: ghlUnavailable,
    },
    sessions: sessions.map((session) => ({
      id: session.id,
      demoDate: session.demoDate,
      status: session.status,
      currentClub: session.currentClub,
      clientGoal: session.clientGoal,
      notes: session.notes,
      clubCount: session.importBatches[0]?.clubSummaries.length ?? 0,
      fittingValue: calculateFittingValue(session.importBatches[0]?.clubSummaries ?? []),
      importBatchId: session.importBatches[0]?.id ?? null,
      importBatchStatus: session.importBatches[0]?.status ?? null,
      purchaseRequestIds: session.purchaseRequests.map((pr) => pr.id),
    })),
    purchaseRequests: purchaseRequests.map((req) => ({
      id: req.id,
      status: req.status,
      createdAt: req.createdAt,
      demoSessionId: req.demoSessionId,
      subtotal: sumPrices(req.items.map((item) => item.estimatedPrice)),
    })),
  });
}
