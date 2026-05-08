import type { Metadata } from "next";
import { DemoForm } from "./_components/DemoForm";

export const metadata: Metadata = {
  title: "New Demo Session | Internal",
};

export default function NewDemoPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top accent bar */}
      <div className="h-1 bg-gradient-to-r from-emerald-700 via-emerald-500 to-emerald-400" />

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="mb-8">
          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 mb-3">
            Internal
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-heading">
            New Demo Session
          </h1>
          <p className="mt-2 text-sm text-slate-500 font-body">
            Record a client fitting and generate their swing locker token.
          </p>
        </div>

        {/* Form sections */}
        <DemoForm />
      </div>
    </div>
  );
}
