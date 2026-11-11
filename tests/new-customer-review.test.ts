import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "../app/generated/prisma/client";
import {
  classifyReview,
  findDuplicateCandidates,
  isReviewBlocking,
  type ClientIdentity,
} from "@/lib/imports/new-customer-review";
import {
  buildNewCustomerReview,
  computeReviewSignature,
  decideNewCustomerSave,
} from "@/lib/imports/new-customer-review-server";
import { updateGolfClientIfUnique } from "@/lib/imports/new-customer-review-store";

const client = (
  id: number,
  email: string | null,
  phone: string | null,
): ClientIdentity => ({ id, firstName: "A", lastName: "B", email, phone });

const proposed = { email: "ann@example.com", phone: "+12105550100" };

test("no match yields no review", () => {
  const candidates = findDuplicateCandidates([client(1, "x@y.co", "+12105559999")], proposed);
  assert.equal(candidates.length, 0);
  assert.equal(classifyReview(candidates), "none");
});

test("email match is case/whitespace insensitive and exact_email", () => {
  const candidates = findDuplicateCandidates([client(1, " ANN@Example.com ", null)], proposed);
  assert.equal(candidates[0]?.matchedOn, "email");
  assert.equal(classifyReview(candidates), "exact_email");
});

test("legacy phone formats match as possible_phone", () => {
  for (const legacy of ["(210) 555-0100", "210.555.0100", "1-210-555-0100", "+1 210 555 0100"]) {
    const candidates = findDuplicateCandidates([client(1, null, legacy)], proposed);
    assert.equal(candidates[0]?.matchedOn, "phone", legacy);
    assert.equal(classifyReview(candidates), "possible_phone");
  }
});

test("short or empty stored phones never match", () => {
  assert.equal(findDuplicateCandidates([client(1, null, "555-0100")], { email: null, phone: "555-0100" }).length, 0);
});

test("email and phone on different clients is conflicting", () => {
  const candidates = findDuplicateCandidates(
    [client(1, "ann@example.com", null), client(2, null, "210-555-0100")],
    proposed,
  );
  assert.equal(candidates.length, 2);
  assert.equal(classifyReview(candidates), "conflicting");
});

test("same client matching both is a single email_and_phone candidate", () => {
  const candidates = findDuplicateCandidates(
    [client(1, "ann@example.com", "2105550100")],
    proposed,
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.matchedOn, "email_and_phone");
});

test("signature is stable, order independent, and sensitive to inputs", () => {
  const a = findDuplicateCandidates([client(1, "ann@example.com", null), client(2, null, "2105550100")], proposed);
  const sig = computeReviewSignature(proposed, a);
  assert.equal(sig, computeReviewSignature(proposed, [...a].reverse()));
  assert.notEqual(sig, computeReviewSignature({ ...proposed, email: "other@example.com" }, a));
  assert.notEqual(sig, computeReviewSignature(proposed, a.slice(0, 1)));
});

test("isReviewBlocking", () => {
  assert.equal(isReviewBlocking(null), false);
  assert.equal(isReviewBlocking({ kind: "none", confirmed: false }), false);
  assert.equal(isReviewBlocking({ kind: "exact_email", confirmed: false }), true);
  assert.equal(isReviewBlocking({ kind: "exact_email", confirmed: true }), false);
});

const clients = [client(1, null, "210-555-0100")];
const currentSig = buildNewCustomerReview(clients, proposed, null).signature;

test("duplicate without signature requires review and persists nothing", () => {
  const d = decideNewCustomerSave({
    clients,
    proposed,
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: null,
  });
  assert.equal(d.outcome, "review_required");
});

test("matching submitted signature cannot override a duplicate identifier", () => {
  const d = decideNewCustomerSave({
    clients,
    proposed,
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: currentSig,
  });
  assert.equal(d.outcome, "review_required");
});

test("stale signature (candidate set changed) is review_changed", () => {
  const d = decideNewCustomerSave({
    clients: [...clients, client(2, "ann@example.com", null)],
    proposed,
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: currentSig,
  });
  assert.equal(d.outcome, "review_changed");
});

test("signature from a different proposed identity is rejected", () => {
  const d = decideNewCustomerSave({
    clients,
    proposed: { email: "new@example.com", phone: "+12105550100" },
    identityUnchanged: false,
    storedSignature: null,
    submittedSignature: currentSig,
  });
  assert.equal(d.outcome, "review_changed");
});

test("stored confirmation cannot override a duplicate identifier", () => {
  const base = { clients, proposed, storedSignature: currentSig, submittedSignature: null };
  const kept = decideNewCustomerSave({ ...base, identityUnchanged: true });
  assert.equal(kept.outcome, "review_required");

  const changed = decideNewCustomerSave({ ...base, identityUnchanged: false });
  assert.equal(changed.outcome, "review_required");

  const stale = decideNewCustomerSave({
    ...base,
    clients: [...clients, client(3, null, "+12105550100")],
    identityUnchanged: true,
  });
  assert.equal(stale.outcome, "review_required");
});

test("no candidates clears any confirmation", () => {
  const d = decideNewCustomerSave({
    clients: [],
    proposed,
    identityUnchanged: true,
    storedSignature: currentSig,
    submittedSignature: null,
  });
  assert.equal(d.outcome === "save" && d.confirmation.action, "clear");
});

test("persisted review survives refresh (recomputed confirmed flag)", () => {
  assert.equal(buildNewCustomerReview(clients, proposed, currentSig).confirmed, false);
  assert.equal(buildNewCustomerReview(clients, proposed, "b".repeat(64)).confirmed, false);
  assert.equal(
    buildNewCustomerReview([...clients, client(9, "ann@example.com", null)], proposed, currentSig).confirmed,
    false,
  );
});

function fakeGolfClientDb(
  rows: ClientIdentity[],
  current: ClientIdentity & { ghlContactId: string | null },
) {
  const syncStates = new Map<number, { desiredVersion: number; workStatus: string }>();
  const tx = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      if (strings.join(" ").includes("FROM GolfClient WHERE id")) {
        const requestedId = Number(values[0]);
        return requestedId === current.id ? [{ id: current.id }] : [];
      }
      return [];
    },
    golfClient: {
      async findUnique() {
        return { ...current };
      },
      async findMany() {
        return rows;
      },
      async update(args: { data: Partial<ClientIdentity> }) {
        Object.assign(current, args.data);
        return { ...current };
      },
    },
    golfClientSyncState: {
      async findUnique(args: { where: { golfClientId: number } }) {
        return syncStates.get(args.where.golfClientId) ?? null;
      },
      async create(args: { data: Record<string, unknown> }) {
        const state = {
          desiredVersion: args.data.desiredVersion as number,
          workStatus: args.data.workStatus as string,
        };
        syncStates.set(args.data.golfClientId as number, state);
        return state;
      },
      async update(args: {
        where: { golfClientId: number };
        data: { desiredVersion: { increment: number }; workStatus?: string };
      }) {
        const state = syncStates.get(args.where.golfClientId);
        if (!state) throw new Error("sync state not found");
        const updated = {
          desiredVersion: state.desiredVersion + args.data.desiredVersion.increment,
          workStatus: args.data.workStatus ?? state.workStatus,
        };
        syncStates.set(args.where.golfClientId, updated);
        return updated;
      },
    },
  };
  return {
    async $transaction<T>(callback: (transaction: typeof tx) => Promise<T>) {
      return callback(tx);
    },
  } as unknown as PrismaClient;
}

test("name-only customer updates are allowed despite historical duplicate identifiers", async () => {
  const current = {
    ...client(1, " ANN@example.com ", "(210) 555-0100"),
    ghlContactId: null,
  };
  const db = fakeGolfClientDb(
    [
      current,
      client(2, "ann@example.com", "+12105550100"),
    ],
    current,
  );
  const result = await updateGolfClientIfUnique(db, current.id, {
    firstName: "Anne",
  });
  assert.equal(result.status, "updated");
  if (result.status === "updated") assert.equal(result.client.firstName, "Anne");
});

test("changing an identifier to a historical duplicate remains blocked", async () => {
  const current = {
    ...client(1, "old@example.com", null),
    ghlContactId: null,
  };
  const db = fakeGolfClientDb(
    [current, client(2, "ann@example.com", null)],
    current,
  );
  const result = await updateGolfClientIfUnique(db, current.id, {
    email: " ANN@example.com ",
  });
  assert.equal(result.status, "duplicate");
});
