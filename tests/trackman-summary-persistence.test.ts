import test from "node:test";
import assert from "node:assert/strict";
import { createTrackManMeasuredShot } from "@/lib/imports/trackmanMeasurements";
import {
  persistTrackManClubSummaries,
  type TrackManClubSummaryPersistenceOperations,
  type TrackManShotRowInput,
} from "@/lib/imports/trackmanClubSummaryPersistence";

const SOURCE_HEADERS = [
  "Club.Type",
  "Measurement.ClubSpeed",
  "Measurement.BallSpeed",
  "Measurement.SpinRate",
  "MaxHeight.Height",
  "Measurement.Carry",
  "Measurement.Total",
  "Tags",
] as const;

function trackManShotRow(
  id: number,
  rowIndex: number,
  {
    clubType,
    clubSpeed,
    ballSpeed,
    spinRate,
    maxHeight,
    carry,
    total,
    tags,
  }: {
    clubType: string;
    clubSpeed: number;
    ballSpeed: number;
    spinRate: number;
    maxHeight: number;
    carry: number;
    total: number;
    tags: string;
  },
): TrackManShotRowInput {
  const cells = [
    clubType,
    String(clubSpeed),
    String(ballSpeed),
    String(spinRate),
    String(maxHeight),
    String(carry),
    String(total),
    tags,
  ];
  const measuredShot = createTrackManMeasuredShot({
    headers: SOURCE_HEADERS,
    shotRow: cells,
    siUnitRow: [null, "[m/s]", "[m/s]", "[rpm]", "[m]", "[m]", "[m]", null],
    conversionFactorRow: [
      null,
      "1",
      "1",
      "1",
      "3.28084",
      "1.09361",
      "1.09361",
      null,
    ],
    displayUnitRow: [
      null,
      "[m/s]",
      "[m/s]",
      "[rpm]",
      "[ft]",
      "[yrd]",
      "[yrd]",
      null,
    ],
    exportFormat: "xlsx",
    selectedUnitSystem: "US",
  });

  return {
    id,
    rowIndex,
    rawData: {
      "Club.Type": clubType,
      "Measurement.ClubSpeed": String(clubSpeed),
      "Measurement.BallSpeed": String(ballSpeed),
      "Measurement.SpinRate": String(spinRate),
      "MaxHeight.Height": String(maxHeight),
      "Measurement.Carry": String(carry),
      "Measurement.Total": String(total),
      tags: measuredShot.club.tags,
      measuredShot,
    },
  };
}

test("enriched TrackMan rows create summaries and persist exact associations", async () => {
  const shots = [
    trackManShotRow(101, 0, {
      clubType: "Driver",
      clubSpeed: 45,
      ballSpeed: 60,
      spinRate: 2500,
      maxHeight: 30,
      carry: 150,
      total: 165,
      tags: "Demo, Fit",
    }),
    trackManShotRow(102, 1, {
      clubType: "Driver",
      clubSpeed: 47,
      ballSpeed: 62,
      spinRate: 2700,
      maxHeight: 32,
      carry: 154,
      total: 169,
      tags: "Fit, Demo",
    }),
    trackManShotRow(103, 2, {
      clubType: "Driver",
      clubSpeed: 43,
      ballSpeed: 58,
      spinRate: 2300,
      maxHeight: 28,
      carry: 146,
      total: 161,
      tags: "Demo",
    }),
  ];
  const originalMeasuredShots = shots.map((shot) =>
    structuredClone(shot.rawData.measuredShot),
  );
  const summaries: Array<{
    id: number;
    data: Parameters<
      TrackManClubSummaryPersistenceOperations["createSummary"]
    >[0];
  }> = [];
  const associatedRows = new Map(
    shots.map((shot) => [
      shot.id,
      {
        clubSummaryId: null as number | null,
        includedInSummary: null as boolean | null,
      },
    ]),
  );
  let nextSummaryId = 700;
  const operations: TrackManClubSummaryPersistenceOperations = {
    async createSummary(data) {
      const id = nextSummaryId++;
      summaries.push({ id, data });
      return { id };
    },
    async associateRows(batchId, rowIds, summaryId) {
      assert.equal(batchId, 33);
      let updatedCount = 0;
      for (const rowId of rowIds) {
        const row = associatedRows.get(rowId);
        if (!row) continue;
        row.clubSummaryId = summaryId;
        row.includedInSummary = true;
        updatedCount += 1;
      }
      return updatedCount;
    },
  };

  const createdCount = await persistTrackManClubSummaries(
    operations,
    33,
    shots,
  );

  assert.equal(createdCount, 2);
  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries.map(({ data }) => ({
      clubName: data.clubName,
      tags: data.tags,
      shotCount: data.shotCount,
      avgClubSpeed: data.avgClubSpeed,
      avgBallSpeed: data.avgBallSpeed,
      avgSpinRate: data.avgSpinRate,
      avgMaxHeight: data.avgMaxHeight,
      avgCarry: data.avgCarry,
      avgTotal: data.avgTotal,
      validCarryCount: data.validCarryCount,
    })),
    [
      {
        clubName: "Driver",
        tags: ["Demo"],
        shotCount: 1,
        avgClubSpeed: 43,
        avgBallSpeed: 58,
        avgSpinRate: 2300,
        avgMaxHeight: 28,
        avgCarry: 146,
        avgTotal: 161,
        validCarryCount: 1,
      },
      {
        clubName: "Driver",
        tags: ["Demo", "Fit"],
        shotCount: 2,
        avgClubSpeed: 46,
        avgBallSpeed: 61,
        avgSpinRate: 2600,
        avgMaxHeight: 31,
        avgCarry: 152,
        avgTotal: 167,
        validCarryCount: 2,
      },
    ],
  );

  const summaryIdByTags = new Map(
    summaries.map(({ id, data }) => [JSON.stringify(data.tags), id]),
  );
  for (const [shotIndex, shot] of shots.entries()) {
    const raw = shot.rawData;
    const rowState = associatedRows.get(shot.id);
    const rowTags = Array.isArray(raw.tags)
      ? raw.tags
          .filter((tag): tag is string => typeof tag === "string")
          .sort()
      : [];
    const expectedSummaryId = summaryIdByTags.get(JSON.stringify(rowTags));
    assert.ok(rowState);
    assert.equal(rowState.clubSummaryId, expectedSummaryId);
    assert.equal(rowState.includedInSummary, true);
    assert.deepEqual(raw.measuredShot, originalMeasuredShots[shotIndex]);
  }
});

test("missing summary create result fails intentionally before row association", async () => {
  const shot = trackManShotRow(201, 0, {
    clubType: "7 Iron",
    clubSpeed: 38,
    ballSpeed: 50,
    spinRate: 5000,
    maxHeight: 20,
    carry: 140,
    total: 150,
    tags: "",
  });
  let associationAttempted = false;

  await assert.rejects(
    persistTrackManClubSummaries(
      {
        async createSummary() {
          return null;
        },
        async associateRows() {
          associationAttempted = true;
          return 1;
        },
      },
      33,
      [shot],
    ),
    /TrackMan club summary creation returned no valid record for group 1 of 1/,
  );
  assert.equal(associationAttempted, false);
});

test("partial row association fails instead of reporting successful summaries", async () => {
  const shots = [
    trackManShotRow(301, 0, {
      clubType: "Hybrid",
      clubSpeed: 38,
      ballSpeed: 50,
      spinRate: 5000,
      maxHeight: 20,
      carry: 140,
      total: 150,
      tags: "",
    }),
    trackManShotRow(302, 1, {
      clubType: "Hybrid",
      clubSpeed: 39,
      ballSpeed: 51,
      spinRate: 5100,
      maxHeight: 21,
      carry: 141,
      total: 151,
      tags: "",
    }),
  ];

  await assert.rejects(
    persistTrackManClubSummaries(
      {
        async createSummary() {
          return { id: 900 };
        },
        async associateRows() {
          return 1;
        },
      },
      33,
      shots,
    ),
    /TrackMan shot association failed for summary group 1 of 1: expected 2 rows, associated 1/,
  );
});
