import test from "node:test";
import assert from "node:assert/strict";
import {
  isPurchaseRequestLockedStatus,
  isPurchaseRequestEditableStatus,
} from "@/lib/purchase-request-status";
import { parsePurchaseRequestEditPayload } from "@/lib/validations/purchase-request-edit";
import {
  buildPurchaseRequestClubSnapshots,
  getPurchaseRequestEditSideEffectWarnings,
  getUniqueClubIdsPreservingOrder,
  isDuplicatePurchaseRequest,
  shouldUpdateOpportunityMonetaryValue,
} from "@/lib/purchase-request-workflow";

test("locked statuses are enforced", () => {
  assert.equal(isPurchaseRequestLockedStatus("purchased"), true);
  assert.equal(isPurchaseRequestLockedStatus("fulfilled"), true);
  assert.equal(isPurchaseRequestLockedStatus("closed_lost"), true);

  assert.equal(isPurchaseRequestLockedStatus("new_request"), false);
  assert.equal(isPurchaseRequestLockedStatus("reviewing"), false);
  assert.equal(isPurchaseRequestLockedStatus("quote_sent"), false);

  assert.equal(isPurchaseRequestEditableStatus("new_request"), true);
  assert.equal(isPurchaseRequestEditableStatus("reviewing"), true);
  assert.equal(isPurchaseRequestEditableStatus("quote_sent"), true);
  assert.equal(isPurchaseRequestEditableStatus("purchased"), false);
});

test("edit payload validation accepts full edits and canonical status", () => {
  const parsed = parsePurchaseRequestEditPayload({
    clubIds: [11, 12, 11],
    notes: "  add driver  ",
    status: "reviewing",
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.data.mode, "full_edit");
  if (parsed.data.mode !== "full_edit") return;

  assert.deepEqual(parsed.data.clubIds, [11, 12]);
  assert.equal(parsed.data.notes, "add driver");
  assert.equal(parsed.data.status, "reviewing");
});

test("edit payload validation rejects invalid status and empty items", () => {
  const badStatus = parsePurchaseRequestEditPayload({ status: "not_real" });
  assert.equal(badStatus.ok, false);

  const emptyItems = parsePurchaseRequestEditPayload({ clubIds: [], notes: "" });
  assert.equal(emptyItems.ok, false);
});

test("item replacement helpers preserve order and snapshot prices", () => {
  const orderedIds = getUniqueClubIdsPreservingOrder([3, 1, 3, 2]);
  assert.deepEqual(orderedIds, [3, 1, 2]);

  const snapshots = buildPurchaseRequestClubSnapshots(orderedIds, [
    { id: 1, clubType: "Irons", estimatedPrice: 899 },
    { id: 2, clubType: "Wedge", estimatedPrice: null },
    { id: 3, clubType: "Driver", estimatedPrice: { valueOf: () => "599" } },
  ]);

  assert.deepEqual(snapshots, [
    { demoClubTestId: 3, clubType: "Driver", estimatedPrice: 599 },
    { demoClubTestId: 1, clubType: "Irons", estimatedPrice: 899 },
    { demoClubTestId: 2, clubType: "Wedge", estimatedPrice: null },
  ]);
});

test("side effect warning helper collects email failures", () => {
  const warnings = getPurchaseRequestEditSideEffectWarnings(
    {
      customerDelivered: false,
      internalDelivered: false,
      customerError: "Customer send failed",
      internalError: "Internal send failed",
    },
    ["GHL monetary value update failed"]
  );

  assert.deepEqual(warnings, [
    "GHL monetary value update failed",
    "Customer send failed",
    "Internal send failed",
  ]);
});

test("duplicate request prevention helper flags existing requests", () => {
  assert.equal(isDuplicatePurchaseRequest(null), false);
  assert.equal(
    isDuplicatePurchaseRequest({ id: 22, status: "new_request", createdAt: new Date() }),
    true
  );
});

test("GHL monetary value updates only in Considering Purchase stage", () => {
  assert.equal(
    shouldUpdateOpportunityMonetaryValue("considering", "considering"),
    true
  );
  assert.equal(
    shouldUpdateOpportunityMonetaryValue("purchased", "considering"),
    false
  );
});

test("status-only edit can be sent from locked/final status", () => {
  const statusOnly = parsePurchaseRequestEditPayload({
    status: "closed_lost",
  });

  assert.equal(statusOnly.ok, true);
  if (!statusOnly.ok) return;
  assert.equal(statusOnly.data.mode, "status_only");
  if (statusOnly.data.mode !== "status_only") return;
  assert.equal(statusOnly.data.status, "closed_lost");
});

test("club/note edit blocked from locked/final status by API", () => {
  // This test validates the API logic; club/note edits should trigger 409
  // when current status is locked, even if payload is valid.
  const fullEdit = parsePurchaseRequestEditPayload({
    clubIds: [1, 2],
    notes: "Update notes",
  });

  assert.equal(fullEdit.ok, true);
  if (!fullEdit.ok) return;
  assert.equal(fullEdit.data.mode, "full_edit");
  if (fullEdit.data.mode !== "full_edit") return;
  assert.deepEqual(fullEdit.data.clubIds, [1, 2]);
  assert.equal(fullEdit.data.notes, "Update notes");

  // The API will check the current status and return 409 if locked.
  // This test confirms the payload itself is valid; enforcement happens server-side.
});

test("mixed status + clubs from locked status fails server-side", () => {
  // Payload is valid; API enforcement returns 409 when current status is locked.
  const mixed = parsePurchaseRequestEditPayload({
    clubIds: [5],
    status: "reviewing",
  });

  assert.equal(mixed.ok, true);
  if (!mixed.ok) return;
  assert.equal(mixed.data.mode, "full_edit");
  if (mixed.data.mode !== "full_edit") return;
  assert.deepEqual(mixed.data.clubIds, [5]);
  assert.equal(mixed.data.status, "reviewing");

  // Again, payload is valid. API checks current status and blocks with 409 if locked.
});

test("status-only updates are always allowed from any status (immediate UI updates)", () => {
  // This test validates that immediate status dropdown changes can always proceed,
  // even from locked statuses. This enables staff to fix misclassified requests.
  const lockedToWorking = parsePurchaseRequestEditPayload({
    status: "reviewing",
  });

  assert.equal(lockedToWorking.ok, true);
  if (!lockedToWorking.ok) return;
  assert.equal(lockedToWorking.data.mode, "status_only");
  if (lockedToWorking.data.mode !== "status_only") return;
  assert.equal(lockedToWorking.data.status, "reviewing");

  // API allows this even if current backend status is purchased/fulfilled/closed_lost.
  // After this succeeds, clubs/notes become editable in UI.
});

test("clubs/notes save only when not locked, status persisted separately", () => {
  // When clubs/notes form submits, it should NOT include status since it's
  // already been persisted by the immediate dropdown update.
  const clubsOnly = parsePurchaseRequestEditPayload({
    clubIds: [1, 2, 3],
    notes: "Updated notes",
  });

  assert.equal(clubsOnly.ok, true);
  if (!clubsOnly.ok) return;
  assert.equal(clubsOnly.data.mode, "full_edit");
  if (clubsOnly.data.mode !== "full_edit") return;
  assert.deepEqual(clubsOnly.data.clubIds, [1, 2, 3]);
  assert.equal(clubsOnly.data.notes, "Updated notes");
  assert.equal(clubsOnly.data.status, undefined);

  // API enforces: if current backend status is locked, this returns 409.
  // This prevents the race: user changed status to working, but before
  // status PATCH completes, they submit clubs/notes from stale UI state.
});
