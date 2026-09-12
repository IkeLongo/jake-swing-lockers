import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import DashboardHeader from "@/app/staff/_components/dashboard/DashboardHeader";

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

  return (
    <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <DashboardHeader />

      {/* ── Operational Dashboard Placeholder Area ──────────────────────── */}
      <div className="rounded-xl border border-dashed border-border p-8 text-center bg-card/50">
        <p className="text-sm text-muted-foreground font-body">
          Operational dashboard sections will be added here.
        </p>
      </div>
    </div>
  );
}
