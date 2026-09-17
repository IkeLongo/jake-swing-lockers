import React from "react";
import Link from "next/link";
import { IconChevronRight } from "@tabler/icons-react";

export interface AttentionCardProps {
  title: string;
  subtitle?: string;
  description: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  href?: string;
}

export default function AttentionCard({
  title,
  subtitle,
  description,
  icon,
  actionLabel,
  href,
}: AttentionCardProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-xs transition-all hover:shadow-md hover:border-border/80">
      <div className="flex items-start gap-3.5 min-w-0">
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground mt-0.5 sm:mt-0">
            {icon}
          </div>
        )}
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-base text-foreground font-heading truncate">
              {title}
            </span>
            {subtitle && (
              <>
                <span className="text-muted-foreground/40 text-xs hidden sm:inline">
                  •
                </span>
                <span className="text-xs text-muted-foreground font-body">
                  {subtitle}
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground font-body leading-relaxed">
            {description}
          </p>
        </div>
      </div>

      {href && actionLabel && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 self-start sm:self-auto text-sm font-semibold text-primary hover:text-primary-hover font-body transition-colors shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/50"
        >
          {actionLabel}
          <IconChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
