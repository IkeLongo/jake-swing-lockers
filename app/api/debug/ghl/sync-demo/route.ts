import { NextRequest, NextResponse } from "next/server";
import { syncGolfDemoToGHL } from "@/lib/ghl/syncGolfDemo";

export async function POST(req: NextRequest) {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const secret = req.nextUrl.searchParams.get("secret");
  const expected = process.env.DEBUG_SETUP_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("demoSessionId" in body)
  ) {
    return NextResponse.json(
      { error: "Body must include demoSessionId" },
      { status: 400 }
    );
  }

  const rawId = (body as Record<string, unknown>).demoSessionId;
  const demoSessionId = Number(rawId);

  if (!Number.isInteger(demoSessionId) || demoSessionId <= 0) {
    return NextResponse.json(
      { error: "demoSessionId must be a positive integer" },
      { status: 400 }
    );
  }

  // ── Run sync ──────────────────────────────────────────────────────────────
  const result = await syncGolfDemoToGHL(demoSessionId);

  return NextResponse.json(result, {
    status: result.success ? 200 : 500,
  });
}
