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

## Customer contact synchronization

For local opportunity and customer-link testing, set `GHL_OPPORTUNITY_READ_ONLY=true`. Both GHL
clients then allow only opportunity search/detail and contact lookup/detail GET requests, reject
redirects, and block all CRM writes and message delivery. This guard applies to
requests made through these clients; it does not restrict the API token itself.
Keep customer synchronization and SMS disabled while using this mode.

The customer worker is disabled unless `GHL_CUSTOMER_CONTACT_SYNC_ENABLED=true`.
Before enabling it, validate the GHL configuration and existing sync safeguards;
the flag also affects legacy contact-writing workflows. Customer creation and
profile changes enqueue work in the same transaction, then await one immediate
processor attempt after commit. Staged finalization does the same after saving the
fitting. A sync failure does not roll back the customer or fitting; the response
reports pending or review status. GHL requests in this processor have a five-second
timeout each. An interrupted or uncertain contact creation requires reconciliation,
not an automatic repost.

Vercel Hobby runs `/api/cron/customer-contact-sync` once daily at 09:00 UTC
(Hobby execution can be delayed by up to 59 minutes). Configure a random
`CRON_SECRET` of at least 16 characters as a Vercel environment variable and
redeploy; Vercel supplies it as a Bearer token. The protected job attempts at
most two customers and one finalized fitting per invocation, scanning at most
ten fitting candidates. It alternates which category runs first each day and
stops starting work after 22 seconds (customer attempts stop starting after at
most seven seconds). Blocked candidates rotate behind older work; fitting
rotation updates the session's `updatedAt` without changing fitting data or
claims. Large backlogs can take multiple days. Monitor Vercel logs and sync
state for review, reconciliation, or accumulated backlog. Cron is a recovery
path, not a guarantee of immediate delivery. Vercel function usage remains
subject to Hobby limits.

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

For a batch, the only accepted option is `limit`, an integer from 1 to 10 (default 5).
The response contains counts only. `processed` counts processor calls, not
necessarily newly acquired claims; `succeeded` includes contacts already
verified as synced by a concurrent invocation. `skipped` counts unavailable
claims or a processor disabled mid-run, and `needsReconciliation` requires
manual review rather than automatic reposting. An unexpected error or interrupted
request may leave a claim for the existing lease/reconciliation safeguards to
handle. Keep batches small enough for the deployment's request timeout.

For an individual existing customer, explicitly enable
`GHL_CUSTOMER_LINK_ONLY_ENABLED=true` and, as an active administrator, send
the same endpoint `{ "mode": "link-only", "golfClientId": 1 }` (substitute
the intended local customer ID). This separate flag does not enable the normal
customer worker. The operation reads GHL contacts but never creates or updates
them. It verifies an existing saved ID or links an unambiguous email/US-phone
match; conflicts, incomplete lookups and failures require review. A linked
contact is marked synced only when the full remote profile is present and
matches. Differing or incomplete profiles remain in review; interrupted claims
and unresolved writes require reconciliation. Existing review states are not
automatically cleared. For local testing, keep the read-only guard enabled; the
guard does not itself make the GHL token read-only.

## Staged fitting contact synchronization

Staff select a local customer, not a GHL contact. A saved customer contact is
verified and reused; a newly finalized customer is queued for contact sync. Existing
opportunities can only be selected once the customer has a saved GHL contact.
Otherwise staff can choose a new opportunity and finalize the fitting locally.
CRM sync remains pending without creating a contact or opportunity until the
customer contact exists. Once customer sync succeeds, staff can retry CRM sync
on the Confirm page; the daily recovery cron also resumes eligible fittings
automatically. Recovery requires the customer sync state to be current and
verified for the configured location. It rechecks the saved contact in GHL,
reuses the recorded opportunity decision, and uses the same fitting claim and
creation markers as staff sync. Action-required errors, unresolved claims and
uncertain writes remain blocked for staff review. Fittings with multiple
finalized import batches are skipped and logged for review rather than choosing
an opportunity decision arbitrarily. Existing customers without verified sync
state are not automatically recovered; staff can use the existing fitting sync
and customer reconciliation procedures. Matching an existing remote contact to
an unlinked customer requires review; it is never linked automatically.

### Opportunity values

Purchase-request creation, item edits and status changes queue a recalculation
for the linked opportunity. The value is the sum of stored item price snapshots
for `new_request`, `reviewing`, `quote_sent`, `purchased`, and `fulfilled`
requests across all linked sessions. Missing item prices count as zero; if no
qualifying requests exist, the GHL value is left unchanged. Other status values,
including legacy `cancelled`, are excluded. Fitting sync does not set the value.

Value updates use opportunity-scoped `purchase_request_opportunity_value`
`GhlSyncEvent` records. A queued event is committed with the request change;
only one pending event for an opportunity can issue a GHL update. Later changes
remain queued and are recalculated after that update. An interrupted or
uncertain update remains pending and blocks further writes: do not clear it or
retry blindly. Confirm the original process and request have stopped and the
remote request can no longer apply, inspect the event's opportunity ID and
attempted value and the GHL opportunity, and perform a case-specific
reconciliation before releasing the pending event.
Queued events have no automatic recovery worker; a process interruption or a
request created before its session has an opportunity can require staff review.
Stop older application workers during rollout so they cannot write tested-club
totals over purchase-request values.

### Fitting notes

Successful fitting sync creates one dated note per DemoSession on its GHL
opportunity. Configure the approved GHL user's ID in the server-only
`GHL_FITTING_NOTE_AUTHOR_USER_ID` environment variable and grant the private
integration `notes.write`. Configure `APP_BASE_URL` to the staff-accessible
application URL; when exactly one finalized import is associated with the
session, the note links to its authenticated staff import review page and shows
the upload date; ambiguous or missing imports are omitted. The note lists each
finalized test and its stored price, using numbered labels when no brand or
model is recorded. The existing GHL read-only guard also blocks note creation.
A missing author or a rejected note request leaves the fitting unsynced.

The existing per-session sync state records an attempt before the note POST and
the returned note ID afterward. A timeout, interrupted request, invalid
response, or failure to persist the ID requires reconciliation, not an
automatic repost. Successful IDs are retained for subsequent retries, including
when several sessions use the same opportunity. Previously synced fittings are
not automatically backfilled. Pending fitting recovery can create notes after
deployment, so check existing recovery candidates and GHL workflows before
enabling sync. Stop old-version workers before deployment.
The note is a snapshot; re-finalizing a session does not update an existing
note. The legacy fitting sync still updates its opportunity's stage and value as
before; use staged sync with an existing opportunity for a test that must avoid
those updates.

The finalization screen already attempts CRM sync after the immediate customer
attempt. Other customer requests do not start an additional fitting sync: doing
so could exceed their request budget. The cron starts GHL fitting requests with
five-second timeouts, but a slow database call or Vercel's hard function deadline
can still interrupt a run. An interrupted claim must be reconciled, not cleared
or retried blindly.

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
   `fittingClaim`, `contact`, `opportunity`, and `fittingNote`), `ghlOpportunityId`,
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
   fitting's operation succeeded. For a `fittingNote` attempt, inspect the
   opportunity's notes for the specific DemoSession and preserve the matching
   note ID and association as evidence.
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
   For a confirmed note, replace only the matching `fittingNote` attempt with
   `{ status: "created", opportunityId, noteId }` after verifying the note's
   session and opportunity. Do not clear an uncertain attempt.
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
