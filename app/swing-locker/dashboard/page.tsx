import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  SWING_LOCKER_SESSION_COOKIE,
  verifySwingLockerSessionToken,
} from "@/lib/auth/swing-locker-session";

export default async function SwingLockerDashboardPage() {
  // ── Verify session ─────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get(SWING_LOCKER_SESSION_COOKIE)?.value;

  if (!token) {
    redirect("/swing-locker/login");
  }

  const result = verifySwingLockerSessionToken(token);
  if (!result.valid) {
    redirect("/swing-locker/login");
  }

  // ── Load client ────────────────────────────────────────────────────────────
  const client = await db.golfClient.findUnique({
    where: { id: result.payload.golfClientId },
    select: { firstName: true, lastName: true, email: true },
  });

  if (!client) {
    redirect("/swing-locker/login");
  }

  const displayName =
    [client.firstName, client.lastName].filter(Boolean).join(" ") ||
    client.email ||
    "there";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm text-center">
        <span className="inline-block rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-700 font-body">
          SWING LOCKER
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Welcome, {displayName}
        </h1>
        <p className="mt-2 text-sm text-slate-500 font-body">
          Your Swing Locker dashboard is coming soon.
        </p>
      </div>
    </main>
  );
}
