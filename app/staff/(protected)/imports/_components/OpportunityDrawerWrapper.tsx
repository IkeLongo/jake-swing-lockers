"use client";

import React, { useState } from "react";
import OpportunityDrawer from "@/app/staff/_components/OpportunityDrawer";
import SessionsByOpportunityTable from "./SessionsByOpportunityTable";
import type { SessionRow } from "./SessionsByOpportunityTable";

interface OpportunityDrawerWrapperProps {
  sessions: SessionRow[];
}

export default function OpportunityDrawerWrapper({ sessions }: OpportunityDrawerWrapperProps) {
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);

  return (
    <>
      <SessionsByOpportunityTable
        sessions={sessions}
        onSelectOpportunity={(id: string) => setSelectedOpportunityId(id)}
      />

      <OpportunityDrawer
        opportunityId={selectedOpportunityId}
        open={!!selectedOpportunityId}
        onClose={() => setSelectedOpportunityId(null)}
      />
    </>
  );
}
