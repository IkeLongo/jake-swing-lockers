import React from "react";
import Link from "next/link";
import { IconChevronRight } from "@tabler/icons-react";

export type AttentionBadgeVariant = "warning" | "info" | "success" | "neutral";

export interface AttentionCardProps {
  title: string;
  subtitle?: string;
  description: string;
  typeLabel: string;
  badgeVariant?: AttentionBadgeVariant;
  icon?: React.ReactNode;
  actionLabel?: string;
  href?: string;
}

const BADGE_STYLES: Record<AttentionBadgeVariant, string> = {
  warning:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/50",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/50",
  success:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/50",
  neutral: "bg-muted text-muted-foreground border border-border",
};

export default function AttentionCard({
  title,
  subtitle,
  description,
  typeLabel,
  badgeVariant = "neutral",
  icon,
  actionLabel = "View",
  href,
}: AttentionCardProps) {
  const innerContent = (
    <div className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-xs transition-all hover:shadow-md hover:border-border/80">
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

      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/50">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-body ${BADGE_STYLES[badgeVariant]}`}
        >
          {typeLabel}
        </span>

        {href ? (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:text-primary-hover font-body transition-colors">
            {actionLabel}
            <IconChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary font-body">
            {actionLabel}
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block no-underline">
        {innerContent}
      </Link>
    );
  }

  return innerContent;
}
