import React from "react";
import StatCard from "@/app/_components/cards/StatCard";
import {
  IconUsers,
  IconClock,
  IconShoppingCart,
  IconLockOpen,
} from "@tabler/icons-react";

export interface DashboardStatsProps {
  activeLeads: number;
  activeLeadsChange?: string;
  needsReview: number;
  needsReviewDescription?: string;
  purchaseInterest: number;
  purchaseInterestDescription?: string;
  lockerOpenRate: number;
  lockerOpened?: number;
  lockerSent?: number;
}

export default function DashboardStats({
  activeLeads,
  activeLeadsChange,
  needsReview,
  needsReviewDescription,
  purchaseInterest,
  purchaseInterestDescription,
  lockerOpenRate,
  lockerOpened,
  lockerSent,
}: DashboardStatsProps) {
  const lockerDescription =
    lockerOpened !== undefined && lockerSent !== undefined
      ? `${lockerOpened} of ${lockerSent} opened`
      : undefined;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Active Leads"
        value={activeLeads}
        description={activeLeadsChange}
        icon={<IconUsers className="h-5 w-5" />}
      />

      <StatCard
        label="Needs Review"
        value={needsReview}
        description={needsReviewDescription}
        icon={<IconClock className="h-5 w-5" />}
      />

      <StatCard
        label="Purchase Interest"
        value={purchaseInterest}
        description={purchaseInterestDescription}
        icon={<IconShoppingCart className="h-5 w-5" />}
      />

      <StatCard
        label="Locker Open Rate"
        value={`${lockerOpenRate}%`}
        description={lockerDescription}
        icon={<IconLockOpen className="h-5 w-5" />}
      />
    </div>
  );
}
