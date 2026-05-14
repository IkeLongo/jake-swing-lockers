"use server";

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { demoFormSchema, type ActionResult, type ClubTabValues } from "@/lib/validations/demo";
import { syncGolfDemoToGHL } from "@/lib/ghl/syncGolfDemo";
import { syncGolfClientContact } from "@/lib/ghl/syncGolfClientContact";

export async function createDemoSession(
  rawData: unknown
): Promise<ActionResult> {
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
    let client = data.email
      ? await db.golfClient.findFirst({ where: { email: data.email } })
      : null;

    if (client) {
      client = await db.golfClient.update({
        where: { id: client.id },
        data: {
          firstName: data.firstName ?? client.firstName,
          lastName: data.lastName ?? client.lastName,
          phone: data.phone ?? client.phone,
        },
      });
    } else {
      client = await db.golfClient.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
        },
      });
    }

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
    let ghlSync: { success: boolean; error?: string } | undefined;
    try {
      ghlSync = await syncGolfDemoToGHL(demoSession.id);
    } catch (ghlErr) {
      const msg = ghlErr instanceof Error ? ghlErr.message : String(ghlErr);
      ghlSync = { success: false, error: msg };
    }

    // Apply golf-demo:client tag and persist ghlContactId on the GolfClient record.
    // syncGolfDemoToGHL already upserts the contact; this adds the identity tag.
    void syncGolfClientContact(client.id).catch((err) => {
      console.error("[GolfClient Sync] createDemoSession failed:", err);
    });

    return {
      success: true,
      lockerToken,
      demoSessionId: demoSession.id,
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



