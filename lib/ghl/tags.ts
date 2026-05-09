import { ghlFetch } from "./client";

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
