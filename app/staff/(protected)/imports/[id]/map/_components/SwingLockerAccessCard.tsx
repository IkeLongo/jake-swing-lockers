"use client";

import { useState } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import {
  AccessStatusBadge,
  ControlledSendAccessButton,
} from "../../../_components/SendAccessButton";
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
  const [status, setStatus] = useState(initialStatus);
  const isNextStep = status === null;

  return (
    <div
      className={`flex flex-col rounded-xl border p-4 shadow-xs ${
        isNextStep
          ? "border-primary/50 bg-primary/5 dark:border-primary/60 dark:bg-primary/10"
          : status === "failed"
            ? "border-accent/50 bg-accent/10"
            : "border-border bg-card"
      }`}
    >
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            {isNextStep && (
              <p className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-foreground font-body">
                <IconArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                Next Step
              </p>
            )}
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
              Swing Locker Access
            </h2>
          </div>
          <div className="shrink-0">
            <AccessStatusBadge status={status} showNotSent />
          </div>
        </div>
        {isNextStep && (
          <p className="mt-2 text-sm text-foreground font-body">
            Preview the customer&apos;s fitting results and send their personalized Swing Locker.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-2 sm:gap-3">
        {isNextStep && (
          <PreviewLockerButton sessionId={sessionId} returnHref={returnHref} primary />
        )}
        <ControlledSendAccessButton
          sessionId={sessionId}
          status={status}
          clientHasContact={clientHasContact}
          variant="card"
          secondary={isNextStep}
          onStatusChange={setStatus}
          showBadge={false}
        />
        {!isNextStep && (
          <PreviewLockerButton sessionId={sessionId} returnHref={returnHref} />
        )}
      </div>
    </div>
  );
}
