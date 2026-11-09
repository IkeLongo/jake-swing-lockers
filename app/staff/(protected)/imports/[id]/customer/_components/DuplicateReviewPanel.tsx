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
        body: "Select the existing customer or correct the email before creating a new customer.",
      };
    case "possible_phone":
      return {
        title: "Possible duplicate: same phone number",
        body: "This phone number is already assigned to a customer. Select that customer or correct the phone number before creating a new customer.",
      };
    default:
      return {
        title: "Multiple customers match",
        body: "The email and phone number match different customers. Select the correct customer or correct the identifiers before creating a new customer.",
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
    </div>
  );
}
