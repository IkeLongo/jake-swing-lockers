import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { claimFittingSync, releaseFittingSync } from "@/lib/ghl/fittingSyncClaim";
import {
  confirmFittingContactRecovery,
  inspectFittingContactRecovery,
} from "@/lib/ghl/recoverFittingContact";

const headers = { "Cache-Control": "no-store" };

async function authorize(req: NextRequest) {
  const session = getStaffSessionFromRequest(req);
  if (!session) return null;
  const staff = await db.staffUser.findUnique({
    where: { id: session.staffUserId },
    select: { isActive: true },
  });
  return staff?.isActive ? session : null;
}

function batchId(id: string): number | null {
  const value = Number(id);
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(value) ? value : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!await authorize(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
    const id = batchId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid batch ID." }, { status: 400, headers });
    const review = await inspectFittingContactRecovery(db, id);
    if (!review) {
      return NextResponse.json({ error: "This fitting cannot be recovered here. Review its CRM state first." }, { status: 409, headers });
    }
    return NextResponse.json({
      fingerprint: review.fingerprint,
      contact: review.contact,
      previousDecision: review.batch.ghlContactDecision,
      previousContactId: review.batch.approvedGhlContactId,
    }, { headers });
  } catch (error) {
    console.error("[GET contact-recovery]", error);
    return NextResponse.json({ error: "Could not verify the contact. Try again later." }, { status: 502, headers });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await authorize(req);
    if (!staff) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
    const id = batchId((await params).id);
    if (id === null) return NextResponse.json({ error: "Invalid batch ID." }, { status: 400, headers });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers });
    }
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      !("confirmed" in body) || body.confirmed !== true ||
      !("fingerprint" in body) || typeof body.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.fingerprint)
    ) return NextResponse.json({ error: "Explicit confirmation of the reviewed contact is required." }, { status: 400, headers });
    const batch = await db.importBatch.findUnique({ where: { id }, select: { demoSessionId: true } });
    if (!batch?.demoSessionId) return NextResponse.json({ error: "Finalized fitting not found." }, { status: 409, headers });
    const claim = await claimFittingSync(db, batch.demoSessionId);
    if (!claim) return NextResponse.json({ error: "This fitting has an active or interrupted sync. Reconcile it before retrying." }, { status: 409, headers });
    let confirmed: boolean;
    try {
      confirmed = await confirmFittingContactRecovery(db, id, staff.staffUserId, claim, body.fingerprint);
    } finally {
      await releaseFittingSync(db, batch.demoSessionId, claim);
    }
    if (!confirmed) return NextResponse.json({ error: "The fitting or contact changed. Review it again." }, { status: 409, headers });
    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    console.error("[POST contact-recovery]", error);
    return NextResponse.json({ error: "Could not update the contact approval. Review the fitting before retrying." }, { status: 500, headers });
  }
}
