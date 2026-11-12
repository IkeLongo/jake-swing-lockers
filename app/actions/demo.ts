"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { db } from "@/lib/db";
import { STAFF_SESSION_COOKIE, verifyStaffSessionToken } from "@/lib/auth/session";
import { demoFormSchema, type ActionResult, type ClubTabValues } from "@/lib/validations/demo";
import { syncGolfDemoToGHL, type GhlSyncResult } from "@/lib/ghl/syncGolfDemo";
import { syncGolfClientContact } from "@/lib/ghl/syncGolfClientContact";
import { createGolfClientIfUnique } from "@/lib/imports/new-customer-review-store";

export async function createDemoSession(
  rawData: unknown
): Promise<ActionResult> {
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  const session = token ? verifyStaffSessionToken(token) : null;
  if (
    !session?.valid ||
    !Number.isSafeInteger(session.payload.staffUserId) ||
    session.payload.staffUserId < 1
  ) {
    return { success: false, message: "Unauthorized." };
  }
  const staff = await db.staffUser.findUnique({
    where: { id: session.payload.staffUserId },
    select: { isActive: true },
  });
  if (!staff?.isActive) {
    return { success: false, message: "Unauthorized." };
  }

  // ── 1. Validate ──────────────────────────────────────────────────────────────
  const parsed = demoFormSchema.safeParse(rawData);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<
      string,
      string[]
    >;
    return {
      success: false,
      message: "Please fix the validation errors below.",
      errors: fieldErrors,
    };
  }

  const data = parsed.data;

  try {
    // ── 2. Upsert GolfClient ──────────────────────────────────────────────────
    const clientResult = await createGolfClientIfUnique(db, {
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
    });
    if (clientResult.status === "invalid") {
      return { success: false, message: clientResult.error };
    }
    if (clientResult.status === "duplicate") {
      return {
        success: false,
        message:
          "A customer already matches this email or phone. Review and select the existing customer instead of creating another.",
      };
    }
    const client = clientResult.client;

    // ── 3. Generate a secure unique locker token ──────────────────────────────
    const lockerToken = randomUUID();

    // ── 4. Create DemoSession ─────────────────────────────────────────────────
    const demoSession = await db.demoSession.create({
      data: {
        clientId: client.id,
        lockerToken,
        demoDate: data.demoDate ?? new Date(),
        salesRep: data.salesRep,
        journeyStage: "demo_completed",
        clientGoal: data.clientGoal,
        notes: data.notes,
      },
    });

    // ── 5. Create DemoClubTests — two records per comparison pair ─────────────
    async function createClubRecord(
      tab: ClubTabValues,
      pairIndex: number,
      clubRole: "demo" | "current",
      isRecommended: boolean
    ) {
      const clubTest = await db.demoClubTest.create({
        data: {
          demoSessionId: demoSession.id,
          pairIndex,
          sortOrder: pairIndex * 2 + (clubRole === "current" ? 1 : 0),
          clubRole,
          isRecommended,
          clubType:       tab.clubType,
          brand:          tab.brand,
          model:          tab.model,
          shaft:          tab.shaft,
          loft:           tab.loft,
          estimatedPrice: tab.estimatedPrice,
          notes:          tab.notes,
        },
      });

      const hasMetrics = [
        tab.clubSpeed, tab.ballSpeed, tab.smashFactor,
        tab.carryDistance, tab.totalDistance, tab.launchAngle,
        tab.spinRate, tab.dispersion,
      ].some((v) => v !== undefined);

      if (hasMetrics) {
        await db.clubTestMetrics.create({
          data: {
            clubTestId:    clubTest.id,
            clubSpeed:     tab.clubSpeed,
            ballSpeed:     tab.ballSpeed,
            smashFactor:   tab.smashFactor,
            carryDistance: tab.carryDistance,
            totalDistance: tab.totalDistance,
            launchAngle:   tab.launchAngle,
            spinRate:      tab.spinRate,
            dispersion:    tab.dispersion,
          },
        });
      }
    }

    for (let i = 0; i < data.demoClubs.length; i++) {
      const pair = data.demoClubs[i];
      await createClubRecord(pair.demo, i, "demo", pair.isRecommended ?? false);
      // Skip the current-club record when every field on that tab is blank
      const currentIsBlank = Object.values(pair.current).every(
        (v) => v === undefined
      );
      if (!currentIsBlank) {
        await createClubRecord(pair.current, i, "current", false);
      }
    }

    // ── 6. Sync to GHL (non-blocking — failure must not break form submission) ──
    let ghlSync: GhlSyncResult;
    try {
      ghlSync = await syncGolfDemoToGHL(demoSession.id);
    } catch (ghlErr) {
      const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
      ghlSync = { success: false, error: msg, requiresReconciliation: true };
    }

    // Apply golf-demo:client tag and persist ghlContactId on the GolfClient record.
    // syncGolfDemoToGHL already upserts the contact; this adds the identity tag.
    if (!ghlSync.requiresReconciliation) {
      after(async () => {
        try {
          await syncGolfClientContact(client.id);
        } catch (error) {
          console.error("[GolfClient Sync] createDemoSession failed:", error);
        }
      });
    }

    return {
      success: true,
      lockerToken,
      demoSessionId: demoSession.id,
      customerSync: clientResult.customerSync,
      ghlSync,
    };
  } catch (err) {
    console.error("[createDemoSession]", err);
    return {
      success: false,
      message:
        "A database error occurred. Please try again or contact support.",
    };
  }
}


