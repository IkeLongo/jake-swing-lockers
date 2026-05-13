import { type NextRequest, NextResponse } from "next/server";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { listAllPurchaseRequests } from "@/lib/queries/purchase-requests";

export async function GET(req: NextRequest) {
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requests = await listAllPurchaseRequests();
  return NextResponse.json(requests);
}
