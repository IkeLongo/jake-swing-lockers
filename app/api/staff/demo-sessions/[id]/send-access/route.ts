import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Staff auth
  const staff = getStaffSessionFromRequest(req);
  if (!staff) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate id
  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  // 3. Load session + client
  const session = await db.demoSession.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      client: {
        select: { email: true, phone: true },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 4. Must be finalized
  if (session.status !== "finalized") {
    return NextResponse.json(
      { error: "Session must be finalized before sending access." },
      { status: 400 },
    );
  }

  // 5. Client must have email or phone
  if (!session.client.email && !session.client.phone) {
    return NextResponse.json(
      { error: "Client needs an email or phone number before access can be sent." },
      { status: 400 },
    );
  }

  // 6. Mark as pending
  // Future: background job reads accessInviteStatus = "pending" rows,
  // sends GHL message linking to /swing-locker/login, sets status = "sent",
  // accessInviteSentAt = now(), creates GhlSyncEvent { eventType: "access_invite_sent" }
  await db.demoSession.update({
    where: { id },
    data: {
      accessInviteStatus: "pending",
      accessInviteQueuedAt: new Date(),
      accessInviteError: null,
    },
  });

  return NextResponse.json({ success: true });
}
