import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { StaffMembersTable } from "./staff/_components/StaffMembersTable";
import type { StaffRow } from "./staff/_components/StaffMembersTable";

export const metadata: Metadata = {
  title: "Staff Members — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function AdminStaffPage() {
  // ── Auth: require admin role ───────────────────────────────────────────────
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("staff_session")?.value;

  if (!sessionCookie) {
    redirect("/staff/login");
  }

  const { verifyStaffSessionToken } = await import("@/lib/auth/session");
  const sessionResult = verifyStaffSessionToken(sessionCookie);

  if (!sessionResult.valid) {
    redirect("/staff/login");
  }

  const currentUser = await db.staffUser.findUnique({
    where: { id: sessionResult.payload.staffUserId },
    select: { id: true, role: true, isActive: true },
  });

  if (!currentUser?.isActive) {
    redirect("/staff/login");
  }

  // Non-admin users are redirected back to the dashboard — not a 403 page
  if (currentUser.role !== "admin") {
    redirect("/staff/dashboard");
  }

  // ── Load staff members ─────────────────────────────────────────────────────
  const raw = await db.staffUser.findMany({
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  const staff: StaffRow[] = raw.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    role: s.role as StaffRow["role"],
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/staff/dashboard"
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
            Staff Members
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-body">
            Manage staff accounts, contact details, and dashboard access roles.
          </p>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <StaffMembersTable
        initialStaff={staff}
        currentStaffUserId={currentUser.id}
      />
    </>
  );
}
