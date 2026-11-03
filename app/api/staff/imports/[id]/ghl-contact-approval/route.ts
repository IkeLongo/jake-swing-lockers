import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { readGhlApproval, updateGhlApproval } from "@/lib/ghl/approveBatchContact";
import { createPrismaApprovalDeps } from "@/lib/ghl/approveBatchContactStore";
import { ContactDiscoveryUnavailableError } from "@/lib/ghl/discoverStagedContacts";
import { parseApprovalRequest } from "@/lib/imports/ghl-contact-approval";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function parseBatchId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const n = Number(id);
  return Number.isSafeInteger(n) ? n : null;
}

// GET /api/staff/imports/[id]/ghl-contact-approval
// Reads the persisted decision from the ImportBatch only; no GHL request.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!getStaffSessionFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  }
  const batchId = parseBatchId((await params).id);
  if (batchId === null) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await readGhlApproval(createPrismaApprovalDeps(db), batchId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.httpStatus, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { success: true, approval: result.approval },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[GET /api/staff/imports/[id]/ghl-contact-approval]", error);
    return NextResponse.json(
      { error: "Failed to load the GHL contact decision." },
      { status: 500, headers: NO_STORE },
    );
  }
}

// PUT /api/staff/imports/[id]/ghl-contact-approval
// Body: { action: "approve_existing", contactId, discoverySignature, acknowledgedDiscrepancies? }
//     | { action: "approve_new", discoverySignature, acknowledgedCandidateIds? }
//     | { action: "clear" }
// Discovery is recomputed server-side with read-only GHL lookups; the request
// never supplies contact details. Never writes to GHL or GolfClient.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  }
  const batchId = parseBatchId((await params).id);
  if (batchId === null) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: NO_STORE });
  }
  const parsed = parseApprovalRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, code: parsed.code },
      { status: parsed.httpStatus, headers: NO_STORE },
    );
  }

  try {
    const result = await updateGhlApproval(
      createPrismaApprovalDeps(db),
      batchId,
      parsed.request,
      session.staffUserId,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, details: result.details },
        { status: result.httpStatus, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        success: true,
        approval: result.approval,
        opportunityCleared: result.opportunityCleared,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof ContactDiscoveryUnavailableError) {
      console.error("[PUT /api/staff/imports/[id]/ghl-contact-approval]", error.cause);
      return NextResponse.json(
        {
          error: "GHL is unavailable, so the contact could not be verified. Try again shortly.",
          code: "ghl_unavailable",
        },
        { status: 502, headers: NO_STORE },
      );
    }
    console.error("[PUT /api/staff/imports/[id]/ghl-contact-approval]", error);
    return NextResponse.json(
      { error: "Failed to save the GHL contact decision." },
      { status: 500, headers: NO_STORE },
    );
  }
}
