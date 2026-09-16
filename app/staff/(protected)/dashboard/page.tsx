import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import DashboardHeader from "@/app/staff/_components/dashboard/DashboardHeader";
import DashboardStats from "@/app/staff/_components/DashboardStats";
import NeedsAttention from "@/app/staff/_components/NeedsAttention";
import SalesPipeline from "@/app/staff/_components/SalesPipeline";
import { getPipelineCustomers } from "@/lib/queries/pipeline";

export const metadata: Metadata = {
  title: "Dashboard — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function StaffDashboardPage() {
  // ── Load current staff user role ───────────────────────────────────────────
  // We need to manually get the session cookie and verify it since we're in a
  // server component.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("staff_session")?.value;

  if (!sessionCookie) {
    redirect("/staff/login");
  }

  // Import here to avoid circular dependencies
  const { verifyStaffSessionToken } = await import("@/lib/auth/session");
  const sessionResult = verifyStaffSessionToken(sessionCookie);

  if (!sessionResult.valid) {
    redirect("/staff/login");
  }

  // Load the staff user to ensure account is active
  const staffUser = await db.staffUser.findUnique({
    where: { id: sessionResult.payload.staffUserId },
    select: { id: true, role: true, isActive: true },
  });

  if (!staffUser?.isActive) {
    redirect("/staff/login");
  }

  const pipelineCustomers = await getPipelineCustomers();

  return (
    <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <DashboardHeader />

      <DashboardStats
        activeLeads={12}
        activeLeadsChange="+3 this week"
        needsReview={3}
        needsReviewDescription="3 demos waiting"
        purchaseInterest={2}
        purchaseInterestDescription="1 new today"
        lockerOpenRate={67}
        lockerOpened={20}
        lockerSent={30}
      />

      <NeedsAttention />

      <SalesPipeline customers={pipelineCustomers} />
    </div>
  );
}
