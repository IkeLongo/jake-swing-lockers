import React from "react";

export type PipelineStatusVariant = "default" | "info" | "success" | "warning";

export interface PipelineCardProps {
  name: string;
  context: string;
  status: string;
  timeInStage?: string;
  statusVariant?: PipelineStatusVariant;
  statusIcon?: React.ReactNode;
  onClick?: () => void;
}

const STATUS_VARIANT_STYLES: Record<PipelineStatusVariant, { text: string; dot: string }> = {
  default: {
    text: "text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
  info: {
    text: "text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  success: {
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  warning: {
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
};

export default function PipelineCard({
  name,
  context,
  status,
  timeInStage,
  statusVariant = "default",
  statusIcon,
  onClick,
}: PipelineCardProps) {
  const variantStyle = STATUS_VARIANT_STYLES[statusVariant];

  const content = (
    <>
      {/* ── Customer Name & Context ──────────────────────────────────── */}
      <div>
        <h4 className="font-semibold text-sm text-foreground font-heading leading-tight truncate">
          {name}
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground font-body truncate">
          {context}
        </p>
      </div>

      {/* ── Status Indicator & Time in Stage ───────────────────────── */}
      <div className="flex items-center justify-between text-xs font-body pt-1.5 border-t border-border/40 gap-2">
        <div className={`flex items-center gap-1.5 font-medium truncate ${variantStyle.text}`}>
          {statusIcon ? (
            <span className="shrink-0 flex items-center justify-center">{statusIcon}</span>
          ) : (
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${variantStyle.dot}`} />
          )}
          <span className="truncate">{status}</span>
        </div>

        {timeInStage && (
          <span className="text-[11px] text-muted-foreground/80 shrink-0">
            {timeInStage}
          </span>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left cursor-pointer transition-all hover:border-primary/40 hover:shadow-xs active:bg-muted/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-lg border border-border bg-card p-3 shadow-2xs space-y-2.5 block"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-2xs space-y-2.5">
      {content}
    </div>
  );
}
