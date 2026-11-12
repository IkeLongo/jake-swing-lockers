// Client-side finalize → CRM-sync sequencing, kept free of React so it can be
// tested with an injected fetch. Local finalization is authoritative: once it
// succeeds the fitting is saved, whatever happens to the CRM sync.

export type FetchLike = (
  input: string,
  init: { method: "POST" },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type ConfirmPhase =
  | { kind: "finalize_failed"; error: string; retryable: boolean }
  | { kind: "synced" }
  | { kind: "crm_pending"; error: string | null }
  | { kind: "crm_action_required"; error: string };

interface ApiBody {
  success?: boolean;
  status?: string;
  retryable?: boolean;
  error?: string;
}

async function post(
  fetchFn: FetchLike,
  url: string,
): Promise<{ ok: boolean; status: number; body: ApiBody } | null> {
  try {
    const res = await fetchFn(url, { method: "POST" });
    let body: ApiBody = {};
    try {
      body = ((await res.json()) ?? {}) as ApiBody;
    } catch {
      // Non-JSON error bodies fall through to generic messages.
    }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return null;
  }
}

export async function runCrmSync(
  fetchFn: FetchLike,
  batchId: number,
): Promise<ConfirmPhase> {
  const res = await post(fetchFn, `/api/staff/imports/${batchId}/crm-sync`);
  if (!res) {
    return {
      kind: "crm_action_required",
      error: "The CRM sync outcome could not be confirmed. Refresh the fitting and seek staff review before retrying.",
    };
  }
  if (res.ok && res.body.success) return { kind: "synced" };

  const error = res.body.error ?? "The CRM sync could not be completed.";
  if (res.body.retryable === false) {
    return { kind: "crm_action_required", error };
  }
  return { kind: "crm_pending", error };
}

export async function finalizeAndSync(
  fetchFn: FetchLike,
  batchId: number,
): Promise<ConfirmPhase> {
  const res = await post(fetchFn, `/api/staff/imports/${batchId}/finalize`);
  if (!res) {
    return {
      kind: "finalize_failed",
      error: "Could not reach the server. Nothing was changed; please try again.",
      retryable: true,
    };
  }
  if (!res.ok || !res.body.success) {
    return {
      kind: "finalize_failed",
      error: res.body.error ?? "The fitting could not be finalized.",
      retryable: res.body.retryable === true,
    };
  }
  // Only reached after local finalization succeeded.
  return runCrmSync(fetchFn, batchId);
}
