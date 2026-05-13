import { type NextRequest, NextResponse } from "next/server";
import { ghlFetch, normalizeName } from "@/lib/ghl/client";

interface GhlStage {
  id: string;
  name: string;
  position?: number;
}

interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlStage[];
}

interface GhlPipelinesResponse {
  pipelines: GhlPipeline[];
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

// Stage name → env key mapping
const STAGE_ENV_MAP: Record<string, string> = {
  "demosubmitted":      "GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID",
  "swinglockersentid":  "GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID",
  "swingleckersent":    "GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID",
  "swinglockerssent":   "GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID",
};

const STAGE_TARGETS = [
  { envKey: "GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID",    normalized: normalizeName("Demo Submitted") },
  { envKey: "GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID", normalized: normalizeName("Swing Locker Sent") },
];

export async function GET(req: NextRequest) {
  const deny = checkSecret(req);
  if (deny) return deny;

  const locationId = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!locationId) {
    return NextResponse.json({ success: false, error: "Missing GHL_SWINGLOCKER_LOCATION_ID" }, { status: 500 });
  }

  const pipelineId = process.env.GHL_SWINGLOCKER_PIPELINE_ID;
  if (!pipelineId) {
    return NextResponse.json({ success: false, error: "Missing GHL_SWINGLOCKER_PIPELINE_ID" }, { status: 500 });
  }

  let data: GhlPipelinesResponse;
  try {
    data = await ghlFetch<GhlPipelinesResponse>(
      `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch GHL pipeline stages",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  const pipeline = data.pipelines?.find((p) => p.id === pipelineId) ?? null;

  if (!pipeline) {
    return NextResponse.json(
      {
        success: false,
        error: `Pipeline not found. No pipeline with id "${pipelineId}" in location.`,
        availablePipelines: (data.pipelines ?? []).map((p) => ({ id: p.id, name: p.name })),
      },
      { status: 404 }
    );
  }

  const stages = (pipeline.stages ?? []).map((s, i) => ({
    name: s.name,
    id: s.id,
    position: s.position ?? i,
  }));

  // Build envSuggestions
  const envSuggestions: Record<string, string | null> = {};
  for (const target of STAGE_TARGETS) {
    const match = stages.find((s) => normalizeName(s.name) === target.normalized);
    envSuggestions[target.envKey] = match?.id ?? null;
  }

  // Also check via the lookup map for alternate spellings
  for (const s of stages) {
    const key = STAGE_ENV_MAP[normalizeName(s.name)];
    if (key && !(key in envSuggestions)) {
      envSuggestions[key] = s.id;
    }
  }

  return NextResponse.json({
    success: true,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    stages,
    envSuggestions,
  });
}
