import type { StagedCustomerSummary } from "@/lib/imports/staged-customer-summary";

interface Props {
  title: string;
  description: string;
  customer: StagedCustomerSummary;
  className?: string;
}

// Shared top-of-page block for the staged TrackMan workflow
// (Review Fitting, Opportunity, and the future Confirm step).
// Width is controlled by the page container; pass className to override.
export function StagedFittingHeader({
  title,
  description,
  customer,
  className = "",
}: Props) {
  return (
    <header className={`mb-5 ${className}`.trim()}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
        TrackMan fitting
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground font-heading">
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground font-body">
        {description}
      </p>
      <div className="mt-3 w-full max-w-3xl rounded-lg border border-border bg-card px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-subheading">
          Customer
        </p>
        <p className="text-base font-semibold text-foreground font-heading">
          {customer.name}
        </p>
        {customer.contact && (
          <p className="text-sm text-muted-foreground font-body">
            {customer.contact}
          </p>
        )}
      </div>
    </header>
  );
}
