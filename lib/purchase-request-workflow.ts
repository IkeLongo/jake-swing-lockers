import type { DeliverPurchaseRequestEmailsResult } from "@/lib/ghl/deliverPurchaseRequestEmails";
import type { ExistingPurchaseRequest } from "@/lib/queries/purchase-requests";

export interface PurchaseRequestClubSnapshotSource {
  id: number;
  clubType: string | null;
  estimatedPrice: { valueOf(): string } | number | null;
}

export interface PurchaseRequestClubSnapshot {
  demoClubTestId: number;
  clubType: string | null;
  estimatedPrice: number | null;
}

export function getUniqueClubIdsPreservingOrder(clubIds: number[]): number[] {
  return Array.from(new Set(clubIds));
}

export function buildPurchaseRequestClubSnapshots(
  orderedClubIds: number[],
  clubs: PurchaseRequestClubSnapshotSource[]
): PurchaseRequestClubSnapshot[] {
  const clubsById = new Map(clubs.map((club) => [club.id, club]));

  return orderedClubIds
    .map((clubId) => clubsById.get(clubId))
    .filter((club): club is PurchaseRequestClubSnapshotSource => club != null)
    .map((club) => ({
      demoClubTestId: club.id,
      clubType: club.clubType,
      estimatedPrice: club.estimatedPrice != null ? Number(club.estimatedPrice) : null,
    }));
}

export function isDuplicatePurchaseRequest(
  existing: ExistingPurchaseRequest | null
): existing is ExistingPurchaseRequest {
  return existing != null;
}

export function shouldUpdateOpportunityMonetaryValue(
  currentStageId: string,
  consideringPurchaseStageId: string
): boolean {
  return currentStageId === consideringPurchaseStageId;
}

export function getPurchaseRequestEditSideEffectWarnings(
  emailResult: DeliverPurchaseRequestEmailsResult,
  extraWarnings: string[] = []
): string[] {
  const warnings = [...extraWarnings];

  if (!emailResult.customerDelivered) {
    warnings.push(
      emailResult.customerError ?? "Updated customer email was not delivered."
    );
  }
  if (!emailResult.internalDelivered) {
    warnings.push(
      emailResult.internalError ?? "Updated internal email notification was not delivered."
    );
  }

  return warnings;
}
