"use client";

import React, { useState } from "react";
import Link from "next/link";
import PipelineColumn from "@/app/_components/pipeline/PipelineColumn";
import PipelineCard from "@/app/_components/pipeline/PipelineCard";
import CustomerDrawer from "@/app/staff/_components/CustomerDrawer";
import { IconChevronRight } from "@tabler/icons-react";
import {
  type PipelineStage,
  type PipelineCustomer,
  type PipelineStageConfig,
  type PipelineStatusVariant,
  ACTIVE_PIPELINE_STAGES,
} from "@/lib/pipeline/types";

export type {
  PipelineStage,
  PipelineCustomer,
  PipelineStageConfig,
  PipelineStatusVariant,
};

export const MOCK_PIPELINE_CUSTOMERS: PipelineCustomer[] = [
  // ── DEMO ──────────────────────────────────────────────────────────────────
  {
    id: "cust-1",
    clientId: 1,
    name: "John Smith",
    stage: "demo",
    fittingType: "Driver Fitting",
    status: "Demo submitted",
    timeInStage: "Today",
    statusVariant: "info",
    contact: {
      email: "john.smith@example.com",
      phone: "(504) 555-0123",
    },
    demo: {
      id: "101",
      type: "Driver Fitting",
      date: "Sep 12, 2026",
      product: "Ping G440 Max",
    },
    swingLocker: {},
  },
  {
    id: "cust-2",
    clientId: 2,
    name: "Chris Brown",
    stage: "demo",
    fittingType: "Iron Fitting",
    status: "Demo submitted",
    timeInStage: "Yesterday",
    statusVariant: "info",
    contact: {
      email: "chris.brown@example.com",
    },
    demo: {
      id: "102",
      type: "Iron Fitting",
      date: "Sep 11, 2026",
      product: "Mizuno JPX 925",
    },
    swingLocker: {},
  },

  // ── LOCKER SENT ───────────────────────────────────────────────────────────
  {
    id: "cust-3",
    clientId: 3,
    name: "Mike Johnson",
    stage: "locker-sent",
    fittingType: "Driver",
    product: "Ping G440 Max",
    status: "Locker sent",
    timeInStage: "2 days in stage",
    statusVariant: "default",
    contact: {
      email: "mike.j@example.com",
      phone: "(504) 555-0188",
    },
    demo: {
      id: "103",
      type: "Driver Fitting",
      date: "Sep 10, 2026",
      product: "Ping G440 Max",
    },
    swingLocker: {
      id: "103",
      sentAt: "Sep 10, 2026",
      previewUrl: "/staff/demo-sessions/103/preview-locker",
    },
  },
  {
    id: "cust-4",
    clientId: 4,
    name: "Alex Wilson",
    stage: "locker-sent",
    fittingType: "Irons",
    product: "Mizuno JPX 925",
    status: "Locker opened",
    timeInStage: "1 day in stage",
    statusVariant: "success",
    contact: {
      email: "alex.w@example.com",
      phone: "(504) 555-0144",
    },
    demo: {
      id: "104",
      type: "Iron Fitting",
      date: "Sep 11, 2026",
      product: "Mizuno JPX 925",
    },
    swingLocker: {
      id: "104",
      sentAt: "Sep 11, 2026",
      openedAt: "Sep 11, 2026",
      previewUrl: "/staff/demo-sessions/104/preview-locker",
    },
  },
  {
    id: "cust-5",
    clientId: 5,
    name: "David Miller",
    stage: "locker-sent",
    fittingType: "Putter",
    product: "Odyssey Ai-One",
    status: "Locker sent",
    timeInStage: "4 days in stage",
    statusVariant: "warning",
    contact: {
      email: "david.miller@example.com",
    },
    demo: {
      id: "105",
      type: "Putter Fitting",
      date: "Sep 8, 2026",
      product: "Odyssey Ai-One",
    },
    swingLocker: {
      id: "105",
      sentAt: "Sep 8, 2026",
      previewUrl: "/staff/demo-sessions/105/preview-locker",
    },
  },

  // ── ENGAGED ───────────────────────────────────────────────────────────────
  {
    id: "cust-6",
    clientId: 6,
    name: "James Wilson",
    stage: "engaged",
    fittingType: "Driver",
    product: "TaylorMade Qi35",
    status: "Locker opened",
    timeInStage: "2 days in stage",
    statusVariant: "success",
    contact: {
      email: "james.wilson@example.com",
      phone: "(504) 555-1234",
    },
    demo: {
      id: "106",
      type: "Driver Fitting",
      date: "Sep 9, 2026",
      product: "TaylorMade Qi35",
    },
    swingLocker: {
      id: "106",
      sentAt: "Sep 9, 2026",
      openedAt: "Sep 10, 2026",
      previewUrl: "/staff/demo-sessions/106/preview-locker",
    },
  },
  {
    id: "cust-7",
    clientId: 7,
    name: "Robert Hall",
    stage: "engaged",
    fittingType: "Iron Fitting",
    status: "In conversation",
    timeInStage: "3 days in stage",
    statusVariant: "info",
    contact: {
      email: "robert.hall@example.com",
      phone: "(504) 555-0199",
    },
    demo: {
      id: "107",
      type: "Iron Fitting",
      date: "Sep 9, 2026",
      product: "Titleist T200",
    },
    swingLocker: {
      id: "107",
      sentAt: "Sep 9, 2026",
      openedAt: "Sep 10, 2026",
      previewUrl: "/staff/demo-sessions/107/preview-locker",
    },
  },

  // ── CONSIDERING ───────────────────────────────────────────────────────────
  {
    id: "cust-8",
    clientId: 8,
    name: "Sarah Davis",
    stage: "considering",
    fittingType: "Full Bag Fitting",
    status: "Considering purchase",
    timeInStage: "2 days in stage",
    statusVariant: "success",
    contact: {
      email: "sarah.davis@example.com",
      phone: "(504) 555-0210",
    },
    demo: {
      id: "108",
      type: "Full Bag Fitting",
      date: "Sep 10, 2026",
      product: "Callaway Elyte Custom Set",
    },
    swingLocker: {
      id: "108",
      sentAt: "Sep 10, 2026",
      openedAt: "Sep 10, 2026",
      previewUrl: "/staff/demo-sessions/108/preview-locker",
    },
  },
  {
    id: "cust-9",
    clientId: 9,
    name: "Tom Reed",
    stage: "considering",
    fittingType: "Driver",
    product: "Titleist GT2",
    status: "Considering purchase",
    timeInStage: "5 days in stage",
    statusVariant: "warning",
    contact: {
      email: "tom.reed@example.com",
      phone: "(504) 555-0233",
    },
    demo: {
      id: "109",
      type: "Driver Fitting",
      date: "Sep 7, 2026",
      product: "Titleist GT2",
    },
    swingLocker: {
      id: "109",
      sentAt: "Sep 7, 2026",
      openedAt: "Sep 8, 2026",
      previewUrl: "/staff/demo-sessions/109/preview-locker",
    },
  },
];

interface SalesPipelineProps {
  stages?: PipelineStageConfig[];
  customers?: PipelineCustomer[];
}

export default function SalesPipeline({
  stages = ACTIVE_PIPELINE_STAGES,
  customers = MOCK_PIPELINE_CUSTOMERS,
}: SalesPipelineProps) {
  const [selectedCustomer, setSelectedCustomer] = useState<PipelineCustomer | null>(null);

  return (
    <section className="space-y-4">
      {/* ── Section Header ────────────────────────────────────────────── */}
      <div className="flex flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground font-heading">
            Customer Pipeline
          </h2>
          <p className="text-sm text-muted-foreground font-body">
            Track customers from demo through purchase.
          </p>
        </div>

        <Link
          href="/staff/clients"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover font-body transition-colors shrink-0"
        >
          View All
          <IconChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {/* ── Pipeline Board / Horizontal Scroll Container ──────────────── */}
      <div className="overflow-x-auto pb-2 -mx-1 px-1">
        <div className="flex gap-4 min-w-max sm:min-w-0">
          {stages.map((stage) => {
            const stageCustomers = customers.filter(
              (c) => c.stage === stage.id
            );

            return (
              <PipelineColumn
                key={stage.id}
                title={stage.label}
                count={stageCustomers.length}
              >
                {stageCustomers.map((customer) => {
                  const contextText = customer.product
                    ? `${customer.fittingType} • ${customer.product}`
                    : customer.fittingType;

                  return (
                    <PipelineCard
                      key={customer.id}
                      name={customer.name}
                      context={contextText}
                      status={customer.status}
                      timeInStage={customer.timeInStage}
                      statusVariant={customer.statusVariant}
                      onClick={() => setSelectedCustomer(customer)}
                    />
                  );
                })}
              </PipelineColumn>
            );
          })}
        </div>
      </div>

      {/* ── Customer Detail Drawer ───────────────────────────────────── */}
      <CustomerDrawer
        customer={selectedCustomer}
        open={!!selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
      />
    </section>
  );
}
