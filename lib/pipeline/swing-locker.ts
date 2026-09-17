export function formatPipelineDate(
  date: Date | string | null | undefined
): string | undefined {
  if (!date) return undefined;
  const parsedDate = typeof date === "string" ? new Date(date) : date;
  if (isNaN(parsedDate.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsedDate);
}

export function getPrimarySessionSwingLockerSummary(session: {
  id: number;
  accessInviteStatus: string | null;
  accessInviteSentAt: Date | null;
}) {
  return {
    id: session.id,
    inviteStatus: session.accessInviteStatus ?? undefined,
    sentAt: formatPipelineDate(session.accessInviteSentAt),
    previewUrl: `/staff/demo-sessions/${session.id}/preview-locker`,
  };
}