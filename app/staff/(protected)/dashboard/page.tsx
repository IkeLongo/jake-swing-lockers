import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getStaffSessionFromRequest } from "@/lib/auth/requireStaffSession";
import type { NextRequest } from "next/server";

export const metadata: Metadata = {
  title: "Dashboard — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

const baseFeatures = [
  {
    href: "/staff/demo-sessions/new",
    label: "Upload Demo Session",
    description:
      "Create a client, set the demo date, and upload a TrackMan XLSX file to generate club averages.",
    icon: "📥",
    status: "active" as const,
    adminOnly: false,
  },
  {
    href: "/staff/clients",
    label: "Clients",
    description:
      "View and manage client profiles, contact details, and related demo sessions.",
    icon: "👥",
    status: "active" as const,
    adminOnly: false,
  },
  {
    href: "/staff/imports",
    label: "Demo Sessions",
    description:
      "View all demo sessions, review club averages, and finalize imports for clients.",
    icon: "🔍",
    status: "active" as const,
    adminOnly: false,
  },
  {
    href: "/staff/purchase-requests",
    label: "Purchase Requests",
    description:
      "View and manage customer purchase interest submissions from Swing Locker sessions.",
    icon: "🛒",
    status: "active" as const,
    adminOnly: false,
  },
  {
    href: "/staff/admin",
    label: "Staff Members",
    description:
      "View, create, and manage staff accounts and dashboard access roles.",
    icon: "👤",
    status: "active" as const,
    adminOnly: true,
  },
  {
    href: "#",
    label: "TrackMan API Ingestion",
    description:
      "Directly pull session data from the TrackMan cloud API. Eliminates manual CSV exports.",
    icon: "📡",
    status: "coming-soon" as const,
    adminOnly: false,
  },
  {
    href: "#",
    label: "Swing Locker Generation",
    description:
      "Auto-generate and publish a personalized Swing Locker page for the client from approved session data.",
    icon: "🔒",
    status: "coming-soon" as const,
    adminOnly: false,
  },
];

export default async function StaffDashboardPage() {
  // ── Load current staff user role ───────────────────────────────────────────
  // We need to manually get the session cookie and verify it since we're in a
  // server component and can't use getStaffSessionFromRequest directly.
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

  // Load the staff user to get their role
  const staffUser = await db.staffUser.findUnique({
    where: { id: sessionResult.payload.staffUserId },
    select: { role: true, isActive: true },
  });

  if (!staffUser?.isActive) {
    redirect("/staff/login");
  }

  const isAdmin = staffUser.role === "admin";

  // Filter features based on admin status
  const features = baseFeatures.filter(
    (f) => !f.adminOnly || (f.adminOnly && isAdmin)
  );
  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Welcome to the internal sales rep portal. Select a tool to get
          started.
        </p>
      </div>

      {/* ── Feature cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {features.map((feature) => (
          <FeatureCard key={feature.label} {...feature} />
        ))}
      </div>
    </>
  );
}

function FeatureCard({
  href,
  label,
  description,
  icon,
  status,
  adminOnly,
}: {
  href: string;
  label: string;
  description: string;
  icon: string;
  status: "active" | "coming-soon";
  adminOnly?: boolean;
}) {
  const isActive = status === "active";

  const inner = (
    <div
      className={`group relative rounded-xl border p-5 transition-shadow ${
        isActive
          ? "border-slate-200 bg-white shadow-xs hover:shadow-md cursor-pointer"
          : "border-slate-200 bg-slate-50 cursor-default"
      }`}
    >
      {/* Coming-soon badge */}
      {!isActive && (
        <span className="absolute right-3 top-3 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 font-body">
          Coming soon
        </span>
      )}

      <div className="mb-3 text-2xl">{icon}</div>
      <h2
        className={`text-base font-semibold font-subheading ${
          isActive ? "text-slate-900" : "text-slate-400"
        }`}
      >
        {label}
      </h2>
      <p
        className={`mt-1 text-sm font-body leading-relaxed ${
          isActive ? "text-slate-500" : "text-slate-400"
        }`}
      >
        {description}
      </p>

      {isActive && (
        <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 group-hover:text-emerald-800 font-body">
          Open →
        </span>
      )}
    </div>
  );

  return isActive ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}
