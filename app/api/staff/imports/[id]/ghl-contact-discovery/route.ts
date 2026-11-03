import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import { discoverContactForBatch } from "@/lib/ghl/discoverBatchContact";
import { createPrismaDiscoveryDeps } from "@/lib/ghl/discoverBatchContactStore";
import { ContactDiscoveryUnavailableError } from "@/lib/ghl/discoverStagedContacts";
import { computeDiscoverySignature } from "@/lib/ghl/discoverySignature";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// GET /api/staff/imports/[id]/ghl-contact-discovery
//
// Read-only. Identifiers come from the persisted ImportBatch / selected
// GolfClient only; the request carries nothing but the batch ID. Issues GHL
// GET requests and never writes to the database or to GHL.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!getStaffSessionFromRequest(req)) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401, headers: NO_STORE },
    );
  }

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return NextResponse.json(
      { error: "Invalid batch ID." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await discoverContactForBatch(
      createPrismaDiscoveryDeps(db),
      Number(id),
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.httpStatus, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        success: true,
        customer: result.customer,
        localCustomer: result.localCustomer,
        discovery: result.discovery,
        discoverySignature: computeDiscoverySignature(result.discovery),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof ContactDiscoveryUnavailableError) {
      console.error("[GET /api/staff/imports/[id]/ghl-contact-discovery]", error.cause);
      return NextResponse.json(
        {
          error: "GHL is unavailable, so contacts could not be checked. Try again shortly.",
          code: "ghl_unavailable",
        },
        { status: 502, headers: NO_STORE },
      );
    }
    console.error("[GET /api/staff/imports/[id]/ghl-contact-discovery]", error);
    return NextResponse.json(
      { error: "Failed to look up GHL contacts." },
      { status: 500, headers: NO_STORE },
    );
  }
}
