import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";

export interface ClientSearchResult {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = getStaffSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Query param ─────────────────────────────────────────────────────────────
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ clients: [] });
  }

  // ── Search across name / email / phone ──────────────────────────────────────
  const clients = await db.golfClient.findMany({
    where: {
      OR: [
        { email: { contains: q } },
        { phone: { contains: q } },
        { firstName: { contains: q } },
        { lastName: { contains: q } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 10,
  });

  return NextResponse.json({ clients } satisfies { clients: ClientSearchResult[] });
}
