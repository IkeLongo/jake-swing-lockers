import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLockerBySessionId } from "@/lib/queries/locker";
import { LockerView } from "@/app/swing-locker/_components/LockerView";

export const metadata: Metadata = {
  title: "Locker Preview — Staff",
  robots: { index: false, follow: false },
};

function safeBackHref(from: string | string[] | undefined): string {
  const raw = Array.isArray(from) ? from[0] : from;
  if (raw && /^\/staff\//.test(raw)) return raw;
  return "/staff/imports";
}

export default async function PreviewLockerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const lockerData = await getLockerBySessionId(sessionId);
  if (!lockerData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
        <p className="text-slate-500 font-body text-sm">
          Session not found or not yet finalized.
        </p>
      </div>
    );
  }

  return (
    <LockerView data={lockerData} previewMode backHref={safeBackHref(from)} />
  );
}
