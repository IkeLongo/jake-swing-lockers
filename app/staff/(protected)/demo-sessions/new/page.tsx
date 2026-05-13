import type { Metadata } from "next";
import Link from "next/link";
import { CreateSessionForm } from "./_components/CreateSessionForm";

export const metadata: Metadata = {
  title: "Create Demo Session — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default function NewDemoSessionPage() {
  return (
    <>
      <div className="mb-8">
        <Link
          href="/staff/dashboard"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Create Demo Session
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Select or create a client, set the demo date, then upload the TrackMan
          file.
        </p>
      </div>

      <div className="max-w-xl">
        <CreateSessionForm />
      </div>
    </>
  );
}
