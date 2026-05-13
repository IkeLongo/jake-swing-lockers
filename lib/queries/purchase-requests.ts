import { db } from "@/lib/db";

// ── Return shapes ─────────────────────────────────────────────────────────────

export interface PurchaseRequestSummary {
  id: number;
  status: string;
  notes: string | null;
  createdAt: Date;
  golfClientId: number;
  demoSessionId: number;
  clientName: string;
  demoDate: Date;
  itemCount: number;
}

export interface ExistingPurchaseRequest {
  id: number;
  status: string;
  createdAt: Date;
}

export interface PurchaseRequestDetailItem {
  id: number;
  demoClubTestId: number;
  /** Denormalized snapshot stored at submission time */
  clubType: string | null;
  estimatedPrice: number | null;
  /** Live club data from DemoClubTest (may differ if staff edited after submission) */
  brand: string | null;
  model: string | null;
  /** Metrics from ClubTestMetrics — null if not recorded */
  clubSpeed: number | null;
  ballSpeed: number | null;
  spinRate: number | null;
  carryDistance: number | null;
  totalDistance: number | null;
}

export interface PurchaseRequestDetail {
  id: number;
  status: string;
  notes: string | null;
  createdAt: Date;
  golfClientId: number;
  demoSessionId: number;
  client: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  demoSession: {
    demoDate: Date;
    status: string;
  };
  items: PurchaseRequestDetailItem[];
  estimatedSubtotal: number | null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns the full detail for a single purchase request (staff view).
 * Includes client, session, items with live club data and metrics.
 * Returns null if not found.
 */
export async function getPurchaseRequestDetail(
  id: number
): Promise<PurchaseRequestDetail | null> {
  const row = await db.purchaseRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      notes: true,
      createdAt: true,
      golfClientId: true,
      demoSessionId: true,
      golfClient: {
        select: { firstName: true, lastName: true, email: true, phone: true },
      },
      demoSession: {
        select: { demoDate: true, status: true },
      },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          demoClubTestId: true,
          clubType: true,
          estimatedPrice: true,
          demoClubTest: {
            select: {
              brand: true,
              model: true,
              metrics: {
                select: {
                  clubSpeed: true,
                  ballSpeed: true,
                  spinRate: true,
                  carryDistance: true,
                  totalDistance: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!row) return null;

  const items: PurchaseRequestDetailItem[] = row.items.map((item) => ({
    id: item.id,
    demoClubTestId: item.demoClubTestId,
    clubType: item.clubType,
    estimatedPrice: item.estimatedPrice != null ? Number(item.estimatedPrice) : null,
    brand: item.demoClubTest.brand,
    model: item.demoClubTest.model,
    clubSpeed: item.demoClubTest.metrics?.clubSpeed != null
      ? Number(item.demoClubTest.metrics.clubSpeed) : null,
    ballSpeed: item.demoClubTest.metrics?.ballSpeed != null
      ? Number(item.demoClubTest.metrics.ballSpeed) : null,
    spinRate: item.demoClubTest.metrics?.spinRate ?? null,
    carryDistance: item.demoClubTest.metrics?.carryDistance != null
      ? Number(item.demoClubTest.metrics.carryDistance) : null,
    totalDistance: item.demoClubTest.metrics?.totalDistance != null
      ? Number(item.demoClubTest.metrics.totalDistance) : null,
  }));

  const prices = items.map((i) => i.estimatedPrice).filter((p): p is number => p != null);
  const estimatedSubtotal = prices.length > 0
    ? prices.reduce((sum, p) => sum + p, 0)
    : null;

  return {
    id: row.id,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    golfClientId: row.golfClientId,
    demoSessionId: row.demoSessionId,
    client: row.golfClient,
    demoSession: row.demoSession,
    items,
    estimatedSubtotal,
  };
}

/**
 * Returns an existing purchase request for the given client + session pair,
 * or null if none exists.
 *
 * Used to render the "Purchase Requested" badge on the session detail page
 * instead of the "Request Purchase" button.
 */
export async function getExistingPurchaseRequest(
  golfClientId: number,
  demoSessionId: number
): Promise<ExistingPurchaseRequest | null> {
  const row = await db.purchaseRequest.findFirst({
    where: { golfClientId, demoSessionId },
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return row ?? null;
}

/**
 * Creates a PurchaseRequest with its items in a single transaction.
 *
 * `items` should carry DemoClubTest.id plus the denormalized snapshot fields
 * (clubType, estimatedPrice) captured at submission time.
 */
export async function createPurchaseRequest(
  golfClientId: number,
  demoSessionId: number,
  items: { demoClubTestId: number; clubType: string | null; estimatedPrice: number | null }[],
  notes?: string
): Promise<{ id: number }> {
  return db.$transaction(async (tx) => {
    const request = await tx.purchaseRequest.create({
      data: {
        golfClientId,
        demoSessionId,
        status: "pending",
        notes: notes ?? null,
        items: {
          create: items.map((item) => ({
            demoClubTestId: item.demoClubTestId,
            clubType: item.clubType,
            estimatedPrice: item.estimatedPrice,
          })),
        },
      },
      select: { id: true },
    });
    return { id: request.id };
  });
}

/**
 * Returns all purchase requests ordered by most recent first.
 * Includes denormalized client name and session date for the staff table.
 */
export async function listAllPurchaseRequests(): Promise<PurchaseRequestSummary[]> {
  const rows = await db.purchaseRequest.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      notes: true,
      createdAt: true,
      golfClientId: true,
      demoSessionId: true,
      golfClient: {
        select: { firstName: true, lastName: true, email: true },
      },
      demoSession: {
        select: { demoDate: true },
      },
      _count: { select: { items: true } },
    },
  });

  return rows.map((row) => {
    const parts = [row.golfClient.firstName, row.golfClient.lastName].filter(Boolean);
    const clientName =
      parts.length > 0 ? parts.join(" ") : (row.golfClient.email ?? `Client #${row.golfClientId}`);

    return {
      id: row.id,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      golfClientId: row.golfClientId,
      demoSessionId: row.demoSessionId,
      clientName,
      demoDate: row.demoSession.demoDate,
      itemCount: row._count.items,
    };
  });
}

/**
 * Updates the status of a purchase request.
 * Returns the updated row, or null if not found.
 */
export async function updatePurchaseRequestStatus(
  id: number,
  status: string
): Promise<{ id: number; status: string } | null> {
  try {
    const row = await db.purchaseRequest.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
    return row;
  } catch {
    return null;
  }
}
