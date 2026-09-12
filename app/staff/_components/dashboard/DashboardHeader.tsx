import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";

export default function DashboardHeader() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-border">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-heading">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground font-body">
          Overview of your demos, customers, and sales activity.
        </p>
      </div>

      <div className="shrink-0">
        <Link
          href="/staff/demo-sessions/new"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary font-body"
        >
          <IconPlus className="h-4 w-4" />
          <span>Upload Demo</span>
        </Link>
      </div>
    </div>
  );
}
