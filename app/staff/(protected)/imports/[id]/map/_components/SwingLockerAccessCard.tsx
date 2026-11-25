"use client";

import SendAccessButton from "../../../_components/SendAccessButton";
import PreviewLockerButton from "../../../_components/PreviewLockerButton";

interface Props {
  sessionId: number;
  initialStatus: string | null;
  clientHasContact: boolean;
  returnHref: string;
}

export default function SwingLockerAccessCard({
  sessionId,
  initialStatus,
  clientHasContact,
  returnHref,
}: Props) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
          Swing Locker Access
        </h2>
      </div>

      {/* Send Access and Preview Locker buttons */}
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <SendAccessButton
          sessionId={sessionId}
          initialStatus={initialStatus}
          clientHasContact={clientHasContact}
          variant="card"
        />
        <PreviewLockerButton sessionId={sessionId} returnHref={returnHref} />
      </div>
    </div>
  );
}
