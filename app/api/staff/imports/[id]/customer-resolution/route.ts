import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { parseCustomerResolution } from "@/lib/imports/customer-resolution";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseCustomerResolution(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const batchId = Number(id);
  if (!Number.isSafeInteger(batchId)) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true, parserMode: true, demoSessionId: true },
  });
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }
  if (batch.parserMode !== "trackman-result" || batch.demoSessionId !== null) {
    return NextResponse.json(
      { error: "Customer resolution can only be staged for unlinked TrackMan imports." },
      { status: 409 },
    );
  }

  if (parsed.state.selectedGolfClientId !== null) {
    const selectedClient = await db.golfClient.findUnique({
      where: { id: parsed.state.selectedGolfClientId },
      select: { id: true },
    });
    if (!selectedClient) {
      return NextResponse.json({ error: "GolfClient not found." }, { status: 404 });
    }
  }

  const update = await db.importBatch.updateMany({
    where: {
      id: batchId,
      parserMode: "trackman-result",
      demoSessionId: null,
    },
    data: parsed.state,
  });
  if (update.count === 0) {
    return NextResponse.json(
      { error: "Customer resolution is unavailable for this import." },
      { status: 409 },
    );
  }

  const persisted = await db.importBatch.findUnique({
    where: { id: batchId },
    select: {
      customerResolution: true,
      selectedGolfClientId: true,
      proposedFirstName: true,
      proposedLastName: true,
      proposedEmail: true,
      proposedPhone: true,
    },
  });
  if (!persisted) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, state: persisted });
}
