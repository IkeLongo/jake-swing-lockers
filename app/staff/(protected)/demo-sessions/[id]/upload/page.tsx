import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { SessionUploadForm } from "./_components/SessionUploadForm";

export const metadata: Metadata = {
  title: "Upload TrackMan File — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default async function SessionUploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const demoSession = await db.demoSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      demoDate: true,
      notes: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  if (!demoSession) notFound();

  const clientName =
    [demoSession.client.firstName, demoSession.client.lastName]
      .filter(Boolean)
      .join(" ") || "Unknown Client";

  const formattedDate = new Date(demoSession.demoDate).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" },
  );

  return (
    <>
      <div className="mb-8">
        <Link
          href="/staff/imports"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Sessions
        </Link>

        {/* Session context */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-xs">
          <p className="text-xl font-bold text-slate-900 font-heading">
            {clientName}
          </p>
          <p className="mt-0.5 text-sm text-slate-500 font-body">
            Demo Session — {formattedDate}
          </p>
          {demoSession.client.email && (
            <p className="mt-1 text-xs text-slate-400 font-body">
              {demoSession.client.email}
            </p>
          )}
          {demoSession.notes && (
            <p className="mt-2 text-xs text-slate-500 italic font-body">
              {demoSession.notes}
            </p>
          )}
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Upload TrackMan File
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Upload the TrackMan XLSX export for this session. Club averages will
          be generated automatically.
        </p>
      </div>

      <div className="max-w-lg">
        <SessionUploadForm demoSessionId={demoSession.id} />
      </div>
    </>
  );
}
