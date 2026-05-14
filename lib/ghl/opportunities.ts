import { ghlFetch } from "./client";

const LOCATION_ID = () => {
  const id = process.env.GHL_SWINGLOCKER_LOCATION_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
  return id;
};
const PIPELINE_ID = () => {
  const id = process.env.GHL_SWINGLOCKER_PIPELINE_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_PIPELINE_ID environment variable.");
  return id;
};
const STAGE_DEMO_SUBMITTED = () => {
  const id = process.env.GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID;
  if (!id) throw new Error("Missing GHL_SWINGLOCKER_STAGE_DEMO_SUBMITTED_ID environment variable.");
  return id;
};

// ── GHL Opportunity shapes (minimal) ─────────────────────────────────────────

interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
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

// ── Create / Update ───────────────────────────────────────────────────────────

export interface OpportunityInput {
  name: string;
  contactId: string;
  monetaryValue?: number;
}

export async function createGolfDemoOpportunity(
  input: OpportunityInput
): Promise<string> {
  const res = await ghlFetch<OpportunityCreateResponse>("/opportunities/", {
    method: "POST",
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
 * Create or update an opportunity for a contact.
 * If the contact already has an open opportunity in the pipeline, update it;
 * otherwise create a new one.
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

  const existing = await findOpenOpportunityForContact(input.contactId);
  if (existing) {
    await updateGolfDemoOpportunity(existing.id, {
      name: input.name,
      pipelineStageId: STAGE_DEMO_SUBMITTED(),
      monetaryValue: input.monetaryValue,
    });
    return existing.id;
  }

  return createGolfDemoOpportunity(input);
}
