import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import UploadForm from "../../imports/new/_components/UploadForm";

export const metadata: Metadata = {
  title: "Upload Demo — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

export default function NewDemoSessionPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 border-b border-border pb-6 sm:mb-10">
        <Link
          href="/staff/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground font-body transition-colors"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
          Upload Demo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground font-body">
          Upload a TrackMan session to get started.
        </p>
      </div>

      <UploadForm trackManOnly />
    </div>
  );
}
