import React from "react";

export interface StatCardProps {
  label: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
}

export default function StatCard({
  label,
  value,
  description,
  icon,
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground font-body">
          {label}
        </span>
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground shrink-0">
            {icon}
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="text-2xl font-bold tracking-tight text-foreground font-heading">
          {value}
        </div>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground font-body">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
