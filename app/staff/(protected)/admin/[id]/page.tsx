import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Staff Member — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

function fmtPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return phone;
}

function fmtRole(role: "admin" | "sales_rep" | "support"): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "sales_rep":
      return "Sales Rep";
    case "support":
      return "Support";
  }
}

function fmtDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function displayName(staff: { id: number; name: string | null; email: string | null }): string {
  return staff.name ?? staff.email ?? `Staff #${staff.id}`;
}

export default async function StaffMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
    select: { role: true, isActive: true },
  });

  if (!currentUser?.isActive) {
    redirect("/staff/login");
  }

  if (currentUser.role !== "admin") {
    redirect("/staff/dashboard");
  }

  // ── Load target staff member ───────────────────────────────────────────────
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const staff = await db.staffUser.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      ghlSyncStatus: true,
      ghlSyncError: true,
      ghlLastSyncedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!staff) notFound();

  return (
    <>
      <Link
        href="/staff/admin"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
      >
        ← Back to Staff Members
      </Link>

      <div className="mb-8 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
              {displayName(staff)}
            </h1>
            <dl className="mt-3 grid grid-cols-1 gap-y-1.5 text-sm font-body sm:grid-cols-2 sm:gap-x-6">
              <ProfileField label="Role" value={fmtRole(staff.role)} />
              <ProfileField label="Status" value={staff.isActive ? "Active" : "Inactive"} />
              <ProfileField label="Email" value={staff.email} />
              <ProfileField label="Phone" value={fmtPhone(staff.phone)} />
              <ProfileField label="GHL Sync Status" value={staff.ghlSyncStatus ?? "—"} />
              <ProfileField label="GHL Last Synced" value={fmtDate(staff.ghlLastSyncedAt)} />
              <ProfileField label="Created" value={fmtDate(staff.createdAt)} />
              <ProfileField label="Updated" value={fmtDate(staff.updatedAt)} />
            </dl>
          </div>
          <Link
            href={`/staff/admin/${staff.id}/edit`}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-colors font-body"
          >
            Edit Staff Member
          </Link>
        </div>
      </div>

      {staff.ghlSyncError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold text-amber-800 font-body">GHL Sync Error</p>
          <p className="mt-1 text-sm text-amber-700 font-body">{staff.ghlSyncError}</p>
        </div>
      )}
    </>
  );
}

function ProfileField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value ?? "—"}</dd>
    </div>
  );
}
