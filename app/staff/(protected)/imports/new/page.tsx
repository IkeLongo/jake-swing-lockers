import type { Metadata } from "next";
import Link from "next/link";
import UploadForm from "./_components/UploadForm";

export const metadata: Metadata = {
  title: "New Import — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default function NewImportPage() {
  return (
    <>
      <div className="mb-8">
        <Link
          href="/staff/imports"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 font-body"
        >
          ← Back to Imports
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-heading">
          Upload Demo File
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-body">
          Upload a CSV or XLSX export. Rows will be staged for review before
          any data is saved to client records.
        </p>
      </div>

      <div className="max-w-lg">
        <UploadForm />
      </div>
    </>
  );
}
