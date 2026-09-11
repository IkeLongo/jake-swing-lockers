import { cookies } from "next/headers";
import { db } from "@/lib/db";
import StaffSidebar from "@/app/staff/_components/StaffSidebar";

export default async function StaffProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Load admin status for optional badge and admin nav items ────────────────
  let isAdmin = false;
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("staff_session")?.value;

    if (sessionCookie) {
      const { verifyStaffSessionToken } = await import("@/lib/auth/session");
      const sessionResult = verifyStaffSessionToken(sessionCookie);

      if (sessionResult.valid) {
        const staff = await db.staffUser.findUnique({
          where: { id: sessionResult.payload.staffUserId },
          select: { role: true },
        });
        isAdmin = staff?.role === "admin";
      }
    }
  } catch {
    // Silently fail — badge just won't show
  }

  return <StaffSidebar isAdmin={isAdmin}>{children}</StaffSidebar>;
}
