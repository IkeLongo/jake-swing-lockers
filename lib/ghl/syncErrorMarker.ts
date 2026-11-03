// Durable retryable/non-retryable marker for staged CRM sync failures.
//
// DemoSession only persists a status and an error text, so a failure that
// needs human action (unresolved contact, closed opportunity) is stored with a
// fixed prefix. This lets a refreshed Confirm page stay non-retryable without a
// schema change. Plain messages are treated as retryable.

const ACTION_REQUIRED_PREFIX = "[action-required] ";

export function encodeSyncError(message: string, retryable: boolean): string {
  return retryable ? message : `${ACTION_REQUIRED_PREFIX}${message}`;
}

export function decodeSyncError(
  stored: string | null | undefined,
): { message: string | null; actionRequired: boolean } {
  if (!stored) return { message: null, actionRequired: false };
  if (stored.startsWith(ACTION_REQUIRED_PREFIX)) {
    return {
      message: stored.slice(ACTION_REQUIRED_PREFIX.length),
      actionRequired: true,
    };
  }
  return { message: stored, actionRequired: false };
}
