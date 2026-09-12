import React from "react";
import AttentionCard, {
  type AttentionBadgeVariant,
} from "@/app/_components/cards/AttentionCard";
import {
  IconClipboardCheck,
  IconClock,
  IconShoppingCart,
} from "@tabler/icons-react";

export interface AttentionItem {
  id: string | number;
  customerName: string;
  context: string;
  reason: string;
  typeLabel: string;
  badgeVariant: AttentionBadgeVariant;
  icon: React.ReactNode;
  actionLabel: string;
  href?: string;
}

const MOCK_ATTENTION_ITEMS: AttentionItem[] = [
  {
    id: "1",
    customerName: "John Smith",
    context: "Driver Demo • Sep 11",
    reason: "Demo session is ready for review.",
    typeLabel: "Demo Review",
    badgeVariant: "warning",
    icon: <IconClipboardCheck className="h-5 w-5" />,
    actionLabel: "Review",
    href: "/staff/imports",
  },
  {
    id: "2",
    customerName: "Mike Johnson",
    context: "Iron Demo • Sep 8",
    reason: "Swing Locker hasn't been opened in 3 days.",
    typeLabel: "Follow Up",
    badgeVariant: "info",
    icon: <IconClock className="h-5 w-5" />,
    actionLabel: "View",
    href: "/staff/clients",
  },
  {
    id: "3",
    customerName: "Sarah Davis",
    context: "Driver Demo • Today",
    reason: "Customer submitted purchase interest.",
    typeLabel: "Purchase Interest",
    badgeVariant: "success",
    icon: <IconShoppingCart className="h-5 w-5" />,
    actionLabel: "View",
    href: "/staff/purchase-requests",
  },
];

interface NeedsAttentionProps {
  items?: AttentionItem[];
}

export default function NeedsAttention({
  items = MOCK_ATTENTION_ITEMS,
}: NeedsAttentionProps) {
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
          {items.map((item) => (
            <AttentionCard
              key={item.id}
              title={item.customerName}
              subtitle={item.context}
              description={item.reason}
              typeLabel={item.typeLabel}
              badgeVariant={item.badgeVariant}
              icon={item.icon}
              actionLabel={item.actionLabel}
              href={item.href}
            />
          ))}
        </div>
      )}
    </section>
  );
}
