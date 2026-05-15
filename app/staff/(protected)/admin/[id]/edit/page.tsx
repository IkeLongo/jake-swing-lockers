import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { EditStaffMemberForm } from "./_components/EditStaffMemberForm";

export const metadata: Metadata = {
  title: "Edit Staff Member — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function EditStaffMemberPage({
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
    },
  });

  if (!staff) notFound();

  return (
    <>
      <Link
        href={`/staff/admin/${staff.id}`}
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
      >
        ← Back to Staff Member
      </Link>
      <EditStaffMemberForm
        staffId={staff.id}
        initialName={staff.name ?? ""}
        initialEmail={staff.email ?? ""}
        initialPhone={staff.phone ?? ""}
        initialRole={staff.role}
      />
    </>
  );
}
