import { ghlFetch, GhlConfigurationError } from "./client";

const LOCATION_ID = () => {
  const id = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!id) throw new GhlConfigurationError("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
  return id;
};
const PIPELINE_ID = () => {
  const id = process.env.GHL_SWINGLOCKER_PIPELINE_ID;
  if (!id) throw new GhlConfigurationError("Missing GHL_SWINGLOCKER_PIPELINE_ID environment variable.");
  return id;
};
export const STAGE_DEMO_SUBMITTED = () => {
  const id = process.env.GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID;
  if (!id) throw new GhlConfigurationError("Missing GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID environment variable.");
  return id;
};
export const STAGE_SWING_LOCKER_SENT = () => {
  const id = process.env.GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_STAGE_SWING_LOCKER_SENT_ID environment variable.");
  return id;
};
export const STAGE_LOCKER_OPENED = () => {
  const id = process.env.GHL_SWINGLOCKER_STAGE_LOCKER_OPENED_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_STAGE_LOCKER_OPENED_ID environment variable.");
  return id;
};
export const STAGE_CONSIDERING_PURCHASE = () => {
  const id = process.env.GHL_SWINGLOCKER_STAGE_CONSIDERING_PURCHASE_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_STAGE_CONSIDERING_PURCHASE_ID environment variable.");
  return id;
};
export const STAGE_PURCHASED = () => {
  const id = process.env.GHL_SWINGLOCKER_STAGE_PURCHASED_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_STAGE_PURCHASED_ID environment variable.");
  return id;
};
export const STAGE_CLOSED_NO_PURCHASE = () => {
  const id = process.env.GHL_SWINGLOCKER_STAGE_CLOSED_NO_PURCHASE_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_STAGE_CLOSED_NO_PURCHASE_ID environment variable.");
  return id;
};

// ── GHL Opportunity shapes (minimal) ─────────────────────────────────────────

export interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
  locationId: string;
  status: string;
  [key: string]: unknown;
}

interface OpportunitiesListResponse {
  opportunities: GhlOpportunity[];
  total: number;
}

interface OpportunityCreateResponse {
  opportunity: GhlOpportunity;
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Find an open opportunity for a contact in the configured pipeline.
 * Returns the first matching opportunity or null.
 */
export async function findOpenOpportunityForContact(
  ghlContactId: string
): Promise<GhlOpportunity | null> {
  const params = new URLSearchParams({
    location_id: LOCATION_ID(),
    pipeline_id: PIPELINE_ID(),
    contact_id: ghlContactId,
    status: "open",
    limit: "1",
  });
  const res = await ghlFetch<OpportunitiesListResponse>(
    `/opportunities/search?${params.toString()}`
  );
  return res.opportunities?.[0] ?? null;
}

export async function listOpenOpportunitiesForContact(
  ghlContactId: string,
): Promise<GhlOpportunity[]> {
  const params = new URLSearchParams({
    location_id: LOCATION_ID(),
    pipeline_id: PIPELINE_ID(),
    contact_id: ghlContactId,
    status: "open",
    limit: "100",
  });
  const res = await ghlFetch<OpportunitiesListResponse>(
    `/opportunities/search?${params.toString()}`,
  );
  if (!Array.isArray(res.opportunities)) {
    throw new Error("GHL opportunity search returned an invalid response.");
  }
  const locationId = LOCATION_ID();
  const pipelineId = PIPELINE_ID();
  return res.opportunities.filter(
    (opportunity) =>
      opportunity.contactId === ghlContactId &&
      opportunity.locationId === locationId &&
      opportunity.pipelineId === pipelineId &&
      opportunity.status === "open",
  );
}

export type OpportunitySelectionValidation =
  | { valid: true; opportunity: GhlOpportunity }
  | { valid: false; reason: "not_found" | "not_relevant" };

export async function validateOpportunitySelection(
  opportunityId: string,
  ghlContactId: string,
  signal?: AbortSignal,
): Promise<OpportunitySelectionValidation> {
  const res = await ghlFetch<{ opportunity?: GhlOpportunity | null }>(
    `/opportunities/${encodeURIComponent(opportunityId)}`,
    { signal },
  ).catch((error: unknown) => {
    if (
      error instanceof Error &&
      /^GHL API error: 404\b/.test(error.message)
    ) {
      return null;
    }
    throw error;
  });
  const opportunity = res?.opportunity;
  if (!opportunity) return { valid: false, reason: "not_found" };

  if (
    opportunity.contactId !== ghlContactId ||
    opportunity.locationId !== LOCATION_ID() ||
    opportunity.pipelineId !== PIPELINE_ID() ||
    opportunity.status !== "open"
  ) {
    return { valid: false, reason: "not_relevant" };
  }

  return { valid: true, opportunity };
}

/**
 * Fetch a specific opportunity by ID.
 * Used to check current stage before deciding whether to move stages.
 */
export async function getOpportunityById(
  opportunityId: string
): Promise<GhlOpportunity | null> {
  try {
    const res = await ghlFetch<{ opportunity: GhlOpportunity }>(
      `/opportunities/${opportunityId}`
    );
    return res.opportunity ?? null;
  } catch {
    return null;
  }
}

// ── Create / Update ───────────────────────────────────────────────────────────

export interface OpportunityInput {
  name: string;
  contactId: string;
  monetaryValue?: number;
}

export async function createGolfDemoOpportunity(
  input: OpportunityInput,
  signal?: AbortSignal,
): Promise<string> {
  const res = await ghlFetch<OpportunityCreateResponse>("/opportunities/", {
    method: "POST",
    signal,
    body: JSON.stringify({
      pipelineId: PIPELINE_ID(),
      locationId: LOCATION_ID(),
      pipelineStageId: STAGE_DEMO_SUBMITTED(),
      contactId: input.contactId,
      name: input.name,
      status: "open",
      ...(input.monetaryValue !== undefined
        ? { monetaryValue: input.monetaryValue }
        : {}),
    }),
  });
  return res.opportunity.id;
}

export async function updateGolfDemoOpportunity(
  opportunityId: string,
  updates: Partial<OpportunityInput> & { pipelineStageId?: string }
): Promise<void> {
  await ghlFetch<unknown>(`/opportunities/${opportunityId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.pipelineStageId !== undefined
        ? { pipelineStageId: updates.pipelineStageId }
        : {}),
      ...(updates.monetaryValue !== undefined
        ? { monetaryValue: updates.monetaryValue }
        : {}),
    }),
  });
}

/**
 * Create or update an opportunity for a demo session.
 * If an explicit existingOpportunityId is provided (associated with this DemoSession),
 * update that opportunity; otherwise create a new opportunity for this distinct sales pursuit.
 */
export async function upsertGolfDemoOpportunity(
  input: OpportunityInput,
  existingOpportunityId?: string | null
): Promise<string> {
  if (existingOpportunityId) {
    await updateGolfDemoOpportunity(existingOpportunityId, {
      name: input.name,
      pipelineStageId: STAGE_DEMO_SUBMITTED(),
      monetaryValue: input.monetaryValue,
    });
    return existingOpportunityId;
  }

  // Commenting this section out.

  // const existing = await findOpenOpportunityForContact(input.contactId);
  // if (existing) {
  //   await updateGolfDemoOpportunity(existing.id, {
  //     name: input.name,
  //     pipelineStageId: STAGE_DEMO_SUBMITTED(),
  //     monetaryValue: input.monetaryValue,
  //   });
  //   return existing.id;
  // }

  return createGolfDemoOpportunity(input);
}
