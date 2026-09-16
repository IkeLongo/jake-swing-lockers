import React from "react";
import Link from "next/link";
import Drawer from "@/app/_components/ui/Drawer";
import type { PipelineCustomer } from "@/lib/pipeline/types";
import {
  IconCheck,
  IconChevronRight,
  IconCircle,
  IconExternalLink,
  IconMail,
  IconPhone,
} from "@tabler/icons-react";

interface CustomerDrawerProps {
  customer: PipelineCustomer | null;
  open: boolean;
  onClose: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  demo: "Demo",
  "locker-sent": "Locker Sent",
  engaged: "Engaged",
  considering: "Considering",
};

export default function CustomerDrawer({
  customer,
  open,
  onClose,
}: CustomerDrawerProps) {
  if (!customer) return null;

  const contextText = customer.product
    ? `${customer.fittingType} • ${customer.product}`
    : customer.fittingType;

  const stageLabel = STAGE_LABELS[customer.stage] ?? customer.stage;

  return (
    <Drawer open={open} onClose={onClose} title={customer.name}>
      <div className="space-y-6">
        {/* ── Customer / Status Summary ─────────────────────────────────── */}
        <div className="space-y-3 pb-6 border-b border-border pr-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground font-heading">
              {customer.name}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground font-body">
              {contextText}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex items-center rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase font-body">
              {stageLabel}
            </span>

            {customer.timeInStage && (
              <span className="text-xs text-muted-foreground/80 font-body">
                {customer.timeInStage}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground font-body rounded-full bg-muted px-2.5 py-1 border border-border w-fit">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
            <span>{customer.status}</span>
          </div>
        </div>

        {/* ── Contact Section ───────────────────────────────────────────── */}
        <div className="space-y-3 pb-6 border-b border-border">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-heading">
            Contact
          </h3>

          <div className="space-y-2 text-sm font-body">
            <div className="flex items-center gap-2.5 text-foreground">
              <IconMail className="h-4 w-4 text-muted-foreground shrink-0" />
              {customer.contact?.email ? (
                <a
                  href={`mailto:${customer.contact.email}`}
                  className="hover:underline text-foreground"
                >
                  {customer.contact.email}
                </a>
              ) : (
                <span className="text-muted-foreground italic">Not provided</span>
              )}
            </div>

            <div className="flex items-center gap-2.5 text-foreground">
              <IconPhone className="h-4 w-4 text-muted-foreground shrink-0" />
              {customer.contact?.phone ? (
                <a
                  href={`tel:${customer.contact.phone}`}
                  className="hover:underline text-foreground"
                >
                  {customer.contact.phone}
                </a>
              ) : (
                <span className="text-muted-foreground italic">Not provided</span>
              )}
            </div>
          </div>

          {customer.clientId && (
            <div className="pt-1">
              <Link
                href={`/staff/clients/${customer.clientId}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover font-body transition-colors"
              >
                View Full Contact
                <IconChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>

        {/* ── Demo Section ──────────────────────────────────────────────── */}
        <div className="space-y-3 pb-6 border-b border-border">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-heading">
            Demo
          </h3>

          <div className="space-y-1.5 text-sm font-body">
            <div className="font-semibold text-foreground">
              {customer.demo?.type ?? customer.fittingType}
            </div>
            {customer.demo?.date && (
              <div className="text-xs text-muted-foreground">
                {customer.demo.date}
              </div>
            )}
            {customer.product && (
              <div className="text-xs text-foreground/80 font-medium">
                Recommended: {customer.product}
              </div>
            )}
          </div>

          {customer.demo?.id && (
            <div className="pt-1">
              <Link
                href={`/staff/imports/${customer.demo.id}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover font-body transition-colors"
              >
                View Demo
                <IconChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>

        {/* ── Swing Locker Section ──────────────────────────────────────── */}
        <div className="space-y-3 pb-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-heading">
            Swing Locker
          </h3>

          <div className="space-y-2 text-xs font-body">
            {customer.swingLocker?.sentAt ? (
              <div className="flex items-center gap-2 text-foreground">
                <IconCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  Sent on{" "}
                  <span className="font-medium">{customer.swingLocker.sentAt}</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <IconCircle className="h-3.5 w-3.5 shrink-0" />
                <span>Not sent</span>
              </div>
            )}

            {customer.swingLocker?.openedAt ? (
              <div className="flex items-center gap-2 text-foreground">
                <IconCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  Opened on{" "}
                  <span className="font-medium">{customer.swingLocker.openedAt}</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <IconCircle className="h-3.5 w-3.5 shrink-0" />
                <span>Not opened</span>
              </div>
            )}
          </div>

          {customer.swingLocker?.previewUrl && (
            <div className="pt-2">
              <Link
                href={customer.swingLocker.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted font-body transition-colors shadow-2xs"
              >
                Open Swing Locker
                <IconExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
