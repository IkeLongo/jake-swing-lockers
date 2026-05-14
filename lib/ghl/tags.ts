import { ghlFetch } from "./client";

// ── Role / identity tags — Swing Locker (official CRM) ───────────────────────
// App DB role is the source of truth for permissions.
// These tags mirror roles in GHL for communication segmentation only.
export const TAG_SL_CLIENT =
  process.env.GHL_TAG_SWING_LOCKER_CLIENT ?? "golf-demo:client";
export const TAG_SL_STAFF =
  process.env.GHL_TAG_SWING_LOCKER_STAFF ?? "golf-demo:staff";
export const TAG_SL_SALES_REP =
  process.env.GHL_TAG_SWING_LOCKER_SALES_REP ?? "golf-demo:sales-rep";
export const TAG_SL_ADMIN =
  process.env.GHL_TAG_SWING_LOCKER_ADMIN ?? "golf-demo:admin";
export const TAG_SL_SUPPORT =
  process.env.GHL_TAG_SWING_LOCKER_SUPPORT ?? "golf-demo:support";

// ── Temporary mirror tags — RiverCity (SMS transport only) ───────────────────
// GHL_TAG_RIVERCITY_TEMP_SMS is already referenced by existing delivery helpers.
// Re-exported here for central access. Do NOT rename the env var.
export const TAG_RC_TEMP_SMS =
  process.env.GHL_TAG_RIVERCITY_TEMP_SMS ?? "golf-demo:temp-sms-contact";
export const TAG_RC_TEMP_CLIENT =
  process.env.GHL_TAG_RIVERCITY_TEMP_CLIENT ?? "golf-demo:temp-client";
export const TAG_RC_TEMP_STAFF =
  process.env.GHL_TAG_RIVERCITY_TEMP_STAFF ?? "golf-demo:temp-staff";
export const TAG_RC_TEMP_SALES_REP =
  process.env.GHL_TAG_RIVERCITY_TEMP_SALES_REP ?? "golf-demo:temp-sales-rep";
export const TAG_RC_TEMP_ADMIN =
  process.env.GHL_TAG_RIVERCITY_TEMP_ADMIN ?? "golf-demo:temp-admin";
export const TAG_RC_TEMP_SUPPORT =
  process.env.GHL_TAG_RIVERCITY_TEMP_SUPPORT ?? "golf-demo:temp-support";

// ─────────────────────────────────────────────────────────────────────────────

interface TagsUpdateResponse {
  [key: string]: unknown;
}

/**
 * Add one or more tags to a GHL contact.
 */
export async function addTagsToContact(
  ghlContactId: string,
  tags: string[]
): Promise<void> {
  await ghlFetch<TagsUpdateResponse>(`/contacts/${ghlContactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

/**
 * Remove one or more tags from a GHL contact.
 */
export async function removeTagsFromContact(
  ghlContactId: string,
  tags: string[]
): Promise<void> {
  await ghlFetch<TagsUpdateResponse>(`/contacts/${ghlContactId}/tags`, {
    method: "DELETE",
    body: JSON.stringify({ tags }),
  });
}
