import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { parseOpportunityResolution } from "@/lib/imports/opportunity-resolution";
import {
  getOpportunityOptions,
  saveOpportunitySelection,
  type OpportunityFailure,
} from "@/lib/imports/opportunity-selection";
import { createPrismaOpportunityDeps } from "@/lib/imports/opportunity-store";

const deps = createPrismaOpportunityDeps(db);
const NO_STORE = { "Cache-Control": "no-store" };

function parseBatchId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const batchId = Number(id);
  return Number.isSafeInteger(batchId) ? batchId : null;
}

function failure(result: OpportunityFailure): NextResponse {
  return NextResponse.json(
    { error: result.error, code: result.code },
    { status: result.status, headers: NO_STORE },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!getStaffSessionFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const batchId = parseBatchId((await params).id);
  if (batchId === null) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  const result = await getOpportunityOptions(deps, batchId);
  if (!result.ok) return failure(result);
  return NextResponse.json(result.body, { headers: NO_STORE });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!getStaffSessionFromRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const batchId = parseBatchId((await params).id);
  if (batchId === null) {
    return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseOpportunityResolution(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await saveOpportunitySelection(deps, batchId, parsed.state);
  if (!result.ok) return failure(result);
  return NextResponse.json(
    { success: true, state: result.state },
    { headers: NO_STORE },
  );
}
