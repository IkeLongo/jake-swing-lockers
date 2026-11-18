import { GhlConfigurationError, ghlFetch } from "./client";

export function validateFittingNoteConfiguration(): { locationId: string; userId: string } {
  const locationId = process.env.GHL_SWINGLOCKER_LOCATION_ID?.trim();
  const userId = process.env.GHL_FITTING_NOTE_AUTHOR_USER_ID?.trim();
  if (!locationId) throw new GhlConfigurationError("Missing GHL_SWINGLOCKER_LOCATION_ID environment variable.");
  if (!userId) throw new GhlConfigurationError("Missing GHL_FITTING_NOTE_AUTHOR_USER_ID environment variable.");
  return { locationId, userId };
}

export async function createFittingNote(
  opportunityId: string,
  body: string,
  signal?: AbortSignal,
): Promise<string> {
  const { locationId, userId } = validateFittingNoteConfiguration();

  const response = await ghlFetch<{ note?: { id?: unknown } }>(
    `/notes/?${new URLSearchParams({ locationId })}`,
    {
      method: "POST",
      headers: { Version: "v3" },
      body: JSON.stringify({
        body,
        relations: [{ objectKey: "opportunity", recordId: opportunityId }],
        userId,
      }),
      signal,
    },
  );
  if (typeof response.note?.id !== "string" || !response.note.id.trim()) {
    throw new Error("GHL note creation returned no note ID; reconciliation is required.");
  }
  return response.note.id;
}
