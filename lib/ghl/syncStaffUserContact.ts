import { db } from "@/lib/db";
import { StaffRole } from "@/app/generated/prisma/client";
import { upsertContact } from "./contacts";
import {
  addTagsToContact,
  TAG_SL_STAFF,
  TAG_SL_ADMIN,
  TAG_SL_SALES_REP,
  TAG_SL_SUPPORT,
  TAG_RC_TEMP_SMS,
  TAG_RC_TEMP_STAFF,
  TAG_RC_TEMP_ADMIN,
  TAG_RC_TEMP_SALES_REP,
  TAG_RC_TEMP_SUPPORT,
} from "./tags";
import {
  upsertRiverCityContact,
  addRiverCityTags,
} from "./providers/riverCityGhl";

// ── Helpers ───────────────────────────────────────────────────────────────────

function splitName(name: string | null): {
  firstName: string;
  lastName: string | undefined;
} {
  if (!name) return { firstName: "", lastName: undefined };
  const idx = name.indexOf(" ");
  if (idx === -1) return { firstName: name, lastName: undefined };
  return { firstName: name.slice(0, idx), lastName: name.slice(idx + 1) };
}

function slRoleTag(role: StaffRole): string {
  switch (role) {
    case StaffRole.admin:
      return TAG_SL_ADMIN;
    case StaffRole.sales_rep:
      return TAG_SL_SALES_REP;
    case StaffRole.support:
      return TAG_SL_SUPPORT;
  }
}

function rcRoleTag(role: StaffRole): string {
  switch (role) {
    case StaffRole.admin:
      return TAG_RC_TEMP_ADMIN;
    case StaffRole.sales_rep:
      return TAG_RC_TEMP_SALES_REP;
    case StaffRole.support:
      return TAG_RC_TEMP_SUPPORT;
  }
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/**
 * Upsert a StaffUser into the Swing Locker GHL subaccount and apply role tags:
 *   golf-demo:staff  +  golf-demo:<role>  (admin | sales-rep | support)
 *
 * Saves ghlContactId / sync status back to the StaffUser record.
 * Never throws — failures are recorded on the DB record and logged.
 *
 * App DB role is the source of truth for permissions. GHL tags are mirrors
 * for communication segmentation only — never consulted for authorization.
 *
 * If GHL_SMS_PROVIDER_MODE === "rivercity_temp" and the staff user has a phone
 * number, also creates a temporary mirror contact in RiverCity for SMS
 * transport. The RiverCity contact ID is NOT stored.
 */
export async function syncStaffUserContact(staffUserId: number): Promise<void> {
  // ── Load staff user ────────────────────────────────────────────────────────
  const staff = await db.staffUser.findUnique({
    where: { id: staffUserId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      ghlContactId: true,
    },
  });

  if (!staff) {
    console.warn("[syncStaffUserContact] StaffUser not found:", staffUserId);
    return;
  }

  const { firstName, lastName } = splitName(staff.name);

  // ── Swing Locker upsert ────────────────────────────────────────────────────
  let ghlContactId: string;

  try {
    const resolution = await upsertContact(
      {
        firstName,
        lastName,
        email: staff.email,
        phone: staff.phone,
      },
      staff.ghlContactId
    );
    ghlContactId = resolution.id;

    await addTagsToContact(ghlContactId, [TAG_SL_STAFF, slRoleTag(staff.role)]);

    await db.staffUser.update({
      where: { id: staffUserId },
      data: {
        ghlContactId,
        ghlSyncStatus: "synced",
        ghlSyncError: null,
        ghlLastSyncedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[syncStaffUserContact] Swing Locker sync failed:", message);
    await db.staffUser.update({
      where: { id: staffUserId },
      data: {
        ghlSyncStatus: "failed",
        ghlSyncError: message,
      },
    });
    return;
  }

  // ── RiverCity temporary mirror (SMS only) ─────────────────────────────────
  if (staff.phone && process.env.GHL_SMS_PROVIDER_MODE === "rivercity_temp") {
    try {
      const rcContactId = await upsertRiverCityContact({
        firstName,
        lastName,
        phone: staff.phone,
      });
      await addRiverCityTags(rcContactId, [
        TAG_RC_TEMP_SMS,
        TAG_RC_TEMP_STAFF,
        rcRoleTag(staff.role),
      ]);
    } catch (err) {
      // RiverCity failure does not affect Swing Locker sync result
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        "[syncStaffUserContact] RiverCity mirror failed (non-fatal):",
        message
      );
    }
  }
}
