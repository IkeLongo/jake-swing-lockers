import type { Metadata } from "next";
import { getLockerByToken } from "@/lib/queries/locker";
import { LockerView } from "../_components/LockerView";

// ── Not-Found State ────────────────────────────────────────────────────────────

function LockerNotFound() {
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <div className="h-1 bg-gradient-to-r from-emerald-700 via-emerald-500 to-emerald-400" />
      <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 mb-6">
          <svg
            className="h-8 w-8 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
        <h1 className="font-heading text-2xl font-bold text-white mb-3">
          Locker Not Found
        </h1>
        <p className="font-body text-sm text-slate-400 max-w-sm leading-relaxed">
          This locker link may be invalid or has expired. Please contact your
          sales rep for a new link.
        </p>
      </div>
    </div>
  );
}

// ── Metadata ───────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const locker = await getLockerByToken(token);

  if (!locker) {
    return { title: "Locker Not Found | Jake Swing Lockers" };
  }

  const name = [locker.client.firstName, locker.client.lastName]
    .filter(Boolean)
    .join(" ");

  return {
    title: name ? `${name}'s Swing Locker` : "Your Swing Locker",
    robots: { index: false, follow: false },
  };
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function SwingLockerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const locker = await getLockerByToken(token);

  if (!locker) return <LockerNotFound />;

  return <LockerView data={locker} />;
}
