import type { PipelineCustomer } from "@/lib/pipeline/types";
import { isPurchaseRequestEditableStatus } from "@/lib/purchase-request-status";

export type CustomerNextActionId =
  | "review-purchase-interest"
  | "review-demo"
  | "send-swing-locker"
  | "await-customer-engagement"
  | "continue-conversation"
  | "purchase-follow-up"
  | "no-action-required";

export interface CustomerNextAction {
  id: CustomerNextActionId;
  label: string;
  requiresAttention: boolean;
  href?: string;
}

function isDemoReadyForLocker(customer: PipelineCustomer): boolean {
  return (
    customer.demo?.status === "finalized" &&
    customer.demo.needsRefinalization !== true
  );
}

function hasCompletedLockerSend(customer: PipelineCustomer): boolean {
  return (
    customer.swingLocker?.inviteStatus === "sent" &&
    Boolean(customer.swingLocker.sentAt)
  );
}

export function getCustomerNextAction(
  customer: PipelineCustomer
): CustomerNextAction {
  if (
    customer.purchaseRequest &&
    isPurchaseRequestEditableStatus(customer.purchaseRequest.status)
  ) {
    return {
      id: "review-purchase-interest",
      label: "Review Purchase Interest",
      requiresAttention: true,
      href: customer.purchaseRequest.viewUrl,
    };
  }

  if (!isDemoReadyForLocker(customer)) {
    return {
      id: "review-demo",
      label: "Review Demo",
      requiresAttention: true,
      href: customer.demo?.viewUrl,
    };
  }

  if (!hasCompletedLockerSend(customer)) {
    return {
      id: "send-swing-locker",
      label: "Send Swing Locker",
      requiresAttention: true,
    };
  }

  if (customer.stage === "locker-sent") {
    return {
      id: "await-customer-engagement",
      label: "Await Customer Engagement",
      requiresAttention: false,
    };
  }

  if (customer.stage === "engaged") {
    return {
      id: "continue-conversation",
      label: "Continue Conversation",
      requiresAttention: true,
    };
  }

  if (customer.stage === "considering") {
    return {
      id: "purchase-follow-up",
      label: "Purchase Follow-Up",
      requiresAttention: true,
    };
  }

  return {
    id: "no-action-required",
    label: "No Action Required",
    requiresAttention: false,
  };
}