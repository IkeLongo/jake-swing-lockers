const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// ── Typed error for GHL duplicate-contact responses ───────────────────────────

export class GhlDuplicateContactError extends Error {
  readonly contactId: string;
  readonly matchingField: string | undefined;

  constructor(contactId: string, matchingField?: string) {
    super(
      `GHL duplicate contact: existing contactId=${contactId}` +
        (matchingField ? ` (matched on ${matchingField})` : "")
    );
    this.name = "GhlDuplicateContactError";
    this.contactId = contactId;
    this.matchingField = matchingField;
  }
}

function getToken(): string {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token) {
    throw new Error("Missing GHL_PRIVATE_INTEGRATION_TOKEN environment variable.");
  }
  return token;
}

export async function ghlFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const url = `${GHL_BASE}${path}`;

  const res = await fetch(url, {
    method: "GET",
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Version": GHL_VERSION,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    // Try to parse as JSON to detect structured GHL errors
    let parsed: Record<string, unknown> | null = null;
    let rawBody = "";
    try {
      rawBody = await res.text();
      parsed = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      // ignore parse failures
    }

    // Detect duplicate contact error
    if (
      res.status === 400 &&
      typeof parsed?.message === "string" &&
      parsed.message.includes("does not allow duplicated contacts") &&
      typeof (parsed?.meta as Record<string, unknown> | undefined)?.contactId === "string"
    ) {
      const meta = parsed.meta as Record<string, unknown>;
      throw new GhlDuplicateContactError(
        meta.contactId as string,
        typeof meta.matchingField === "string" ? meta.matchingField : undefined
      );
    }

    throw new Error(
      `GHL API error: ${res.status} ${res.statusText} — ${rawBody}`
    );
  }

  return res.json() as Promise<T>;
}

/** Normalize a display name for fuzzy matching against env key candidates. */
export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
