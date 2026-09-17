import test from "node:test";
import assert from "node:assert/strict";
import { getPrimarySessionSwingLockerSummary } from "@/lib/pipeline/swing-locker";

test("Swing Locker data remains bound to the newer primary session", () => {
  const olderSentSession = {
    id: 14,
    accessInviteStatus: "sent",
    accessInviteSentAt: new Date("2026-05-23T17:56:38.547Z"),
  };
  const newerPrimarySession = {
    id: 18,
    accessInviteStatus: null,
    accessInviteSentAt: null,
  };

  assert.deepEqual(getPrimarySessionSwingLockerSummary(newerPrimarySession), {
    id: 18,
    inviteStatus: undefined,
    sentAt: undefined,
    previewUrl: "/staff/demo-sessions/18/preview-locker",
  });
  assert.notDeepEqual(
    getPrimarySessionSwingLockerSummary(newerPrimarySession),
    getPrimarySessionSwingLockerSummary(olderSentSession)
  );
});