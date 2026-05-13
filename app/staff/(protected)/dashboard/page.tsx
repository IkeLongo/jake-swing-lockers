import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dashboard — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

const features = [
  {
    href: "/staff/demo-sessions/new",
    label: "Upload Demo Session",
    description:
      "Create a client, set the demo date, and upload a TrackMan XLSX file to generate club averages.",
    icon: "📥",
    status: "active" as const,
  },
  {
    href: "/staff/imports",
    label: "Demo Sessions",
    description:
      "View all demo sessions, review club averages, and finalize imports for clients.",
    icon: "🔍",
    status: "active" as const,
  },
  {
    href: "/staff/purchase-requests",
    label: "Purchase Requests",
    description:
      "View and manage customer purchase interest submissions from Swing Locker sessions.",
    icon: "🛒",
    status: "active" as const,
  },
  {
    href: "#",
    label: "TrackMan API Ingestion",
    description:
      "Directly pull session data from the TrackMan cloud API. Eliminates manual CSV exports.",
    icon: "📡",
    status: "coming-soon" as const,
  },
  {
    href: "#",
    label: "Swing Locker Generation",
    description:
      "Auto-generate and publish a personalized Swing Locker page for the client from approved session data.",
    icon: "🔒",
    status: "coming-soon" as const,
  },
];

export default function StaffDashboardPage() {
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
}: {
  href: string;
  label: string;
  description: string;
  icon: string;
  status: "active" | "coming-soon";
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
