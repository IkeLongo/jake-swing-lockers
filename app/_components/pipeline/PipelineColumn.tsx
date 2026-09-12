import React from "react";

export interface PipelineColumnProps {
  title: string;
  count: number;
  children?: React.ReactNode;
}

export default function PipelineColumn({
  title,
  count,
  children,
}: PipelineColumnProps) {
  const hasContent = React.Children.count(children) > 0;

  return (
    <div className="flex flex-col flex-1 min-w-[260px] rounded-xl border border-border bg-card shadow-xs">
      {/* ── Column Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 bg-muted/20 rounded-t-xl">
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground font-heading">
          {title}
        </h3>
        <span className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground font-body">
          {count}
        </span>
      </div>

      {/* ── Column Body / Card Area ────────────────────────────────────── */}
      <div className="flex flex-col flex-1 p-3 min-h-[160px]">
        {hasContent ? (
          <div className="space-y-3">{children}</div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/10 p-4">
            <span className="text-xs text-muted-foreground/70 font-body">
              No customers
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
