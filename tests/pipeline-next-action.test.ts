import test from "node:test";
import assert from "node:assert/strict";
import { getCustomerNextAction } from "@/lib/pipeline/next-action";
import type { PipelineCustomer } from "@/lib/pipeline/types";

function createCustomer(overrides: Partial<PipelineCustomer> = {}): PipelineCustomer {
  return {
    id: "opportunity-1",
    name: "Test Customer",
    stage: "demo",
    fittingType: "Driver Fitting",
    status: "Demo submitted",
    demo: {
      id: 1,
      type: "Driver Fitting",
      date: "Sep 16, 2026",
      status: "finalized",
      needsRefinalization: false,
      viewUrl: "/staff/imports/batch-1/map",
    },
    swingLocker: {
      id: 1,
      inviteStatus: "sent",
      sentAt: "Sep 16, 2026",
    },
    ...overrides,
  };
}

test("actionable purchase request takes priority and uses its detail route", () => {
  const action = getCustomerNextAction(
    createCustomer({
      stage: "considering",
      purchaseRequest: {
        id: 44,
        status: "new_request",
        createdAt: "2026-09-16T12:00:00.000Z",
        viewUrl: "/staff/purchase-requests/44",
      },
    })
  );

  assert.deepEqual(action, {
    id: "review-purchase-interest",
    label: "Review Purchase Interest",
    requiresAttention: true,
    href: "/staff/purchase-requests/44",
  });
});

test("non-finalized or dirty demos require review", () => {
  for (const demo of [
    { status: "reviewing", needsRefinalization: false },
    { status: "finalized", needsRefinalization: true },
  ]) {
    const action = getCustomerNextAction(createCustomer({ demo: { ...createCustomer().demo!, ...demo } }));

    assert.equal(action.id, "review-demo");
    assert.equal(action.label, "Review Demo");
    assert.equal(action.requiresAttention, true);
    assert.equal(action.href, "/staff/imports/batch-1/map");
  }
});

test("finalized demo without a completed locker send requires sending", () => {
  const action = getCustomerNextAction(
    createCustomer({
      swingLocker: { id: 1, inviteStatus: "pending" },
    })
  );

  assert.deepEqual(action, {
    id: "send-swing-locker",
    label: "Send Swing Locker",
    requiresAttention: true,
  });
});

test("locker-sent stage awaits customer engagement", () => {
  const action = getCustomerNextAction(createCustomer({ stage: "locker-sent" }));

  assert.deepEqual(action, {
    id: "await-customer-engagement",
    label: "Await Customer Engagement",
    requiresAttention: false,
  });
});

test("engaged stage continues the conversation", () => {
  const action = getCustomerNextAction(createCustomer({ stage: "engaged" }));

  assert.deepEqual(action, {
    id: "continue-conversation",
    label: "Continue Conversation",
    requiresAttention: true,
  });
});

test("considering stage follows up on purchase", () => {
  const action = getCustomerNextAction(createCustomer({ stage: "considering" }));

  assert.deepEqual(action, {
    id: "purchase-follow-up",
    label: "Purchase Follow-Up",
    requiresAttention: true,
  });
});

test("locked purchase requests do not take priority", () => {
  const action = getCustomerNextAction(
    createCustomer({
      stage: "considering",
      purchaseRequest: {
        id: 44,
        status: "purchased",
        createdAt: "2026-09-16T12:00:00.000Z",
        viewUrl: "/staff/purchase-requests/44",
      },
    })
  );

  assert.equal(action.id, "purchase-follow-up");
  assert.equal(action.requiresAttention, true);
});

test("unsupported demo-stage state falls back to no action", () => {
  const action = getCustomerNextAction(
    createCustomer({
      demo: {
        id: 1,
        type: "Driver Fitting",
        date: "Sep 16, 2026",
        status: "finalized",
        needsRefinalization: false,
      },
      swingLocker: {
        id: 1,
        inviteStatus: "sent",
        sentAt: "Sep 16, 2026",
      },
    })
  );

  assert.deepEqual(action, {
    id: "no-action-required",
    label: "No Action Required",
    requiresAttention: false,
  });
});