import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import { CreateSessionForm } from "./_components/CreateSessionForm";

export const metadata: Metadata = {
  title: "Upload Demo — Jake Swing Lockers Staff",
  robots: { index: false, follow: false },
};

const WORKFLOW_STEPS = [
  { label: "Customer", current: true },
  { label: "Session Details", current: true },
  { label: "TrackMan Data", current: false },
];

export default function NewDemoSessionPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
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
          Add a fitting session and upload the customer&rsquo;s TrackMan data.
        </p>

        <ol className="mt-5 flex items-center gap-2 font-subheading text-xs font-semibold uppercase tracking-wide">
          {WORKFLOW_STEPS.map((step, index) => (
            <li key={step.label} className="flex items-center gap-2">
              {index > 0 && (
                <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
              <span
                className={`flex items-center gap-1.5 ${
                  step.current ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                    step.current
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  {index + 1}
                </span>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <CreateSessionForm />
    </div>
  );
}
