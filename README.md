This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Manual customer contact synchronization

The contact-only batch endpoint is disabled unless
`GHL_CUSTOMER_CONTACT_SYNC_ENABLED=true`. Do not enable it until the existing
customer contact sync safeguards and GHL configuration have been validated;
the flag also affects existing contact-writing workflows. There is no scheduler.

When this flag is disabled, legacy GolfClient sync and legacy demo sync update
only an already-linked GHL contact; they no longer create one. An unlinked
customer remains pending until customer contact sync is enabled and processed.
This can also delay customer
emails or Swing Locker delivery that depend on a saved contact. A legacy
customer update is blocked while any of that customer's fitting claims or
creation markers needs reconciliation.
Fitting claims now serialize syncs for the same customer, including a legacy
customer update. Stop old-version sync requests before deployment: an
already-running older process does not honor these safeguards.
Customer workers and fitting claims coordinate under the customer lock. Active
or interrupted fitting claims block independent customer sync; an active or
unreconciled customer worker blocks fitting sync. Reconcile interrupted work
before resuming either operation.

An active staff administrator can invoke one batch from a same-origin browser
session by sending a JSON POST to `/api/staff/admin/customer-contact-sync`, for
example:

```js
fetch("/api/staff/admin/customer-contact-sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ limit: 5 }),
}).then((response) => response.json()).then(console.log);
```

The only accepted option is `limit`, an integer from 1 to 10 (default 5).
The response contains counts only. `processed` counts processor calls, not
necessarily newly acquired claims; `succeeded` includes contacts already
verified as synced by a concurrent invocation. `skipped` counts unavailable
claims or a processor disabled mid-run, and `needsReconciliation` requires
manual review rather than automatic reposting. An unexpected error or interrupted
request may leave a claim for the existing lease/reconciliation safeguards to
handle. Keep batches small enough for the deployment's request timeout.

## Staged fitting contact synchronization

Staff select a local customer, not a GHL contact. A saved customer contact is
verified and reused; a newly finalized customer is queued for contact sync. Existing
opportunities can only be selected once the customer has a saved GHL contact.
Otherwise staff can choose a new opportunity and finalize the fitting locally.
CRM sync remains pending without creating a contact or opportunity until the
customer contact exists. Once customer sync succeeds, staff can retry CRM sync
on the Confirm page. There is currently no scheduler or automatic fitting retry.
Matching an existing remote contact to an unlinked customer requires review;
it is never linked automatically.

Previous fitting contact approvals no longer select the contact for normal sync.
Unresolved claims, creation attempts, or conflicting resolved contact markers
still require reconciliation; do not clear them just because an approval is old.

### Reconciling an interrupted fitting sync

Fitting sync and recovery use a shared, non-expiring claim. An active request
and an interrupted request look alike; never clear a claim merely because it
is old. There is no staff-facing claim-clear action or existing maintenance
utility. A privileged operator and developer must prepare and review a
case-specific, transactionally guarded maintenance operation; do not expose an
unrestricted endpoint.

1. Find the import batch ID in the staff fitting page URL and obtain its
   `demoSessionId` with approved read-only database access. Stop further retries,
   confirm the original request and any related
   customer sync have stopped, and record the time and operator.
2. Read the session's `ghlSyncStatus`, `ghlSyncError`, `ghlSyncState` (including
   `fittingClaim`, `contact`, and `opportunity`), `ghlOpportunityId`,
   `ghlLockerReadyTagAddedAt`, and `GhlSyncEvent` entries. Also inspect the
   customer's `ghlContactId`, `ghlContactCreationState`, and
   `GolfClientSyncState` creation-attempt fields. Record the claim token,
   attempt identifiers and timestamps, and fitting's approved contact and
   opportunity decision. Treat malformed or conflicting state as unresolved.
3. In the configured GHL location, inspect the saved or approved contact and
   search for the attempted contact using its identifiers. Check the fitting's
   selected or attempted opportunity in the correct pipeline, including its
   contact, name, and time. Inspect the contact's custom fields and the
   `golf-demo:locker-ready` and `golf-demo:followup-active` tags and any workflow
   activity they triggered. A shared opportunity or tag is not proof that this
   fitting's operation succeeded.
4. Classify each operation as **confirmed success**, **confirmed rejection/no
   mutation**, or **uncertain**, using GHL records and request/event evidence.
   A search with no result alone does not prove a timed-out POST failed. Do not
   repeat a POST or workflow-triggering tag while its outcome is uncertain.
5. For confirmed success, verify identity, ownership, location, and the exact
   remote IDs before a reviewed maintenance operation records them in the
   customer's `ghlContactId` or the session's `ghlOpportunityId`, as appropriate.
   Preserve the original customer, fitting, opportunity decision, club data,
   other sync-state fields and unrelated markers. Record a confirmed tag
   application in the existing tag marker only after its effects are reconciled.
   For confirmed rejection, clear only the corresponding owned creation marker
   using a reviewed, transactionally locked maintenance operation. Do not clear
   customer-coordinator attempt fields without also reconciling their matching
   session and customer state.
6. Only when every possible remote effect and creation marker is resolved,
   use the same guarded maintenance process to clear the **specific recorded
   claim token**, after rechecking the locked rows, stopped request and unchanged
   state. Preserve any resolved contact marker and all unrelated fields. Record
   the evidence and changes in the operational audit. Then refresh the Confirm
   page and use the existing CRM sync action; it must reuse the verified IDs and
   completed tag marker rather than repeat a creation or tag operation.
7. If the outcome, ownership, workflow effects, or safe local transition cannot
   be established, leave the claim and markers in place and escalate to a GHL
   administrator/developer. Do not guess, clear them, or retry.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
