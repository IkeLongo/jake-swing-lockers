import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SwingLockerAccessCard from "../app/staff/(protected)/imports/[id]/map/_components/SwingLockerAccessCard";
import SendAccessButton from "../app/staff/(protected)/imports/_components/SendAccessButton";

function renderCard(initialStatus: string | null, clientHasContact = true) {
  return renderToStaticMarkup(
    createElement(SwingLockerAccessCard, {
      sessionId: 7,
      initialStatus,
      clientHasContact,
      returnHref: "/staff/imports/3/map",
    }),
  );
}

function assertHeaderStatus(html: string, label: string) {
  const badge = `>${label}</span>`;
  assert.equal(html.split(badge).length - 1, 1);
  assert.match(
    html,
    new RegExp(`class="flex items-start justify-between gap-3".*Swing Locker Access</h2></div><div class="shrink-0"><span[^>]*>${label}</span></div></div>`),
  );
  assert.ok(html.indexOf(badge) < html.indexOf("Preview Locker"));
}

test("unsent access highlights preview without requiring it before sending", () => {
  const html = renderCard(null);
  assert.match(html, /Next Step/);
  assert.match(html, /Preview the customer&#x27;s fitting results and send their personalized Swing Locker\./);
  assert.match(html, /border-primary\/50 bg-primary\/5/);
  assertHeaderStatus(html, "Not Sent");
  assert.match(html, /<a[^>]*bg-primary[^>]*>.*?Preview Locker<\/a>/);
  assert.match(html, /<button[^>]*border-border bg-card[^>]*>Send Access<\/button>/);
  assert.match(html, /class="flex flex-wrap items-start gap-2 sm:gap-3"><a[^>]*>.*?Preview Locker<\/a><div[^>]*>.*?<button[^>]*>Send Access<\/button>/);
});

test("pending and sent access use the standard card and preserve actions", () => {
  for (const [status, label] of [["pending", "Pending"], ["sent", "Sent"]]) {
    const html = renderCard(status);
    assert.doesNotMatch(html, /Next Step/);
    assert.match(html, /border-border bg-card/);
    assertHeaderStatus(html, label);
    assert.match(html, /Re-Send Access/);
    assert.match(html, /Preview Locker/);
  }
});

test("failed delivery uses the warning accent and retains retry", () => {
  const html = renderCard("failed");
  assert.doesNotMatch(html, /Next Step/);
  assert.match(html, /border-accent\/50 bg-accent\/10/);
  assertHeaderStatus(html, "Failed");
  assert.match(html, /Try Again/);
  assert.match(html, /Preview Locker/);
});

test("standalone send controls retain their status badge", () => {
  const html = renderToStaticMarkup(
    createElement(SendAccessButton, {
      sessionId: 7,
      initialStatus: null,
      clientHasContact: true,
      variant: "card",
    }),
  );
  assert.match(html, />Not Sent<\/span>/);
  assert.match(html, />Send Access<\/button>/);
});

test("unsent access still requires customer contact information", () => {
  const html = renderCard(null, false);
  assert.match(html, /Next Step/);
  assert.match(html, /Add an email or phone number before sending access/);
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /Preview Locker/);
});
