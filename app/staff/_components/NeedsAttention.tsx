import React from "react";
import AttentionCard from "@/app/_components/cards/AttentionCard";
import type { CustomerNextActionId } from "@/lib/pipeline/next-action";
import {
  IconClipboardCheck,
  IconClock,
  IconMessageCircle,
  IconSend,
  IconShoppingCart,
} from "@tabler/icons-react";

export interface AttentionItem {
  id: string | number;
  customerName: string;
  context: string;
  reason: string;
  actionId: CustomerNextActionId;
  actionLabel?: string;
  href?: string;
}

const ACTION_PRESENTATION: Record<
  CustomerNextActionId,
  { icon: React.ReactNode }
> = {
  "review-purchase-interest": {
    icon: <IconShoppingCart className="h-5 w-5" />,
  },
  "review-demo": {
    icon: <IconClipboardCheck className="h-5 w-5" />,
  },
  "send-swing-locker": {
    icon: <IconSend className="h-5 w-5" />,
  },
  "await-customer-engagement": {
    icon: <IconClock className="h-5 w-5" />,
  },
  "continue-conversation": {
    icon: <IconMessageCircle className="h-5 w-5" />,
  },
  "purchase-follow-up": {
    icon: <IconShoppingCart className="h-5 w-5" />,
  },
  "no-action-required": {
    icon: <IconClock className="h-5 w-5" />,
  },
};

interface NeedsAttentionProps {
  items: AttentionItem[];
}

export default function NeedsAttention({ items }: NeedsAttentionProps) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground font-heading">
          Needs Your Attention
        </h2>
        <p className="text-sm text-muted-foreground font-body">
          Items requiring action or follow-up.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold text-foreground font-body">
            You&apos;re all caught up!
          </p>
          <p className="mt-1 text-xs text-muted-foreground font-body">
            No items currently require your attention.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const presentation = ACTION_PRESENTATION[item.actionId];

            return (
              <AttentionCard
                key={item.id}
                title={item.customerName}
                subtitle={item.context}
                description={item.reason}
                icon={presentation.icon}
                actionLabel={item.actionLabel}
                href={item.href}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
