import assert from "node:assert/strict";
import test from "node:test";

test("customer session summaries sort deterministically and apply inclusion and sale rules", async (t) => {
  const originalPrisma = Object.getOwnPropertyDescriptor(globalThis, "prisma");
  t.after(() => {
    if (originalPrisma) Object.defineProperty(globalThis, "prisma", originalPrisma);
    else Reflect.deleteProperty(globalThis, "prisma");
  });

  const older = {
    id: 20,
    demoDate: new Date("2026-03-01T00:00:00.000Z"),
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    status: "finalized",
    clubTests: [],
  };
  const sameDateOlder = {
    id: 30,
    demoDate: new Date("2026-04-15T00:00:00.000Z"),
    createdAt: new Date("2026-04-16T00:00:00.000Z"),
    status: "finalized",
    clubTests: [],
  };
  const sameDateNewer = {
    id: 31,
    demoDate: new Date("2026-04-15T00:00:00.000Z"),
    createdAt: new Date("2026-04-17T00:00:00.000Z"),
    status: "finalized",
    clubTests: [
      {
        id: 1, clubType: "6Iron - Mens14", clubRole: "demo",
        tags: ["Mens14"], includeInReport: null, availableForPurchase: true,
        estimatedPrice: 100,
      },
      {
        id: 1, clubType: "6Iron - Mens14", clubRole: "demo",
        tags: ["Mens14"], includeInReport: null, availableForPurchase: true,
        estimatedPrice: 100,
      },
      {
        id: 2, clubType: "7Iron", clubRole: "current",
        tags: ["Regular"], includeInReport: true, availableForPurchase: false,
        estimatedPrice: null,
      },
      {
        id: 3, clubType: "Putter", clubRole: "demo",
        tags: [], includeInReport: false, availableForPurchase: true,
        estimatedPrice: null,
      },
      {
        id: 4, clubType: "Wedge", clubRole: "current",
        tags: [], includeInReport: null, availableForPurchase: false,
        estimatedPrice: null,
      },
    ],
  };

  let capturedArgs: {
    where: { clientId: number; status: string };
    orderBy: { demoDate?: string; createdAt?: string; id?: string }[];
    select: { clubTests: { select: Record<string, boolean> } };
  } | undefined;

  Object.defineProperty(globalThis, "prisma", {
    configurable: true,
    writable: true,
    value: {
      demoSession: {
        async findMany(args: typeof capturedArgs) {
          assert.ok(args);
          capturedArgs = args;
          return [older, sameDateOlder, sameDateNewer].sort((a, b) =>
            b.demoDate.getTime() - a.demoDate.getTime() ||
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id - a.id,
          );
        },
      },
    },
  });

  const { getCustomerSessions } = await import("../lib/queries/customer-sessions");
  const sessions = await getCustomerSessions(7);

  assert.deepEqual(capturedArgs?.where, { clientId: 7, status: "finalized" });
  assert.deepEqual(capturedArgs?.orderBy, [
    { demoDate: "desc" },
    { createdAt: "desc" },
    { id: "desc" },
  ]);
  assert.deepEqual(sessions.map((session) => session.id), [31, 30, 20]);
  assert.equal(sessions[0]?.includedClubCount, 2);
  assert.deepEqual(
    sessions[0]?.includedClubs.map((club) => [club.name, club.label]),
    [
      ["6Iron", "6Iron · Mens14"],
      ["7Iron", "7Iron · Regular"],
    ],
  );
  assert.deepEqual(
    sessions[0]?.recommendedClubs.map((club) => club.label),
    ["6Iron · Mens14", "Putter"],
  );
});
