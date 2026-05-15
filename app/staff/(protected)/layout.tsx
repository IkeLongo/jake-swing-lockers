import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ProtectedNavbar } from "./_components/ProtectedNavbar";

export default async function StaffProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Load admin status for optional badge ────────────────────────────────────
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <ProtectedNavbar isAdmin={isAdmin} />

      {/* ── Page content ────────────────────────────────────────────────────── */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400 font-body">
        JL Golf Sales — Internal Staff Portal
      </footer>
    </div>
  );
}
