import { type NextRequest, NextResponse } from "next/server";
import { getSwingLockerSessionFromRequest } from "@/lib/auth/requireSwingLockerSession";
import {
  getExistingPurchaseRequest,
  createPurchaseRequest,
} from "@/lib/queries/purchase-requests";
import { db } from "@/lib/db";

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

  return NextResponse.json({ id: result.id }, { status: 201 });
}
