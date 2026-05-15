import { z } from "zod";
import {
  type PurchaseRequestStatus,
  PURCHASE_REQUEST_STATUSES,
  toCanonicalPurchaseRequestStatus,
} from "@/lib/purchase-request-status";

export interface ParsedStatusOnlyPurchaseRequestEdit {
  mode: "status_only";
  status: PurchaseRequestStatus;
}

export interface ParsedFullPurchaseRequestEdit {
  mode: "full_edit";
  clubIds: number[];
  notes: string | null;
  status?: PurchaseRequestStatus;
}

export type ParsedPurchaseRequestEditPayload =
  | ParsedStatusOnlyPurchaseRequestEdit
  | ParsedFullPurchaseRequestEdit;

const statusSchema = z
  .string()
  .transform((raw) => toCanonicalPurchaseRequestStatus(raw))
  .refine((status): status is PurchaseRequestStatus => status != null, {
    message: `status must be one of: ${PURCHASE_REQUEST_STATUSES.join(", ")}`,
  });

const clubIdsSchema = z
  .array(z.number().int().positive())
  .min(1, "clubIds must contain at least one ID")
  .transform((ids) => Array.from(new Set(ids)));

const notesSchema = z
  .string()
  .optional()
  .transform((value) => {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const fullEditSchema = z.object({
  clubIds: clubIdsSchema,
  notes: notesSchema,
  status: statusSchema.optional(),
});

const statusOnlySchema = z.object({
  status: statusSchema,
});

export function parsePurchaseRequestEditPayload(
  body: unknown
):
  | { ok: true; data: ParsedPurchaseRequestEditPayload }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body == null) {
    return { ok: false, error: "Invalid JSON body" };
  }

  const candidate = body as Record<string, unknown>;
  const hasClubIds = Object.prototype.hasOwnProperty.call(candidate, "clubIds");
  const hasNotes = Object.prototype.hasOwnProperty.call(candidate, "notes");

  if (hasClubIds || hasNotes) {
    const parsed = fullEditSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid purchase request edit payload",
      };
    }

    return {
      ok: true,
      data: {
        mode: "full_edit",
        clubIds: parsed.data.clubIds,
        notes: parsed.data.notes,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
    };
  }

  const statusOnly = statusOnlySchema.safeParse(candidate);
  if (!statusOnly.success) {
    return {
      ok: false,
      error: statusOnly.error.issues[0]?.message ?? "Invalid purchase request status payload",
    };
  }

  return {
    ok: true,
    data: {
      mode: "status_only",
      status: statusOnly.data.status,
    },
  };
}
