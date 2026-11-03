"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import type {
  DuplicateCandidate,
  NewCustomerReview,
} from "@/lib/imports/new-customer-review";

interface Props {
  review: NewCustomerReview;
  saving: boolean;
  onUseExisting: (candidate: DuplicateCandidate) => void;
  onConfirmNew: (signature: string) => void;
}

const MATCH_LABEL: Record<DuplicateCandidate["matchedOn"], string> = {
  email: "Same email",
  phone: "Same phone",
  email_and_phone: "Same email and phone",
};

function headline(review: NewCustomerReview): { title: string; body: string } {
  switch (review.kind) {
    case "exact_email":
      return {
        title: "A customer with this email already exists",
        body: "Use the existing customer, or confirm this is a different person.",
      };
    case "possible_phone":
      return {
        title: "Possible duplicate: same phone number",
        body: "A shared phone number does not prove it is the same person. Use the existing customer, or confirm this is a different person.",
      };
    default:
      return {
        title: "Multiple customers match",
        body: "The email and phone number match different customers. Choose one, or confirm this is a different person.",
      };
  }
}

function candidateName(candidate: DuplicateCandidate): string {
  return (
    [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
    `Customer #${candidate.id}`
  );
}

export function DuplicateReviewPanel({
  review,
  saving,
  onUseExisting,
  onConfirmNew,
}: Props) {
  const { title, body } = headline(review);

  return (
    <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground font-subheading">
        <IconAlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground font-body">{body}</p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {review.candidates.map((candidate) => (
          <li
            key={candidate.id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground font-body">
                {candidateName(candidate)}
              </p>
              <p className="truncate text-xs text-muted-foreground font-body">
                {[candidate.email, candidate.phone].filter(Boolean).join(" · ")}
              </p>
              <p className="text-xs font-medium text-foreground font-body">
                {MATCH_LABEL[candidate.matchedOn]}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUseExisting(candidate)}
              disabled={saving}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 font-subheading"
            >
              Use this customer
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onConfirmNew(review.signature)}
        disabled={saving}
        className="mt-3 text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50 font-subheading"
      >
        {saving ? "Saving…" : "This is a different person — add as new customer"}
      </button>
    </div>
  );
}
