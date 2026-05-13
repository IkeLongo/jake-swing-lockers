import { type NextRequest, NextResponse } from "next/server";
import { ghlFetch, normalizeName } from "@/lib/ghl/client";

interface GhlCustomField {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
  type?: string;
  parentId?: string | null;
  position?: number;
}

interface GhlCustomFieldsResponse {
  customFields: GhlCustomField[];
}

// Folder/group lookup — GHL may return a parentId referencing a "folder" custom field
interface GhlCustomFieldFolder {
  id: string;
  name: string;
}

interface GhlCustomFieldFoldersResponse {
  customFieldFolders?: GhlCustomFieldFolder[];
  folders?: GhlCustomFieldFolder[];
}

function checkSecret(req: NextRequest): NextResponse | null {
  const debugSecret = process.env.DEBUG_SETUP_SECRET;
  if (debugSecret) {
    const incoming = req.nextUrl.searchParams.get("secret") ?? "";
    if (incoming !== debugSecret) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  return null;
}

// Target field name → env key
const FIELD_TARGETS: Array<{ envKey: string; normalized: string }> = [
  { envKey: "GHL_SWINGLOCKER_CF_SWING_LOCKER_URL",          normalized: normalizeName("Swing Locker URL") },
  { envKey: "GHL_SWINGLOCKER_CF_LATEST_DEMO_SESSION_ID",     normalized: normalizeName("Latest Demo Session ID") },
  { envKey: "GHL_SWINGLOCKER_CF_LATEST_DEMO_DATE",           normalized: normalizeName("Latest Demo Date") },
  { envKey: "GHL_SWINGLOCKER_CF_RECOMMENDED_CLUB_SUMMARY",   normalized: normalizeName("Recommended Club Summary") },
  { envKey: "GHL_SWINGLOCKER_CF_DEMO_FOLLOWUP_STATUS",       normalized: normalizeName("Demo Follow-Up Status") },
  { envKey: "GHL_SWINGLOCKER_CF_BUYER_INTEREST_LEVEL",       normalized: normalizeName("Buyer Interest Level") },
  { envKey: "GHL_SWINGLOCKER_CF_SALES_REP_NAME",             normalized: normalizeName("Sales Rep Name") },
  { envKey: "GHL_CF_DEMO_LOCATION",              normalized: normalizeName("Demo Location") },
];

export async function GET(req: NextRequest) {
  const deny = checkSecret(req);
  if (deny) return deny;

  const locationId = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!locationId) {
    return NextResponse.json({ success: false, error: "Missing GHL_SWINGLOCKER_LOCATION_ID" }, { status: 500 });
  }

  let data: GhlCustomFieldsResponse;
  try {
    data = await ghlFetch<GhlCustomFieldsResponse>(
      `/locations/${encodeURIComponent(locationId)}/customFields`
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch GHL custom fields",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  // Attempt to fetch folders (best-effort, not all GHL plans expose this)
  let folderMap: Map<string, string> = new Map();
  try {
    const folderData = await ghlFetch<GhlCustomFieldFoldersResponse>(
      `/locations/${encodeURIComponent(locationId)}/customFieldFolders`
    );
    const folders = folderData.customFieldFolders ?? folderData.folders ?? [];
    for (const f of folders) {
      folderMap.set(f.id, f.name);
    }
  } catch {
    // Folder fetch is optional — silently continue
  }

  const fields = (data.customFields ?? []).map((f) => ({
    name: f.name,
    id: f.id,
    key: f.fieldKey ?? null,
    type: f.dataType ?? f.type ?? null,
    folder: f.parentId ? (folderMap.get(f.parentId) ?? f.parentId) : null,
  }));

  // Build envSuggestions
  const envSuggestions: Record<string, string | null> = {};
  for (const target of FIELD_TARGETS) {
    const match = fields.find((f) => normalizeName(f.name) === target.normalized);
    envSuggestions[target.envKey] = match?.id ?? null;
  }

  return NextResponse.json({
    success: true,
    fields,
    envSuggestions,
  });
}
