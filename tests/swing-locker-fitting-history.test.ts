import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CustomerSessionClubSummary,
  CustomerSessionSummary,
} from "../lib/queries/customer-sessions";
import {
  FittingHistory,
  generateFittingTitle,
} from "../app/swing-locker/dashboard/_components/FittingHistory";

function club(
  id: number,
  name: string | null,
  label = name ?? "Club",
): CustomerSessionClubSummary {
  return { id, name, label };
}

test("fitting titles use concise names and fall back when names are unclear", () => {
  assert.equal(generateFittingTitle([club(1, "Driver")]), "Driver Fitting");
  assert.equal(
    generateFittingTitle([club(1, "6Iron"), club(2, "7 Iron")]),
    "6 Iron & 7 Iron Fitting",
  );
  assert.equal(
    generateFittingTitle([club(1, "Driver"), club(2, "Driver")]),
    "Driver Fitting",
  );
  assert.equal(
    generateFittingTitle([club(1, null), club(2, "Unassigned")]),
    "Golf Club Fitting",
  );
  assert.equal(
    generateFittingTitle([
      club(1, "Driver"),
      club(2, "6Iron"),
      club(3, "7Iron"),
    ]),
    "Golf Club Fitting",
  );
});

test("fitting history cards show dates, included clubs, recommendations, and concise summaries", () => {
  const session: CustomerSessionSummary = {
    id: 41,
    demoDate: new Date("2026-04-15T00:00:00.000Z"),
    status: "finalized",
    includedClubCount: 4,
    includedClubs: [
      club(1, "6Iron", "6 Iron · Mens14"),
      club(2, "7Iron", "7 Iron · Mens14"),
      club(3, "6Iron", "6 Iron · Xxio"),
      club(4, "7Iron", "7 Iron · Regular"),
    ],
    recommendedClubs: [club(1, "6Iron", "6 Iron · Mens14")],
    estimatedTotal: null,
  };
  const html = renderToStaticMarkup(
    createElement(FittingHistory, { sessions: [session] }),
  );

  assert.match(html, /Your Fitting History/);
  assert.match(html, /Most Recent Fitting/);
  assert.match(html, /6 Iron &amp; 7 Iron Fitting/);
  assert.match(html, /April 15, 2026/);
  assert.match(html, /4 included clubs/);
  assert.match(html, /6 Iron · Mens14, 7 Iron · Mens14, 6 Iron · Xxio/);
  assert.match(html, /\+1 more/);
  assert.match(html, /Recommended clubs/);
  assert.match(html, /View Fitting/);
  assert.doesNotMatch(html, /7 Iron · Regular/);
});

test("empty fitting history has a semantic empty state and no fitting action", () => {
  const html = renderToStaticMarkup(
    createElement(FittingHistory, { sessions: [] }),
  );

  assert.match(html, /No finalized fittings yet/);
  assert.doesNotMatch(html, /View Fitting|Most Recent Fitting/);
});
